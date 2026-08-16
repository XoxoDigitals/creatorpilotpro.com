import { Body, Controller, Get, NotFoundException, Param, Patch, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { PublishingService } from './publishing.service';
import type { PublishTargetView } from './publish-target.view';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  createPublishSchema,
  patchTargetSchema,
  removeTargetSchema,
  type CreatePublishDto,
  type PatchTargetDto,
  type RemoveTargetDto,
} from './dto/publish.dto';

/**
 * Publishing module (docs/06 §4–5). Creates publish targets (cross-posting) and
 * exposes the calendar read side. OWNER/ADMIN manage; REVIEWER reads.
 */
@ApiTags('publishing')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller('publish')
export class PublishingController {
  constructor(private readonly publishing: PublishingService) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  @Audit('publish.create', 'PublishTarget')
  create(@Body(new ZodBody(createPublishSchema)) body: CreatePublishDto): Promise<PublishTargetView[]> {
    return this.publishing.createTargets(body);
  }

  @Get('targets')
  listTargets(
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<PublishTargetView[]> {
    return this.publishing.listTargets({ accountId, from, to });
  }

  @Get('target/:id')
  getTarget(@Param('id') id: string): Promise<PublishTargetView> {
    return this.publishing.getTarget(id);
  }

  @Patch('target/:id')
  @Roles('OWNER', 'ADMIN')
  @Audit('publish.target.update', 'PublishTarget')
  patchTarget(
    @Param('id') id: string,
    @Body(new ZodBody(patchTargetSchema)) body: PatchTargetDto,
  ): Promise<PublishTargetView> {
    return this.publishing.patchTarget(id, body);
  }

  /** Delete from CreatorPilot and/or remove the live Facebook video. */
  @Post('target/:id/remove')
  @Roles('OWNER', 'ADMIN')
  @Audit('publish.target.remove', 'PublishTarget')
  removeTarget(
    @Param('id') id: string,
    @Body(new ZodBody(removeTargetSchema)) body: RemoveTargetDto,
  ): Promise<{ id: string; deletedFromPlatform: boolean; deletedFromSystem: boolean }> {
    return this.publishing.removeTarget(id, body);
  }

  // ── Manual mode (Phase 10) ─────────────────────────────────────────────────

  /** Stream the final rendered asset for a manual-account target. */
  @Get('target/:id/download')
  async downloadFinal(
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const info = await this.publishing.getFinalAssetForDownload(id);
    if (!info) throw new NotFoundException('Final asset not available for this target.');
    void reply.header('content-disposition', `attachment; filename="${basename(info.path)}"`);
    void reply.header('content-type', info.mimeType);
    if (info.bytes != null) void reply.header('content-length', String(info.bytes));
    return new StreamableFile(createReadStream(info.path));
  }

  /** Owner marks a manual target as published after uploading it by hand. */
  @Post('target/:id/mark-published')
  @Roles('OWNER', 'ADMIN')
  @Audit('publish.target.mark_published', 'PublishTarget')
  markPublished(
    @Param('id') id: string,
    @Body('platformPostId') platformPostId?: string,
  ): Promise<PublishTargetView> {
    return this.publishing.markManuallyPublished(id, platformPostId);
  }
}
