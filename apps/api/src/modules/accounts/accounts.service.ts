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
import { QueueProducer } from '../../common/queue/queue.producer';
import type { SessionUser } from '../../common/session/session.types';
import { GoogleOAuthService, type GoogleTokenBundle } from './oauth/google.service';
import { MetaOAuthService } from './oauth/meta.service';
import { TikTokOAuthService, type TikTokTokenBundle } from './oauth/tiktok.service';
import { signState, verifyState } from './oauth/oauth-state.util';
import {
  type AccountView,
  toAccountView,
} from './account.view';
import type {
  MetaConnectDto,
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
  randomizeMinutes: 0,
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
  /** When true, refresh tokens on an already-connected account instead of 409. */
  allowReconnect?: boolean;
  timezone?: string;
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
    private readonly queue: QueueProducer,
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
    const metrics = await this.listCardMetrics(rows);
    return rows.map((r) => toAccountView(r, metrics.get(r.id)));
  }

  async get(id: string, actor: SessionUser): Promise<AccountView> {
    await this.accountAccess.assertCanAccess(actor, id);
    const row = await this.loadActive(id);
    const metrics = await this.listCardMetrics([row]);
    return toAccountView(row, metrics.get(id));
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
    const metrics = await this.listCardMetrics([row]);
    return toAccountView(row, metrics.get(id));
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
    const metrics = await this.listCardMetrics([row]);
    return toAccountView(row, metrics.get(id));
  }

  async softDelete(id: string): Promise<{ id: string; deleted: true }> {
    await this.loadActive(id);
    await this.prisma.client.socialAccount.update({
      where: { id },
      data: { deletedAt: new Date(), paused: true },
    });
    return { id, deleted: true };
  }

  /**
   * Save a reaction-avatar image/clip under STORAGE_ROOT/accounts/{id}/ and
   * record the relative path on voiceSettings.renderSettings.reactionAvatar.
   */
  async saveReactionAvatar(
    id: string,
    input: {
      filename: string;
      mimeType?: string;
      stream: NodeJS.ReadableStream;
      isTruncated: () => boolean;
    },
  ): Promise<AccountView> {
    await this.loadActive(id);
    const root = process.env.STORAGE_ROOT?.trim();
    if (!root) {
      throw new BadRequestException('STORAGE_ROOT is not configured on the API host.');
    }
    const ext = (() => {
      const fromName = input.filename.includes('.')
        ? input.filename.slice(input.filename.lastIndexOf('.')).toLowerCase()
        : '';
      if (/\.(png|jpe?g|webp|gif|mp4|webm|mov|m4v)$/i.test(fromName)) return fromName;
      const mt = (input.mimeType ?? '').toLowerCase();
      if (mt.includes('png')) return '.png';
      if (mt.includes('jpeg') || mt.includes('jpg')) return '.jpg';
      if (mt.includes('webp')) return '.webp';
      if (mt.includes('mp4')) return '.mp4';
      if (mt.includes('webm')) return '.webm';
      throw new BadRequestException('Use a PNG/JPG/WebP image or a short MP4/WebM clip.');
    })();

    const { mkdir, unlink, readdir } = await import('node:fs/promises');
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const { join } = await import('node:path');

    const dir = join(root, 'accounts', id);
    await mkdir(dir, { recursive: true });
    // Clear previous reaction-avatar.* files for this account.
    try {
      const existing = await readdir(dir);
      for (const name of existing) {
        if (/^reaction-avatar\./i.test(name)) {
          await unlink(join(dir, name)).catch(() => {});
        }
      }
    } catch {
      /* empty dir */
    }

    const fileName = `reaction-avatar${ext}`;
    const abs = join(dir, fileName);
    const rel = `accounts/${id}/${fileName}`.replace(/\\/g, '/');
    await pipeline(input.stream, createWriteStream(abs));
    if (input.isTruncated()) {
      await unlink(abs).catch(() => {});
      throw new BadRequestException('Upload truncated — file too large.');
    }

    const profile = await this.prisma.client.channelProfile.findUnique({
      where: { accountId: id },
    });
    if (!profile) throw new NotFoundException('Channel profile not found.');
    const voice =
      profile.voiceSettings && typeof profile.voiceSettings === 'object' && !Array.isArray(profile.voiceSettings)
        ? { ...(profile.voiceSettings as Record<string, unknown>) }
        : {};
    const render =
      voice.renderSettings && typeof voice.renderSettings === 'object' && !Array.isArray(voice.renderSettings)
        ? { ...(voice.renderSettings as Record<string, unknown>) }
        : {};
    const prevAvatar =
      render.reactionAvatar && typeof render.reactionAvatar === 'object' && !Array.isArray(render.reactionAvatar)
        ? { ...(render.reactionAvatar as Record<string, unknown>) }
        : {};
    render.reactionAvatar = {
      ...prevAvatar,
      enabled: true,
      assetPath: rel,
      fileName: input.filename || fileName,
      mimeType: input.mimeType || undefined,
      shape: typeof prevAvatar.shape === 'string' ? prevAvatar.shape : 'circle',
      corner: typeof prevAvatar.corner === 'string' ? prevAvatar.corner : 'br',
      sizePercent: typeof prevAvatar.sizePercent === 'number' ? prevAvatar.sizePercent : 22,
      showDuring: typeof prevAvatar.showDuring === 'string' ? prevAvatar.showDuring : 'dialogue',
    };
    voice.renderSettings = render;
    await this.prisma.client.channelProfile.update({
      where: { accountId: id },
      data: { voiceSettings: voice as Prisma.InputJsonValue },
    });
    const row = await this.loadActive(id);
    const metrics = await this.listCardMetrics([row]);
    return toAccountView(row, metrics.get(id));
  }

  async clearReactionAvatar(id: string): Promise<AccountView> {
    await this.loadActive(id);
    const root = process.env.STORAGE_ROOT?.trim();
    const profile = await this.prisma.client.channelProfile.findUnique({
      where: { accountId: id },
    });
    if (!profile) throw new NotFoundException('Channel profile not found.');
    const voice =
      profile.voiceSettings && typeof profile.voiceSettings === 'object' && !Array.isArray(profile.voiceSettings)
        ? { ...(profile.voiceSettings as Record<string, unknown>) }
        : {};
    const render =
      voice.renderSettings && typeof voice.renderSettings === 'object' && !Array.isArray(voice.renderSettings)
        ? { ...(voice.renderSettings as Record<string, unknown>) }
        : {};
    const prevAvatar =
      render.reactionAvatar && typeof render.reactionAvatar === 'object' && !Array.isArray(render.reactionAvatar)
        ? { ...(render.reactionAvatar as Record<string, unknown>) }
        : {};
    const assetPath = typeof prevAvatar.assetPath === 'string' ? prevAvatar.assetPath : null;
    if (root && assetPath) {
      const { unlink } = await import('node:fs/promises');
      const { join } = await import('node:path');
      await unlink(join(root, assetPath.replace(/^[/\\]+/, ''))).catch(() => {});
    }
    render.reactionAvatar = {
      enabled: false,
      shape: typeof prevAvatar.shape === 'string' ? prevAvatar.shape : 'circle',
      corner: typeof prevAvatar.corner === 'string' ? prevAvatar.corner : 'br',
      sizePercent: typeof prevAvatar.sizePercent === 'number' ? prevAvatar.sizePercent : 22,
      showDuring: typeof prevAvatar.showDuring === 'string' ? prevAvatar.showDuring : 'dialogue',
    };
    voice.renderSettings = render;
    await this.prisma.client.channelProfile.update({
      where: { accountId: id },
      data: { voiceSettings: voice as Prisma.InputJsonValue },
    });
    const row = await this.loadActive(id);
    const metrics = await this.listCardMetrics([row]);
    return toAccountView(row, metrics.get(id));
  }

  /** Absolute path to the reaction avatar file when present on disk. */
  async reactionAvatarLocalPath(id: string): Promise<{ path: string; mimeType: string } | null> {
    await this.loadActive(id);
    const root = process.env.STORAGE_ROOT?.trim();
    if (!root) return null;
    const profile = await this.prisma.client.channelProfile.findUnique({
      where: { accountId: id },
      select: { voiceSettings: true },
    });
    const voice = (profile?.voiceSettings ?? {}) as Record<string, unknown>;
    const render = (voice.renderSettings ?? {}) as Record<string, unknown>;
    const avatar = (render.reactionAvatar ?? {}) as Record<string, unknown>;
    const assetPath = typeof avatar.assetPath === 'string' ? avatar.assetPath : null;
    if (!assetPath) return null;
    const { access } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const abs = join(root, assetPath.replace(/^[/\\]+/, ''));
    try {
      await access(abs);
    } catch {
      return null;
    }
    const mime =
      typeof avatar.mimeType === 'string' && avatar.mimeType
        ? avatar.mimeType
        : abs.toLowerCase().endsWith('.png')
          ? 'image/png'
          : abs.toLowerCase().endsWith('.webp')
            ? 'image/webp'
            : abs.toLowerCase().endsWith('.mp4')
              ? 'video/mp4'
              : abs.toLowerCase().endsWith('.webm')
                ? 'video/webm'
                : 'image/jpeg';
    return { path: abs, mimeType: mime };
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
    const session = await this.meta.createPendingSession(payload.userId, pages, payload.wizard);
    const web = this.config.get<string>('webAppUrl');
    return { redirectTo: `${web}/accounts/connect/meta?session=${encodeURIComponent(session)}` };
  }

  async getMetaPendingPages(
    sessionId: string,
  ): Promise<
    Array<{
      id: string;
      name: string;
      avatarUrl: string | null;
      fanCount: number;
      alreadyConnected: boolean;
    }>
  > {
    const pages = await this.meta.getPendingPages(sessionId);
    if (pages.length === 0) return [];
    const connected = await this.prisma.client.socialAccount.findMany({
      where: {
        platform: 'FACEBOOK',
        deletedAt: null,
        externalId: { in: pages.map((p) => p.id) },
      },
      select: { externalId: true },
    });
    const connectedIds = new Set(connected.map((c) => c.externalId));
    return pages.map((p) => ({
      ...p,
      alreadyConnected: connectedIds.has(p.id),
    }));
  }

  async connectMeta(
    dto: MetaConnectDto,
    userId: string,
  ): Promise<{ accounts: AccountView[] }> {
    const pageIds = dto.pageIds?.length
      ? [...new Set(dto.pageIds)]
      : dto.pageId
        ? [dto.pageId]
        : [];
    const resolved = await this.meta.peekPages(dto.session, userId, pageIds);
    if (!resolved) {
      throw new BadRequestException('That page-picker session has expired. Reconnect the account.');
    }

    // Ignore Pages that are already connected (UI disables them; don't recreate).
    const existing = await this.prisma.client.socialAccount.findMany({
      where: {
        platform: 'FACEBOOK',
        deletedAt: null,
        externalId: { in: resolved.pages.map((p) => p.id) },
      },
      select: { externalId: true },
    });
    const already = new Set(existing.map((e) => e.externalId));
    const pagesToConnect = resolved.pages.filter((p) => !already.has(p.id));
    if (pagesToConnect.length === 0) {
      throw new BadRequestException(
        'All selected Pages are already connected. Pick a Page that is not connected yet.',
      );
    }

    const accounts: AccountView[] = [];
    for (const page of pagesToConnect) {
      const view = await this.createAccountWithProfile({
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
        timezone: dto.timezone,
      });
      if (page.fanCount > 0) {
        await this.upsertFollowersSnapshot(view.id, page.fanCount);
      }
      void this.queue.enqueueAccountSync(view.id);
      accounts.push({ ...view, followers: page.fanCount });
    }
    // Only consume the picker session after all pages connect successfully.
    await this.meta.deletePendingSession(dto.session);
    return { accounts };
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
    if (existing && existing.deletedAt === null && !params.allowReconnect) {
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
        timezone: params.timezone?.trim() || 'Asia/Karachi',
        profile: {
          create: {
            schedulingPrefs: scheduling,
            voiceSettings: defaultVoiceForLanguage('en') as unknown as Prisma.InputJsonValue,
          },
        },
      },
      update: {
        // Re-importing a previously disconnected account, or refreshing Meta tokens.
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
        ...(params.timezone?.trim() ? { timezone: params.timezone.trim() } : {}),
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

  /** Latest metric_snapshot_account.followers per account (by date desc). */
  private async latestFollowersMap(accountIds: string[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (accountIds.length === 0) return map;
    const snaps = await this.prisma.client.metricSnapshotAccount.findMany({
      where: { accountId: { in: accountIds } },
      orderBy: { date: 'desc' },
      distinct: ['accountId'],
      select: { accountId: true, followers: true },
    });
    for (const s of snaps) map.set(s.accountId, s.followers);
    return map;
  }

  /**
   * Card metrics for the Accounts list: followers (refresh FB fan_count when still
   * zero), views summed over the last 30 days, and scheduled publish count.
   */
  private async listCardMetrics(
    rows: SocialAccount[],
  ): Promise<Map<string, { followers: number; views30d: number; scheduledCount: number }>> {
    const out = new Map<string, { followers: number; views30d: number; scheduledCount: number }>();
    if (rows.length === 0) return out;

    const ids = rows.map((r) => r.id);
    const followers = await this.latestFollowersMap(ids);

    // Backfill Facebook fan_count for connected pages that still show 0.
    await Promise.all(
      rows.map(async (row) => {
        if (row.platform !== 'FACEBOOK') return;
        const current = followers.get(row.id) ?? 0;
        if (current > 0 || !row.authPayload) return;
        const fan = await this.refreshFacebookFanCount(row);
        if (fan !== null) followers.set(row.id, fan);
      }),
    );

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - 30);
    since.setUTCHours(0, 0, 0, 0);

    const [viewGroups, scheduledGroups] = await Promise.all([
      this.prisma.client.metricSnapshotAccount.groupBy({
        by: ['accountId'],
        where: { accountId: { in: ids }, date: { gte: since } },
        _sum: { views: true },
      }),
      this.prisma.client.publishTarget.groupBy({
        by: ['accountId'],
        where: { accountId: { in: ids }, status: 'SCHEDULED' },
        _count: { id: true },
      }),
    ]);

    const viewsMap = new Map(viewGroups.map((g) => [g.accountId, g._sum.views ?? 0]));
    const scheduledMap = new Map(scheduledGroups.map((g) => [g.accountId, g._count.id]));

    for (const id of ids) {
      out.set(id, {
        followers: followers.get(id) ?? 0,
        views30d: viewsMap.get(id) ?? 0,
        scheduledCount: scheduledMap.get(id) ?? 0,
      });
    }
    return out;
  }

  private async refreshFacebookFanCount(row: SocialAccount): Promise<number | null> {
    try {
      const auth = JSON.parse(this.crypto.decrypt(row.authPayload!)) as {
        pageId?: string;
        pageAccessToken?: string;
      };
      const pageId = typeof auth.pageId === 'string' ? auth.pageId : row.externalId;
      const token = typeof auth.pageAccessToken === 'string' ? auth.pageAccessToken : null;
      if (!pageId || !token) return null;
      const fan = await this.meta.fetchFanCount(pageId, token);
      if (fan === null) return null;
      await this.upsertFollowersSnapshot(row.id, fan);
      return fan;
    } catch {
      return null;
    }
  }

  private async upsertFollowersSnapshot(accountId: string, followers: number): Promise<void> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    await this.prisma.client.metricSnapshotAccount.upsert({
      where: { accountId_date: { accountId, date: today } },
      create: {
        accountId,
        date: today,
        followers,
        syncedAt: new Date(),
      },
      update: {
        followers,
        syncedAt: new Date(),
      },
    });
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
