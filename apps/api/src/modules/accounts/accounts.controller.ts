import {
  Body,
  Controller,
  Delete,
  Get,
  NotImplementedException,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { Platform } from '@scp/db';
import { AccountsService } from './accounts.service';
import type { AccountView } from './account.view';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { SessionUser } from '../../common/session/session.types';
import {
  metaConnectSchema,
  parseWizardQuery,
  patchAccountSchema,
  patchProfileSchema,
  postquedConnectSchema,
  type MetaConnectDto,
  type PatchAccountDto,
  type PatchProfileDto,
  type PostquedConnectDto,
} from './dto/account.dto';

/**
 * Accounts module (docs mission §2, docs/11 §1). RBAC: OWNER/ADMIN manage,
 * REVIEWER read-only (class-level allows all three; mutations override to
 * OWNER/ADMIN). OAuth callbacks are @Public — trust comes from the signed state.
 */
@ApiTags('accounts')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  // --- PostQued connect (declare before :id so static wins) -----------------

  @Get('connect/postqued/available')
  @Roles('OWNER', 'ADMIN')
  available(@Query('platform') platform?: string) {
    return this.accounts.listAvailablePostqued(platform as Platform | undefined);
  }

  @Post('connect/postqued')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.connect.postqued', 'SocialAccount')
  connectPostqued(
    @CurrentUser() actor: SessionUser,
    @Body(new ZodBody(postquedConnectSchema)) body: PostquedConnectDto,
  ): Promise<AccountView> {
    return this.accounts.connectPostqued(body, actor.id);
  }

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
      const id = await this.accounts.googleCallback(code, state);
      void reply.redirect(`${web}/accounts/${id}`, 302);
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
  ): Promise<AccountView> {
    return this.accounts.connectMeta(body, actor.id);
  }

  // --- TikTok own-app (stub) ------------------------------------------------

  @Post('connect/tiktok')
  @Roles('OWNER', 'ADMIN')
  connectTiktok(): never {
    throw new NotImplementedException(
      'TikTok own-app publishing requires your app to pass TikTok’s Content Posting API audit first. ' +
        'Use the PostQued connection method for TikTok in the meantime.',
    );
  }

  // --- CRUD (:id routes last) -----------------------------------------------

  @Get()
  list(): Promise<AccountView[]> {
    return this.accounts.list();
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<AccountView> {
    return this.accounts.get(id);
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

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @Audit('account.disconnect', 'SocialAccount')
  remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    return this.accounts.softDelete(id);
  }
}
