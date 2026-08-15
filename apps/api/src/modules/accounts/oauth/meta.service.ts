import { randomBytes } from 'node:crypto';
import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SettingsService } from '../../system/settings.service';
import type { WizardChoices } from '../dto/account.dto';

/**
 * Meta (Facebook) OAuth for Page Reels publishing (docs/06 §2). Uses Facebook
 * Login for Business. Exchanges the code for a long-lived user token, lists the
 * user's managed Pages, then the owner picks one — the Page access token (kept
 * server-side, never sent to the browser) is stored encrypted on connect.
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
const SESSION_TTL_MS = 15 * 60 * 1000;
const META_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'business_management',
];

@Injectable()
export class MetaOAuthService {
  fetchImpl: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

  /** Transient store keyed by a random session id. Tokens never leave the server. */
  private readonly pending = new Map<string, PendingSession>();

  constructor(private readonly settings: SettingsService) {}

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

  /** Stash a page-picker session and return its opaque id. */
  createPendingSession(userId: string, pages: MetaPage[], wizard: WizardChoices): string {
    this.sweep();
    const id = randomBytes(18).toString('base64url');
    this.pending.set(id, { userId, pages, wizard, expiresAt: Date.now() + SESSION_TTL_MS });
    return id;
  }

  /** Page list for the picker UI — tokens stripped. */
  getPendingPages(
    sessionId: string,
  ): Array<{ id: string; name: string; avatarUrl: string | null; fanCount: number }> {
    const s = this.pending.get(sessionId);
    if (!s || s.expiresAt < Date.now()) return [];
    return s.pages.map((p) => ({
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      fanCount: p.fanCount,
    }));
  }

  /**
   * Resolve one or more chosen pages (with tokens + wizard choices) and consume
   * the session. All `pageIds` must exist in the pending list.
   */
  consumePages(
    sessionId: string,
    userId: string,
    pageIds: string[],
  ): { pages: MetaPage[]; wizard: WizardChoices } | null {
    const s = this.pending.get(sessionId);
    if (!s || s.expiresAt < Date.now() || s.userId !== userId) return null;
    if (pageIds.length === 0) return null;
    const pages: MetaPage[] = [];
    for (const id of pageIds) {
      const page = s.pages.find((p) => p.id === id);
      if (!page) return null;
      pages.push(page);
    }
    this.pending.delete(sessionId);
    return { pages, wizard: s.wizard };
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

  private sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expiresAt < now) this.pending.delete(k);
  }
}
