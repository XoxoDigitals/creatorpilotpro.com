import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AccountKind, Platform, Prisma, SocialAccount } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SettingsService } from '../system/settings.service';
import { PostQuedClient, type PqPlatformAccount } from './postqued.client';
import { GoogleOAuthService, type GoogleTokenBundle } from './oauth/google.service';
import { MetaOAuthService, type MetaPage } from './oauth/meta.service';
import { signState, verifyState } from './oauth/oauth-state.util';
import {
  type AccountView,
  toAccountView,
} from './account.view';
import type {
  PatchAccountDto,
  PatchProfileDto,
  SchedulingPrefs,
  WizardChoices,
} from './dto/account.dto';

const KIND_BY_PLATFORM: Record<Platform, AccountKind> = {
  YOUTUBE: 'YT_CHANNEL',
  FACEBOOK: 'FB_PAGE',
  TIKTOK: 'TIKTOK_ACCOUNT',
};

/** PostQued lowercase platform → our enum. */
const PLATFORM_BY_PQ: Record<string, Platform | undefined> = {
  youtube: 'YOUTUBE',
  facebook: 'FACEBOOK',
  tiktok: 'TIKTOK',
};

const DEFAULT_SCHEDULING: SchedulingPrefs = {
  cadence: 'PER_DAY',
  perDay: 1,
  times: [],
  randomizeMinutes: 45,
};

