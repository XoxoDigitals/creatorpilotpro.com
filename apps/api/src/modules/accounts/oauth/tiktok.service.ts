import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SettingsService } from '../../system/settings.service';

/**
 * TikTok OAuth 2.0 (Login Kit + Content Posting API scopes).
 *
 * Authorize: https://www.tiktok.com/v2/auth/authorize/?client_key=...&scope=user.info.basic,video.upload,video.publish&response_type=code&redirect_uri=...&state=...
 * Token:     https://open.tiktokapis.com/v2/oauth/token/  (client_key, client_secret, code, grant_type=authorization_code, redirect_uri)
 * User info: https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url
 *
 * Access tokens are relatively short-lived (~24 h); refresh tokens are long-lived (~365 d).
 */

export interface TikTokConfig {
  clientKey: string;
  clientSecret: string;
}

export interface TikTokTokenBundle {
  accessToken: string;
  refreshToken: string | null;
  openId: string;
  scope: string;
  tokenType: string;
  expiryDate: number; // epoch ms
}

export interface TikTokUserInfo {
  openId: string;
  unionId: string | null;
  displayName: string;
  avatarUrl: string | null;
}

const AUTH_ENDPOINT = 'https://www.tiktok.com/v2/auth/authorize/';
const TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
const USER_INFO_ENDPOINT =
  'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,display_name,avatar_url';

const SCOPES = ['user.info.basic', 'video.upload', 'video.publish'];

@Injectable()
export class TikTokOAuthService {
  fetchImpl: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

  constructor(private readonly settings: SettingsService) {}

  async getConfig(): Promise<TikTokConfig> {
    const cfg = await this.settings.getDecrypted<TikTokConfig>('platform_apps.tiktok');
    if (!cfg?.clientKey || !cfg?.clientSecret) {
      throw new BadRequestException(
        'TikTok app is not configured. Add the Client Key/Secret in Settings → Platform Apps.',
      );
    }
    return cfg;
  }

  buildAuthUrl(params: {
    clientKey: string;
    redirectUri: string;
    state: string;
  }): string {
    const q = new URLSearchParams({
      client_key: params.clientKey,
      response_type: 'code',
      scope: SCOPES.join(','),
      redirect_uri: params.redirectUri,
      state: params.state,
    });
    return `${AUTH_ENDPOINT}?${q.toString()}`;
  }

  async exchangeCode(code: string, redirectUri: string): Promise<TikTokTokenBundle> {
    const cfg = await this.getConfig();
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cache-control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: cfg.clientKey,
        client_secret: cfg.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`TikTok token exchange failed (${res.status})`);
    }
    const t = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      open_id: string;
      scope: string;
      token_type: string;
      expires_in: number;
      error?: string;
      error_description?: string;
    };
    if (t.error) {
      throw new BadRequestException(`TikTok token error: ${t.error} — ${t.error_description ?? ''}`);
    }
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      openId: t.open_id,
      scope: t.scope,
      tokenType: t.token_type,
      expiryDate: Date.now() + t.expires_in * 1000,
    };
  }

  async refresh(refreshToken: string): Promise<TikTokTokenBundle> {
    const cfg = await this.getConfig();
    const res = await this.fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'cache-control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: cfg.clientKey,
        client_secret: cfg.clientSecret,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }).toString(),
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`TikTok token refresh failed (${res.status})`);
    }
    const t = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      open_id: string;
      scope: string;
      token_type: string;
      expires_in: number;
    };
    return {
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? refreshToken,
      openId: t.open_id,
      scope: t.scope,
      tokenType: t.token_type,
      expiryDate: Date.now() + t.expires_in * 1000,
    };
  }

  async fetchUserInfo(accessToken: string): Promise<TikTokUserInfo> {
    const res = await this.fetchImpl(USER_INFO_ENDPOINT, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`TikTok user info lookup failed (${res.status})`);
    }
    const body = (await res.json()) as {
      data?: {
        user?: {
          open_id?: string;
          union_id?: string;
          display_name?: string;
          avatar_url?: string;
        };
      };
    };
    const u = body.data?.user;
    if (!u?.open_id) {
      throw new BadRequestException('TikTok user info response missing open_id.');
    }
    return {
      openId: u.open_id,
      unionId: u.union_id ?? null,
      displayName: u.display_name ?? 'TikTok account',
      avatarUrl: u.avatar_url ?? null,
    };
  }
}
