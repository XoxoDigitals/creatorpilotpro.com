import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { SettingsService } from '../../system/settings.service';
import type { WizardChoices } from '../dto/account.dto';

/**
 * Meta (Facebook) OAuth for Page Reels publishing (docs/06 §2). Uses Facebook
 * Login for Business. Exchanges the code for a long-lived user token, lists the
 * user's managed Pages, then the owner picks one — the Page access token (kept
 * server-side, never sent to the browser) is stored encrypted on connect.
 *
 * Pending page-picker sessions are persisted in `system_settings` (encrypted)
 * so they survive API restarts / multi-process deploys. An in-memory cache is
 * only a fast path.
 */

export interface MetaConfig {
  appId: string;
  appSecret: string;
}

export interface MetaPage {
  id: string;
  name: string;
  avatarUrl: string | null;
  accessToken: string;
  /** Page likes / fans from Graph `fan_count` (0 when Meta omits it). */
  fanCount: number;
}

/** A pending page-picker session: candidate Pages + the wizard choices + actor. */
interface PendingSession {
  userId: string;
  pages: MetaPage[];
  wizard: WizardChoices;
  expiresAt: number;
}

const GRAPH = 'https://graph.facebook.com/v21.0';
const DIALOG = 'https://www.facebook.com/v21.0/dialog/oauth';
/** Longer TTL — multi-select + deploy restarts used to wipe 15m memory sessions. */
const SESSION_TTL_MS = 60 * 60 * 1000;
const PENDING_KEY_PREFIX = 'meta_oauth_pending:';
const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'read_insights',
  'business_management',
];

@Injectable()
export class MetaOAuthService {
  fetchImpl: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

  /** Hot cache; durable copy lives in system_settings. */
  private readonly pending = new Map<string, PendingSession>();

  constructor(
    private readonly settings: SettingsService,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  async getConfig(): Promise<MetaConfig> {
    const cfg = await this.settings.getDecrypted<MetaConfig>('platform_apps.meta');
    if (!cfg?.appId || !cfg?.appSecret) {
      throw new BadRequestException(
        'Meta app is not configured. Add the App ID/Secret in Settings → Platform Apps.',
      );
    }
    return cfg;
  }

  buildAuthUrl(params: { appId: string; redirectUri: string; state: string }): string {
    const q = new URLSearchParams({
      client_id: params.appId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      scope: META_SCOPES.join(','),
      state: params.state,
    });
    return `${DIALOG}?${q.toString()}`;
  }

  /** Exchange code → short-lived, then short-lived → long-lived user token. */
  async exchangeCodeForLongLivedUserToken(code: string, redirectUri: string): Promise<string> {
    const cfg = await this.getConfig();
    const shortRes = await this.fetchImpl(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          client_id: cfg.appId,
          client_secret: cfg.appSecret,
          redirect_uri: redirectUri,
          code,
        }).toString(),
    );
    if (!shortRes.ok) {
      throw new ServiceUnavailableException(`Meta code exchange failed (${shortRes.status})`);
    }
    const short = (await shortRes.json()) as { access_token: string };

