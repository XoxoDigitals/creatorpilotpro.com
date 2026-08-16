import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SettingsService } from '../../system/settings.service';

/**
 * Google OAuth for YouTube (own-app path). Requests analytics + monetary
 * read scopes always; with `directUpload` also requests full `youtube` manage
 * (upload, thumbnails, metadata).
 */

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  directUpload?: boolean;
}

export interface GoogleTokenBundle {
  accessToken: string;
  refreshToken: string | null;
  scope: string;
  tokenType: string;
  /** epoch ms */
  expiryDate: number;
}

export interface YouTubeChannelInfo {
  channelId: string;
  title: string;
  handle: string | null;
  thumbnailUrl: string | null;
}

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const CHANNELS_ENDPOINT =
  'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true';

const READONLY_SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
];
/** Full manage + upload + thumbnails (includes upload + readonly capabilities). */
const MANAGE_SCOPE = 'https://www.googleapis.com/auth/youtube';
const UPLOAD_SCOPE = 'https://www.googleapis.com/auth/youtube.upload';

@Injectable()
export class GoogleOAuthService {
  fetchImpl: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

  constructor(private readonly settings: SettingsService) {}

  async getConfig(): Promise<GoogleConfig> {
    const cfg = await this.settings.getDecrypted<GoogleConfig>('platform_apps.google');
    if (!cfg?.clientId || !cfg?.clientSecret) {
      throw new BadRequestException(
        'Google app is not configured. Add the Client ID/Secret in Settings → Platform Apps.',
      );
    }
    return cfg;
  }

  scopesFor(cfg: GoogleConfig): string[] {
    // Always request analytics scopes so channel metrics sync works after connect.
    // With direct upload: full `youtube` manage (upload + thumbnails + metadata).
    if (cfg.directUpload) {
      return [MANAGE_SCOPE, UPLOAD_SCOPE, ...READONLY_SCOPES.filter((s) => s.includes('yt-analytics'))];
    }
    return [...READONLY_SCOPES];
  }

  buildAuthUrl(params: {
    clientId: string;
    redirectUri: string;
    scopes: string[];
    state: string;
  }): string {
    const q = new URLSearchParams({
      client_id: params.clientId,
      redirect_uri: params.redirectUri,
      response_type: 'code',
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      scope: params.scopes.join(' '),
      state: params.state,
    });
    return `${AUTH_ENDPOINT}?${q.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<GoogleTokenBundle> {
    const cfg = await this.getConfig();
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`Google token exchange failed (${res.status})`);
    }
    const t = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      scope: string;
      token_type: string;
      expires_in: number;
    };
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      scope: t.scope,
      tokenType: t.token_type,
      expiryDate: Date.now() + t.expires_in * 1000,
    };
  }

  /** Refresh an access token from a stored refresh token (maintenance job). */
  async refresh(refreshToken: string): Promise<GoogleTokenBundle> {
    const cfg = await this.getConfig();
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`Google token refresh failed (${res.status})`);
    }
    const t = (await res.json()) as {
      access_token: string;
      scope: string;
      token_type: string;
      expires_in: number;
    };
    return {
      accessToken: t.access_token,
      refreshToken, // Google does not re-issue the refresh token on refresh
      scope: t.scope,
      tokenType: t.token_type,
      expiryDate: Date.now() + t.expires_in * 1000,
    };
  }

  async fetchChannel(accessToken: string): Promise<YouTubeChannelInfo> {
    const res = await this.fetchImpl(CHANNELS_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`YouTube channel lookup failed (${res.status})`);
    }
    const data = (await res.json()) as {
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          customUrl?: string;
          thumbnails?: { default?: { url?: string }; medium?: { url?: string } };
        };
      }>;
    };
    const item = data.items?.[0];
    if (!item) {
      throw new BadRequestException('No YouTube channel is associated with this Google account.');
    }
    const snip = item.snippet ?? {};
    return {
      channelId: item.id,
      title: snip.title ?? 'YouTube channel',
      handle: snip.customUrl ?? null,
      thumbnailUrl: snip.thumbnails?.medium?.url ?? snip.thumbnails?.default?.url ?? null,
    };
  }
}