interface CreateAccountParams {
  platform: Platform;
  kind: AccountKind;
  externalId: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  connectionMethod: SocialAccount['connectionMethod'];
  authPayload: unknown;
  tokenExpiresAt: Date | null;
  contentType: WizardChoices['contentType'];
  dramasEnabled: boolean;
  schedulingPrefs?: SchedulingPrefs;
  addedById: string;
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly settings: SettingsService,
    private readonly postqued: PostQuedClient,
    private readonly google: GoogleOAuthService,
    private readonly meta: MetaOAuthService,
    private readonly config: ConfigService,
  ) {}

  // --- CRUD -----------------------------------------------------------------

  async list(): Promise<AccountView[]> {
    const rows = await this.prisma.client.socialAccount.findMany({
      where: { deletedAt: null },
      include: { profile: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toAccountView);
  }

  async get(id: string): Promise<AccountView> {
    const row = await this.loadActive(id);
    return toAccountView(row);
  }

  async patch(id: string, dto: PatchAccountDto): Promise<AccountView> {
    await this.loadActive(id);
    const row = await this.prisma.client.socialAccount.update({
      where: { id },
      data: {
        contentType: dto.contentType,
        dramasEnabled: dto.dramasEnabled,
        paused: dto.paused,
        timezone: dto.timezone,
        monetized: dto.monetized,
      },
      include: { profile: true },
    });
    return toAccountView(row);
  }

  async patchProfile(id: string, dto: PatchProfileDto): Promise<AccountView> {
    await this.loadActive(id);
    const data: Prisma.ChannelProfileUpdateInput = {
      masterPrompt: dto.masterPrompt,
      writingStyle: dto.writingStyle,
      narrationStyle: dto.narrationStyle,
      language: dto.language,
      voiceSettings: dto.voiceSettings as Prisma.InputJsonValue | undefined,
      titleTemplate: dto.titleTemplate,
      descriptionTemplate: dto.descriptionTemplate,
      defaultTags: dto.defaultTags,
      aiLabelDefault: dto.aiLabelDefault,
      approvalPolicy: dto.approvalPolicy as Prisma.InputJsonValue | undefined,
      schedulingPrefs: dto.schedulingPrefs as Prisma.InputJsonValue | undefined,
    };
    await this.prisma.client.channelProfile.update({ where: { accountId: id }, data });
    const row = await this.loadActive(id);
    return toAccountView(row);
  }

  async softDelete(id: string): Promise<{ id: string; deleted: true }> {
    await this.loadActive(id);
    await this.prisma.client.socialAccount.update({
      where: { id },
      data: { deletedAt: new Date(), paused: true },
    });
    return { id, deleted: true };
  }

  private async loadActive(
    id: string,
  ): Promise<SocialAccount & { profile: Prisma.ChannelProfileGetPayload<object> | null }> {
    const row = await this.prisma.client.socialAccount.findFirst({
      where: { id, deletedAt: null },
      include: { profile: true },
    });
    if (!row) throw new NotFoundException('Account not found');
    return row;
  }

  // --- PostQued -------------------------------------------------------------

  /** Integrations connected in PostQued that are not yet imported here. */
  async listAvailablePostqued(platform?: Platform): Promise<
    Array<{
      pqAccountId: string;
      platform: Platform;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
    }>
  > {
    const workspaceId = await this.postquedWorkspaceId();
    const integrations = await this.postqued.listIntegrations(workspaceId);

    const imported = new Set(
      (
        await this.prisma.client.socialAccount.findMany({
          where: { connectionMethod: 'POSTQUED', deletedAt: null },
          select: { externalId: true },
        })
      ).map((r) => r.externalId),
    );

    const out: Array<{
      pqAccountId: string;
      platform: Platform;
      username: string;
      displayName: string | null;
      avatarUrl: string | null;
    }> = [];
    for (const acc of integrations as PqPlatformAccount[]) {
      const p = PLATFORM_BY_PQ[acc.platform];
      if (!p) continue; // platform we don't model (instagram, linkedin, …)
      if (platform && p !== platform) continue;
      if (imported.has(acc.id)) continue;
      out.push({
        pqAccountId: acc.id,
        platform: p,
        username: acc.username,
        displayName: acc.displayName,
        avatarUrl: acc.avatarUrl,
      });
    }
    return out;
  }

  async connectPostqued(
    dto: {
      pqAccountId: string;
      platform: Platform;
      contentType: WizardChoices['contentType'];
      dramasEnabled: boolean;
      schedulingPrefs?: SchedulingPrefs;
    },
    addedById: string,
  ): Promise<AccountView> {
    const workspaceId = await this.postquedWorkspaceId();
    const integrations = await this.postqued.listIntegrations(workspaceId);
    const match = (integrations as PqPlatformAccount[]).find((a) => a.id === dto.pqAccountId);
    if (!match) {
      throw new BadRequestException('That PostQued integration was not found in the workspace.');
    }
    const platform = PLATFORM_BY_PQ[match.platform] ?? dto.platform;

    return this.createAccountWithProfile({
      platform,
      kind: KIND_BY_PLATFORM[platform],
      externalId: match.id,
      name: match.displayName || match.username,
      handle: match.username ? `@${match.username.replace(/^@/, '')}` : null,
      avatarUrl: match.avatarUrl,
      connectionMethod: 'POSTQUED',
      authPayload: { pqAccountId: match.id, workspaceId: workspaceId ?? null },
      tokenExpiresAt: null,
      contentType: dto.contentType,
      dramasEnabled: dto.dramasEnabled,
      schedulingPrefs: dto.schedulingPrefs,
      addedById,
    });
  }

  private async postquedWorkspaceId(): Promise<string | undefined> {
    const cfg = await this.settings.getDecrypted<{ workspaceId?: string }>(
      'platform_apps.postqued',
    );
    return cfg?.workspaceId;
  }

  // --- Google OAuth ---------------------------------------------------------

  async googleStartUrl(userId: string, wizard: WizardChoices): Promise<string> {
    const cfg = await this.google.getConfig();
    const state = signState(
      { userId, provider: 'google', wizard },
      this.sessionSecret(),
    );
    return this.google.buildAuthUrl({
      clientId: cfg.clientId,
      redirectUri: this.redirectUri('google'),
      scopes: this.google.scopesFor(cfg),
      state,
    });
  }

  /** Handle the Google callback; returns the created account id for redirect. */
  async googleCallback(code: string, state: string): Promise<string> {
    const payload = verifyState<{ userId: string; wizard: WizardChoices }>(
      state,
      this.sessionSecret(),
    );
    if (!payload) throw new BadRequestException('Invalid or expired OAuth state.');

    const bundle = await this.google.exchangeCode(code, this.redirectUri('google'));
    const channel = await this.google.fetchChannel(bundle.accessToken);

    const view = await this.createAccountWithProfile({
      platform: 'YOUTUBE',
      kind: 'YT_CHANNEL',
      externalId: channel.channelId,
      name: channel.title,
      handle: channel.handle,
      avatarUrl: channel.thumbnailUrl,
      connectionMethod: 'OWN_APP',
      authPayload: this.googleAuthPayload(bundle),
      tokenExpiresAt: new Date(bundle.expiryDate),
      contentType: payload.wizard.contentType,
      dramasEnabled: payload.wizard.dramasEnabled,
      schedulingPrefs: payload.wizard.schedulingPrefs,
      addedById: payload.userId,
    });
    return view.id;
  }

  private googleAuthPayload(bundle: GoogleTokenBundle): Record<string, unknown> {
    return {
      provider: 'google',
      accessToken: bundle.accessToken,
      refreshToken: bundle.refreshToken,
      scope: bundle.scope,
      tokenType: bundle.tokenType,
      expiryDate: bundle.expiryDate,
    };
  }

  // --- Meta OAuth -----------------------------------------------------------

  async metaStartUrl(userId: string, wizard: WizardChoices): Promise<string> {
    const cfg = await this.meta.getConfig();
    const state = signState({ userId, provider: 'meta', wizard }, this.sessionSecret());
    return this.meta.buildAuthUrl({
      appId: cfg.appId,
      redirectUri: this.redirectUri('meta'),
      state,
    });
  }

  /** Handle the Meta callback; returns a picker session id + web redirect URL. */
  async metaCallback(code: string, state: string): Promise<{ redirectTo: string }> {
    const payload = verifyState<{ userId: string; wizard: WizardChoices }>(
      state,
      this.sessionSecret(),
    );
    if (!payload) throw new BadRequestException('Invalid or expired OAuth state.');

    const userToken = await this.meta.exchangeCodeForLongLivedUserToken(
      code,
      this.redirectUri('meta'),
    );
    const pages = await this.meta.listPages(userToken);
    const session = this.meta.createPendingSession(payload.userId, pages, payload.wizard);
    const web = this.config.get<string>('webAppUrl');
    return { redirectTo: `${web}/accounts/connect/meta?session=${encodeURIComponent(session)}` };
  }

  getMetaPendingPages(
    sessionId: string,
  ): Array<{ id: string; name: string; avatarUrl: string | null }> {
    return this.meta.getPendingPages(sessionId);
  }

  async connectMeta(
    dto: { session: string; pageId: string },
    userId: string,
  ): Promise<AccountView> {
    const resolved = this.meta.consumePage(dto.session, userId, dto.pageId);
    if (!resolved) {
      throw new BadRequestException('That page-picker session has expired. Reconnect the account.');
    }
    const page: MetaPage = resolved.page;
    // The wizard choices travelled through the OAuth state into the pending
    // session (like googleCallback's `payload.wizard`) — apply them here.
    return this.createAccountWithProfile({
      platform: 'FACEBOOK',
      kind: 'FB_PAGE',
      externalId: page.id,
      name: page.name,
      handle: null,
      avatarUrl: page.avatarUrl,
      connectionMethod: 'OWN_APP',
      authPayload: { provider: 'meta', pageId: page.id, pageAccessToken: page.accessToken },
      tokenExpiresAt: null, // Page tokens from a long-lived user token don't expire
      contentType: resolved.wizard.contentType,
      dramasEnabled: resolved.wizard.dramasEnabled,
      schedulingPrefs: resolved.wizard.schedulingPrefs,
      addedById: userId,
    });
  }

  // --- shared create ---------------------------------------------------------

  private async createAccountWithProfile(params: CreateAccountParams): Promise<AccountView> {
    const existing = await this.prisma.client.socialAccount.findUnique({
      where: { platform_externalId: { platform: params.platform, externalId: params.externalId } },
    });
    if (existing && existing.deletedAt === null) {
      throw new ConflictException('That account is already connected.');
    }

    const authPayloadEnc = this.crypto.encrypt(JSON.stringify(params.authPayload));
    const scheduling = (params.schedulingPrefs ?? DEFAULT_SCHEDULING) as unknown as Prisma.InputJsonValue;

    const row = await this.prisma.client.socialAccount.upsert({
      where: { platform_externalId: { platform: params.platform, externalId: params.externalId } },
      create: {
        platform: params.platform,
        kind: params.kind,
        externalId: params.externalId,
        name: params.name,
        handle: params.handle,
        avatarUrl: params.avatarUrl,
        connectionMethod: params.connectionMethod,
        authPayload: authPayloadEnc,
        tokenExpiresAt: params.tokenExpiresAt,
        connectionStatus: 'HEALTHY',
        contentType: params.contentType,
        dramasEnabled: params.dramasEnabled,
        addedById: params.addedById,
        profile: { create: { schedulingPrefs: scheduling } },
      },
      update: {
        // Re-importing a previously disconnected account.
        deletedAt: null,
        paused: false,
        name: params.name,
        handle: params.handle,
        avatarUrl: params.avatarUrl,
        connectionMethod: params.connectionMethod,
        authPayload: authPayloadEnc,
        tokenExpiresAt: params.tokenExpiresAt,
        connectionStatus: 'HEALTHY',
        contentType: params.contentType,
        dramasEnabled: params.dramasEnabled,
        addedById: params.addedById,
      },
      include: { profile: true },
    });

    // Ensure a profile exists when we took the `update` branch (re-import).
    if (!row.profile) {
      await this.prisma.client.channelProfile.create({
        data: { accountId: row.id, schedulingPrefs: scheduling },
      });
      return toAccountView(await this.loadActive(row.id));
    }
    return toAccountView(row);
  }

  private redirectUri(provider: 'google' | 'meta'): string {
    const web = this.config.get<string>('webAppUrl');
    return `${web}/api/v1/accounts/connect/${provider}/callback`;
  }

  private sessionSecret(): string {
    const s = this.config.get<string>('sessionSecret');
    if (!s) throw new BadRequestException('SESSION_SECRET is not configured.');
    return s;
  }
}