    const longRes = await this.fetchImpl(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: cfg.appId,
          client_secret: cfg.appSecret,
          fb_exchange_token: short.access_token,
        }).toString(),
    );
    if (!longRes.ok) {
      throw new ServiceUnavailableException(`Meta long-lived exchange failed (${longRes.status})`);
    }
    const long = (await longRes.json()) as { access_token: string };
    return long.access_token;
  }

  async listPages(userToken: string): Promise<MetaPage[]> {
    const res = await this.fetchImpl(
      `${GRAPH}/me/accounts?` +
        new URLSearchParams({
          fields: 'id,name,access_token,fan_count,picture{url}',
          access_token: userToken,
        }).toString(),
    );
    if (!res.ok) {
      throw new ServiceUnavailableException(`Meta /me/accounts failed (${res.status})`);
    }
    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        name: string;
        access_token: string;
        fan_count?: number;
        picture?: { data?: { url?: string } };
      }>;
    };
    return (data.data ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.picture?.data?.url ?? null,
      accessToken: p.access_token,
      fanCount: typeof p.fan_count === 'number' ? p.fan_count : 0,
    }));
  }

  /** Stash a page-picker session (DB + memory) and return its opaque id. */
  async createPendingSession(
    userId: string,
    pages: MetaPage[],
    wizard: WizardChoices,
  ): Promise<string> {
    await this.sweepExpired();
    const id = randomBytes(18).toString('base64url');
    const session: PendingSession = {
      userId,
      pages,
      wizard,
      expiresAt: Date.now() + SESSION_TTL_MS,
    };
    this.pending.set(id, session);
    await this.persistSession(id, session);
    return id;
  }

  /** Page list for the picker UI — tokens stripped. */
  async getPendingPages(
    sessionId: string,
  ): Promise<Array<{ id: string; name: string; avatarUrl: string | null; fanCount: number }>> {
    const s = await this.loadSession(sessionId);
    if (!s) return [];
    return s.pages.map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      fanCount: p.fanCount,
    }));
  }

  /**
   * Resolve chosen pages without deleting the session (so a mid-batch failure
   * can retry). Call {@link deletePendingSession} after a successful connect.
   */
  async peekPages(
    sessionId: string,
    userId: string,
    pageIds: string[],
  ): Promise<{ pages: MetaPage[]; wizard: WizardChoices } | null> {
    const s = await this.loadSession(sessionId);
    if (!s || s.userId !== userId) return null;
    if (pageIds.length === 0) return null;
    const pages: MetaPage[] = [];
    for (const id of pageIds) {
      const page = s.pages.find((p) => p.id === id);
      if (!page) return null;
      pages.push(page);
    }
    return { pages, wizard: s.wizard };
  }

  async deletePendingSession(sessionId: string): Promise<void> {
    this.pending.delete(sessionId);
    await this.prisma.client.systemSetting
      .delete({ where: { key: `${PENDING_KEY_PREFIX}${sessionId}` } })
      .catch(() => undefined);
  }

  /**
   * @deprecated Prefer peekPages + deletePendingSession so failures don't burn the session.
   */
  async consumePages(
    sessionId: string,
    userId: string,
    pageIds: string[],
  ): Promise<{ pages: MetaPage[]; wizard: WizardChoices } | null> {
    const resolved = await this.peekPages(sessionId, userId, pageIds);
    if (!resolved) return null;
    await this.deletePendingSession(sessionId);
    return resolved;
  }

  /** Page likes / fans for a single Page (null on API failure). */
  async fetchFanCount(pageId: string, pageAccessToken: string): Promise<number | null> {
    try {
      const res = await this.fetchImpl(
        `${GRAPH}/${encodeURIComponent(pageId)}?` +
          new URLSearchParams({ fields: 'fan_count', access_token: pageAccessToken }).toString(),
      );
      if (!res.ok) return null;
      const data = (await res.json()) as { fan_count?: number };
      return typeof data.fan_count === 'number' ? data.fan_count : null;
    } catch {
      return null;
    }
  }

  private async loadSession(sessionId: string): Promise<PendingSession | null> {
    if (!sessionId) return null;
    const mem = this.pending.get(sessionId);
    if (mem) {
      if (mem.expiresAt < Date.now()) {
        await this.deletePendingSession(sessionId);
        return null;
      }
      return mem;
    }

    const row = await this.prisma.client.systemSetting.findUnique({
      where: { key: `${PENDING_KEY_PREFIX}${sessionId}` },
    });
    if (!row) return null;
    const raw = row.value as { expiresAt?: number; userId?: string; wizard?: WizardChoices; pagesEnc?: string };
    if (!raw.expiresAt || raw.expiresAt < Date.now() || !raw.userId || !raw.pagesEnc || !raw.wizard) {
      await this.deletePendingSession(sessionId);
      return null;
    }
    try {
      const pages = JSON.parse(this.crypto.decrypt(raw.pagesEnc)) as MetaPage[];
      const session: PendingSession = {
        userId: raw.userId,
        pages,
        wizard: raw.wizard,
        expiresAt: raw.expiresAt,
      };
      this.pending.set(sessionId, session);
      return session;
    } catch {
      await this.deletePendingSession(sessionId);
      return null;
    }
  }

  private async persistSession(sessionId: string, session: PendingSession): Promise<void> {
    const pagesEnc = this.crypto.encrypt(JSON.stringify(session.pages));
    const value = {
      expiresAt: session.expiresAt,
      userId: session.userId,
      wizard: session.wizard,
      pagesEnc,
    };
    await this.prisma.client.systemSetting.upsert({
      where: { key: `${PENDING_KEY_PREFIX}${sessionId}` },
      create: { key: `${PENDING_KEY_PREFIX}${sessionId}`, value },
      update: { value },
    });
  }

  private async sweepExpired(): Promise<void> {
    const now = Date.now();
    for (const [k, v] of this.pending) {
      if (v.expiresAt < now) this.pending.delete(k);
    }
    const rows = await this.prisma.client.systemSetting.findMany({
      where: { key: { startsWith: PENDING_KEY_PREFIX } },
      select: { key: true, value: true },
    });
    for (const row of rows) {
      const expiresAt = (row.value as { expiresAt?: number }).expiresAt ?? 0;
      if (expiresAt < now) {
        await this.prisma.client.systemSetting.delete({ where: { key: row.key } }).catch(() => undefined);
      }
    }
  }
}
