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
import { AccountAccessService } from '../../common/account-access/account-access.service';
import type { SessionUser } from '../../common/session/session.types';
import { GoogleOAuthService, type GoogleTokenBundle } from './oauth/google.service';
import { MetaOAuthService, type MetaPage } from './oauth/meta.service';
import { TikTokOAuthService, type TikTokTokenBundle } from './oauth/tiktok.service';
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
import {
  composeChannelStyles,
  parseStyleProfile,
  styleProfileSchema,
  defaultVoiceForLanguage,
} from '@scp/shared';

const KIND_BY_PLATFORM: Record<Platform, AccountKind> = {
  YOUTUBE: 'YT_CHANNEL',
  FACEBOOK: 'FB_PAGE',
  TIKTOK: 'TIKTOK_ACCOUNT',
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
    private readonly google: GoogleOAuthService,
    private readonly meta: MetaOAuthService,
    private readonly tiktok: TikTokOAuthService,
    private readonly config: ConfigService,
    private readonly accountAccess: AccountAccessService,
  ) {}

  // --- CRUD -----------------------------------------------------------------

  async list(actor: SessionUser): Promise<AccountView[]> {
    const idFilter = await this.accountAccess.accountIdFilter(actor);
    const rows = await this.prisma.client.socialAccount.findMany({
      where: {
        deletedAt: null,
        ...(idFilter ? { id: idFilter } : {}),
      },
      include: { profile: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toAccountView);
  }

  async get(id: string, actor: SessionUser): Promise<AccountView> {
    await this.accountAccess.assertCanAccess(actor, id);
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
    const account = await this.loadActive(id);
    const existing = account.profile;

    let masterPrompt = dto.masterPrompt;
    let writingStyle = dto.writingStyle;
    let narrationStyle = dto.narrationStyle;
    let styleProfileJson: Prisma.InputJsonValue | undefined;

    if (dto.styleProfile !== undefined) {
      const parsed = styleProfileSchema.safeParse(dto.styleProfile);
      if (!parsed.success) {
        throw new BadRequestException('Invalid styleProfile questionnaire payload');
      }
      styleProfileJson = parsed.data as unknown as Prisma.InputJsonValue;
      const language = dto.language ?? existing?.language ?? 'en';
      if (!parsed.data.masterPromptOverridden) {
        const composed = composeChannelStyles(parsed.data.answers, language);
        masterPrompt = composed.masterPrompt;
        writingStyle = composed.writingStyle;
        narrationStyle = composed.narrationStyle;
      }
    } else if (dto.language !== undefined && existing?.styleProfile) {
      // Language change with an existing questionnaire: refresh composed fields
      // unless the owner overrode the freeform master prompt.
      const parsed = parseStyleProfile(existing.styleProfile);
      if (!parsed.masterPromptOverridden) {
        const composed = composeChannelStyles(parsed.answers, dto.language);
        masterPrompt = composed.masterPrompt;
        writingStyle = composed.writingStyle;
        narrationStyle = composed.narrationStyle;
      }
    }

    const data: Prisma.ChannelProfileUpdateInput = {
      masterPrompt,
      writingStyle,
      narrationStyle,
      ...(styleProfileJson !== undefined ? { styleProfile: styleProfileJson } : {}),
      language: dto.language,
      voiceSettings: dto.voiceSettings as Prisma.InputJsonValue | undefined,
      titleTemplate: dto.titleTemplate,
      descriptionTemplate: dto.descriptionTemplate,
      thumbnailReferencePrompt: dto.thumbnailReferencePrompt,
      animationReferencePrompt: dto.animationReferencePrompt,
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

  /** Handle the Google callback; returns account id + contentType for post-connect redirect. */
  async googleCallback(
    code: string,
    state: string,
  ): Promise<{ id: string; contentType: WizardChoices['contentType'] }> {
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
    return { id: view.id, contentType: payload.wizard.contentType };
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

  // --- Manual connection (Phase 10) -----------------------------------------

  async connectManual(
    dto: {
      platform: Platform;
      name: string;
      handle?: string;
      externalId?: string;
      contentType: WizardChoices['contentType'];
      dramasEnabled: boolean;
      schedulingPrefs?: SchedulingPrefs;
    },
    addedById: string,
  ): Promise<AccountView> {
    // Synthesise a unique-per-account external id when the Owner doesn't
    // supply one — keeps `(platform, externalId)` unique constraints happy.
    const externalId = dto.externalId?.trim() || `manual-${dto.platform.toLowerCase()}-${Date.now().toString(36)}`;

    return this.createAccountWithProfile({
      platform: dto.platform,
      kind: KIND_BY_PLATFORM[dto.platform],
      externalId,
      name: dto.name.trim(),
      handle: dto.handle?.trim() || null,
      avatarUrl: null,
      connectionMethod: 'MANUAL',
      // No tokens — the Owner uploads by hand.
      authPayload: { provider: 'manual' },
      tokenExpiresAt: null,
      contentType: dto.contentType,
      dramasEnabled: dto.dramasEnabled,
      schedulingPrefs: dto.schedulingPrefs,
      addedById,
    });
  }

  // --- TikTok OAuth ---------------------------------------------------------

  async tiktokStartUrl(userId: string, wizard: WizardChoices): Promise<string> {
    const cfg = await this.tiktok.getConfig();
    const state = signState({ userId, provider: 'tiktok', wizard }, this.sessionSecret());
    return this.tiktok.buildAuthUrl({
      clientKey: cfg.clientKey,
      redirectUri: this.redirectUri('tiktok'),
      state,
    });
  }

  /** Handle the TikTok callback; returns account id + contentType for post-connect redirect. */
  async tiktokCallback(
    code: string,
    state: string,
  ): Promise<{ id: string; contentType: WizardChoices['contentType'] }> {
    const payload = verifyState<{ userId: string; wizard: WizardChoices }>(
      state,
      this.sessionSecret(),
    );
    if (!payload) throw new BadRequestException('Invalid or expired OAuth state.');

    const bundle = await this.tiktok.exchangeCode(code, this.redirectUri('tiktok'));
    const user = await this.tiktok.fetchUserInfo(bundle.accessToken);

    const view = await this.createAccountWithProfile({
      platform: 'TIKTOK',
      kind: 'TIKTOK_ACCOUNT',
      externalId: user.openId,
      name: user.displayName,
      handle: null,
      avatarUrl: user.avatarUrl,
      connectionMethod: 'OWN_APP',
      authPayload: this.tiktokAuthPayload(bundle),
      tokenExpiresAt: new Date(bundle.expiryDate),
      contentType: payload.wizard.contentType,
      dramasEnabled: payload.wizard.dramasEnabled,
      schedulingPrefs: payload.wizard.schedulingPrefs,
      addedById: payload.userId,
    });
    return { id: view.id, contentType: payload.wizard.contentType };
  }

  private tiktokAuthPayload(bundle: TikTokTokenBundle): Record<string, unknown> {
    return {
      provider: 'tiktok',
      accessToken: bundle.accessToken,
      refreshToken: bundle.refreshToken,
      openId: bundle.openId,
      scope: bundle.scope,
      tokenType: bundle.tokenType,
      expiryDate: bundle.expiryDate,
    };
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
        profile: {
          create: {
            schedulingPrefs: scheduling,
            voiceSettings: defaultVoiceForLanguage('en') as unknown as Prisma.InputJsonValue,
          },
        },
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
        data: {
          accountId: row.id,
          schedulingPrefs: scheduling,
          voiceSettings: defaultVoiceForLanguage('en') as unknown as Prisma.InputJsonValue,
        },
      });
      return toAccountView(await this.loadActive(row.id));
    }
    return toAccountView(row);
  }

  private redirectUri(provider: 'google' | 'meta' | 'tiktok'): string {
    const web = this.config.get<string>('webAppUrl');
    return `${web}/api/v1/accounts/connect/${provider}/callback`;
  }

  private sessionSecret(): string {
    const s = this.config.get<string>('sessionSecret');
    if (!s) throw new BadRequestException('SESSION_SECRET is not configured.');
    return s;
  }
}
