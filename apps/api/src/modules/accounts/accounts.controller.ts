import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createReadStream } from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AccountsService } from './accounts.service';
import type { AccountView } from './account.view';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { SessionUser } from '../../common/session/session.types';
import {
  manualConnectSchema,
  metaConnectSchema,
  parseWizardQuery,
  patchAccountSchema,
  patchProfileSchema,
  type ManualConnectDto,
  type MetaConnectDto,
  type PatchAccountDto,
  type PatchProfileDto,
} from './dto/account.dto';

/**
 * Accounts module (docs mission §2, docs/11 §1). RBAC: OWNER/ADMIN manage;
 * REVIEWER can list/get accounts they are granted (AccountAccessGuard +
 * AccountsService filter). Mutations stay OWNER/ADMIN.
 * OAuth callbacks are @Public — trust comes from the signed state.
 */
@ApiTags('accounts')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  // --- Google OAuth ---------------------------------------------------------

  @Get('connect/google/start')
  @Roles('OWNER', 'ADMIN')
  async googleStart(
    @CurrentUser() actor: SessionUser,
    @Res() reply: FastifyReply,
    @Query('contentType') contentType?: string,
    @Query('dramasEnabled') dramasEnabled?: string,
    @Query('schedulingPrefs') schedulingPrefs?: string,
  ): Promise<void> {
    const wizard = parseWizardQuery({ contentType, dramasEnabled, schedulingPrefs });
    const url = await this.accounts.googleStartUrl(actor.id, wizard);
    void reply.redirect(url, 302);
  }

  @Public()
  @Get('connect/google/callback')
  async googleCallback(
    @Res() reply: FastifyReply,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const web = process.env.WEB_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';
    if (error || !code || !state) {
      void reply.redirect(`${web}/accounts?connect=google&error=1`, 302);
      return;
    }
    try {
      const { id, contentType } = await this.accounts.googleCallback(code, state);
      const dest =
        contentType === 'AI' || contentType === 'MIXED'
          ? `${web}/accounts/${id}/ideas?onboard=refs`
          : `${web}/accounts/${id}`;
      void reply.redirect(dest, 302);
    } catch {
      void reply.redirect(`${web}/accounts?connect=google&error=1`, 302);
    }
  }

  // --- Meta OAuth -----------------------------------------------------------

  @Get('connect/meta/start')
  @Roles('OWNER', 'ADMIN')
  async metaStart(
    @CurrentUser() actor: SessionUser,
    @Res() reply: FastifyReply,
    @Query('contentType') contentType?: string,
    @Query('dramasEnabled') dramasEnabled?: string,
    @Query('schedulingPrefs') schedulingPrefs?: string,
  ): Promise<void> {
    const wizard = parseWizardQuery({ contentType, dramasEnabled, schedulingPrefs });
    const url = await this.accounts.metaStartUrl(actor.id, wizard);
    void reply.redirect(url, 302);
  }

  @Public()
  @Get('connect/meta/callback')
  async metaCallback(
    @Res() reply: FastifyReply,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const web = process.env.WEB_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';
    if (error || !code || !state) {
      void reply.redirect(`${web}/accounts?connect=meta&error=1`, 302);
      return;
    }
    try {
      const { redirectTo } = await this.accounts.metaCallback(code, state);
      void reply.redirect(redirectTo, 302);
    } catch {
      void reply.redirect(`${web}/accounts?connect=meta&error=1`, 302);
    }
  }

  @Get('connect/meta/pending')
  @Roles('OWNER', 'ADMIN')
  metaPending(@Query('session') session: string) {
    return this.accounts.getMetaPendingPages(session ?? '');
  }

  @Post('connect/meta')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.connect.meta', 'SocialAccount')
  connectMeta(
    @CurrentUser() actor: SessionUser,
    @Body(new ZodBody(metaConnectSchema)) body: MetaConnectDto,
  ): Promise<{ accounts: AccountView[] }> {
    return this.accounts.connectMeta(body, actor.id);
  }

  // --- Manual connection (Phase 10) ------------------------------------------

  @Post('connect/manual')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.connect.manual', 'SocialAccount')
  connectManual(
    @CurrentUser() actor: SessionUser,
    @Body(new ZodBody(manualConnectSchema)) body: ManualConnectDto,
  ): Promise<AccountView> {
    return this.accounts.connectManual(body, actor.id);
  }

  // --- TikTok OAuth (Login Kit + Content Posting API) ------------------------

  @Get('connect/tiktok/start')
  @Roles('OWNER', 'ADMIN')
  async tiktokStart(
    @CurrentUser() actor: SessionUser,
    @Res() reply: FastifyReply,
    @Query('contentType') contentType?: string,
    @Query('dramasEnabled') dramasEnabled?: string,
    @Query('schedulingPrefs') schedulingPrefs?: string,
  ): Promise<void> {
    const wizard = parseWizardQuery({ contentType, dramasEnabled, schedulingPrefs });
    const url = await this.accounts.tiktokStartUrl(actor.id, wizard);
    void reply.redirect(url, 302);
  }

  @Public()
  @Get('connect/tiktok/callback')
  async tiktokCallback(
    @Res() reply: FastifyReply,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<void> {
    const web = process.env.WEB_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';
    if (error || !code || !state) {
      void reply.redirect(`${web}/accounts?connect=tiktok&error=1`, 302);
      return;
    }
    try {
      const { id, contentType } = await this.accounts.tiktokCallback(code, state);
      const dest =
        contentType === 'AI' || contentType === 'MIXED'
          ? `${web}/accounts/${id}/ideas?onboard=refs`
          : `${web}/accounts/${id}`;
      void reply.redirect(dest, 302);
    } catch {
      void reply.redirect(`${web}/accounts?connect=tiktok&error=1`, 302);
    }
  }

  // --- CRUD (:id routes last) -----------------------------------------------

  @Get()
  list(@CurrentUser() actor: SessionUser): Promise<AccountView[]> {
    return this.accounts.list(actor);
  }

  @Get(':id')
  get(
    @CurrentUser() actor: SessionUser,
    @Param('id') id: string,
  ): Promise<AccountView> {
    return this.accounts.get(id, actor);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.update', 'SocialAccount')
  patch(
    @Param('id') id: string,
    @Body(new ZodBody(patchAccountSchema)) body: PatchAccountDto,
  ): Promise<AccountView> {
    return this.accounts.patch(id, body);
  }

  @Patch(':id/profile')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.profile.update', 'ChannelProfile')
  patchProfile(
    @Param('id') id: string,
    @Body(new ZodBody(patchProfileSchema)) body: PatchProfileDto,
  ): Promise<AccountView> {
    return this.accounts.patchProfile(id, body);
  }

  @Post(':id/reaction-avatar')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.reactionAvatar.upload', 'ChannelProfile')
  async uploadReactionAvatar(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<AccountView> {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected a multipart/form-data upload.');
    }
    const data = await req.file();
    if (!data) throw new BadRequestException('No file part found in the upload.');
    return this.accounts.saveReactionAvatar(id, {
      filename: data.filename,
      mimeType: data.mimetype,
      stream: data.file,
      isTruncated: () => data.file.truncated,
      kind: 'silent',
    });
  }

  @Post(':id/reaction-avatar/lip-sync')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.reactionAvatar.lipSync.upload', 'ChannelProfile')
  async uploadReactionAvatarLipSync(
    @Param('id') id: string,
    @Req() req: FastifyRequest,
  ): Promise<AccountView> {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected a multipart/form-data upload.');
    }
    const data = await req.file();
    if (!data) throw new BadRequestException('No file part found in the upload.');
    return this.accounts.saveReactionAvatar(id, {
      filename: data.filename,
      mimeType: data.mimetype,
      stream: data.file,
      isTruncated: () => data.file.truncated,
      kind: 'lipSync',
    });
  }

  @Get(':id/reaction-avatar')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  async getReactionAvatar(
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const hit = await this.accounts.reactionAvatarLocalPath(id, 'silent');
    if (!hit) {
      void reply.status(404).send({ message: 'No reaction avatar uploaded.' });
      return;
    }
    void reply
      .header('Content-Type', hit.mimeType)
      .header('Cache-Control', 'private, max-age=60')
      .send(createReadStream(hit.path));
  }

  @Get(':id/reaction-avatar/lip-sync')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  async getReactionAvatarLipSync(
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const hit = await this.accounts.reactionAvatarLocalPath(id, 'lipSync');
    if (!hit) {
      void reply.status(404).send({ message: 'No lip-sync reaction clip uploaded.' });
      return;
    }
    void reply
      .header('Content-Type', hit.mimeType)
      .header('Cache-Control', 'private, max-age=60')
      .send(createReadStream(hit.path));
  }

  @Delete(':id/reaction-avatar')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.reactionAvatar.clear', 'ChannelProfile')
  clearReactionAvatar(@Param('id') id: string): Promise<AccountView> {
    return this.accounts.clearReactionAvatar(id, { kind: 'all' });
  }

  @Delete(':id/reaction-avatar/silent')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.reactionAvatar.clearSilent', 'ChannelProfile')
  clearReactionAvatarSilent(@Param('id') id: string): Promise<AccountView> {
    return this.accounts.clearReactionAvatar(id, { kind: 'silent' });
  }

  @Delete(':id/reaction-avatar/lip-sync')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.reactionAvatar.clearLipSync', 'ChannelProfile')
  clearReactionAvatarLipSync(@Param('id') id: string): Promise<AccountView> {
    return this.accounts.clearReactionAvatar(id, { kind: 'lipSync' });
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.disconnect', 'SocialAccount')
  remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    return this.accounts.softDelete(id);
  }
}
