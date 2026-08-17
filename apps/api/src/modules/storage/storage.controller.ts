import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { StorageService } from './storage.service';
import type { AssetView, LocalAssetView } from './asset.view';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { SessionUser } from '../../common/session/session.types';

const setRootFolderSchema = z.object({
  folderId: z.string().min(1).max(200),
});

type SetRootFolderDto = z.infer<typeof setRootFolderSchema>;

const bulkLocalIdsSchema = z.object({
  assetIds: z.array(z.string().min(1)).min(1).max(200),
});

type BulkLocalIdsDto = z.infer<typeof bulkLocalIdsSchema>;

/**
 * Storage module (docs/02 §6, docs/06 §2). Manual media upload → hot tier and/or
 * Google Drive library. OWNER/ADMIN/REVIEWER may upload (production + review flows).
 * Drive Connect OAuth is system-level (OWNER/ADMIN); callback is @Public via signed state.
 */
@ApiTags('storage')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller('storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get('status')
  @Roles('OWNER', 'ADMIN')
  async status() {
    return this.storage.driveStatus();
  }

  /** Local hot-tier video inventory (Workers page). OWNER/ADMIN only. */
  @Get('local-assets')
  @Roles('OWNER', 'ADMIN')
  listLocalAssets(): Promise<LocalAssetView[]> {
    return this.storage.listLocalAssets();
  }

  /** Bulk delete — static path before :id routes. */
  @Post('local-assets/delete-local')
  @Roles('OWNER', 'ADMIN')
  @Audit('asset.deleteLocalBulk', 'Asset')
  deleteLocalBulk(@Body(new ZodBody(bulkLocalIdsSchema)) body: BulkLocalIdsDto) {
    return this.storage.deleteLocalAssets(body.assetIds);
  }

  @Delete('local-assets/:id')
  @Roles('OWNER', 'ADMIN')
  @Audit('asset.deleteLocal', 'Asset')
  async deleteLocal(@Param('id') id: string): Promise<{ ok: true }> {
    await this.storage.deleteLocalAsset(id);
    return { ok: true };
  }

  @Post('local-assets/:id/clear-incidents')
  @Roles('OWNER', 'ADMIN')
  @Audit('incident.resolveRelated', 'Incident')
  clearIncidents(
    @Param('id') id: string,
    @CurrentUser() actor: SessionUser,
  ): Promise<{ resolved: number; incidentIds: string[] }> {
    return this.storage.clearRelatedIncidents(id, actor.id);
  }

  // --- Google Drive OAuth (system-level library) -----------------------------

  @Get('gdrive/connect/start')
  @Roles('OWNER', 'ADMIN')
  async gdriveConnectStart(
    @CurrentUser() actor: SessionUser,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const url = await this.storage.gdriveConnectStartUrl(actor.id);
    void reply.redirect(url, 302);
  }

  @Public()
  @Get('gdrive/connect/callback')
  async gdriveConnectCallback(
    @Res() reply: FastifyReply,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const web = process.env.WEB_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';
    if (error || !code || !state) {
      void reply.redirect(`${web}/settings?gdrive=error`, 302);
      return;
    }
    try {
      await this.storage.gdriveConnectCallback(code, state);
      void reply.redirect(`${web}/settings?gdrive=connected`, 302);
    } catch {
      void reply.redirect(`${web}/settings?gdrive=error`, 302);
    }
  }

  @Post('gdrive/disconnect')
  @Roles('OWNER', 'ADMIN')
  @Audit('storage.gdrive.disconnect', 'SystemSetting')
  async gdriveDisconnect(): Promise<{ disconnected: true }> {
    await this.storage.gdriveDisconnect();
    return { disconnected: true };
  }

  @Get('gdrive/folders')
  @Roles('OWNER', 'ADMIN')
  async gdriveFolders(@Query('parentId') parentId?: string) {
    return this.storage.listGdriveFolders(parentId);
  }

  @Put('gdrive/root-folder')
  @Roles('OWNER', 'ADMIN')
  @Audit('storage.gdrive.rootFolder', 'SystemSetting')
  setRootFolder(@Body(new ZodBody(setRootFolderSchema)) body: SetRootFolderDto) {
    return this.storage.setGdriveRootFolder(body.folderId);
  }

  @Post('upload')
  @Audit('asset.upload', 'Asset')
  async upload(
    @Req() req: FastifyRequest,
    @Query('contentItemId') contentItemId?: string,
    @Query('kind') kind?: string,
    @Query('accountId') accountId?: string,
  ): Promise<AssetView> {
    if (!contentItemId) throw new BadRequestException('contentItemId query param is required.');
    if (kind && kind !== 'ORIGINAL' && kind !== 'FINAL' && kind !== 'THUMBNAIL') {
      throw new BadRequestException('kind must be ORIGINAL, FINAL, or THUMBNAIL.');
    }
    if (!req.isMultipart()) throw new BadRequestException('Expected a multipart/form-data upload.');

    const data = await req.file();
    if (!data) throw new BadRequestException('No file part found in the upload.');

    return this.storage.saveUpload({
      contentItemId,
      kind: (kind as 'ORIGINAL' | 'FINAL' | 'THUMBNAIL') ?? 'FINAL',
      filename: data.filename,
      stream: data.file,
      isTruncated: () => data.file.truncated,
      ...(accountId ? { accountId } : {}),
    });
  }
}
