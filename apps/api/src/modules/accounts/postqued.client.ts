import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { SettingsService } from '../system/settings.service';

/**
 * PostQued API v2 client (docs/06 §2, docs/specs/postqued-openapi.json).
 *
 * Auth: the owner creates an API key (`pq_…`) once in the PostQued dashboard and
 * pastes it into Settings → Platform Apps (`platform_apps.postqued.apiKey`,
 * encrypted). The programmatic header name is NOT pinned by the spec (which
 * documents cookie sessions for the dashboard UI), so on first use we probe
 * `GET /v2/ping` with both `Authorization: Bearer` and `x-api-key` and remember
 * whichever authenticates — see docs mission "PostQued auth-header finding".
 */

export type PqHeaderStyle = 'bearer' | 'x-api-key';

/** PlatformAccount shape from the OpenAPI spec (#/components/schemas/PlatformAccount). */
export interface PqPlatformAccount {
  id: string;
  platform: string;
  externalAccountId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  accountStatus: string;
  createdAt: string;
}

@Injectable()
export class PostQuedClient {
  readonly baseUrl = process.env.POSTQUED_BASE_URL ?? 'https://api.postqued.com';

  /** Overridable for tests. Defaults to the platform global fetch (Node 24). */
  fetchImpl: typeof globalThis.fetch = (...args) => globalThis.fetch(...args);

  /** Per-key cache of the working header style, avoids re-probing every call. */
  private readonly headerStyleCache = new Map<string, PqHeaderStyle>();

  constructor(private readonly settings: SettingsService) {}

  /** Read + decrypt the configured API key, or 400 if the owner hasn't set it. */
  async getApiKey(): Promise<string> {
    const cfg = await this.settings.getDecrypted<{ apiKey?: string }>('platform_apps.postqued');
    if (!cfg?.apiKey) {
      throw new BadRequestException(
        'PostQued API key is not configured. Add it in Settings → Platform Apps.',
      );
    }
    return cfg.apiKey;
  }

  private authHeaders(apiKey: string, style: PqHeaderStyle): Record<string, string> {
    return style === 'bearer' ? { Authorization: `Bearer ${apiKey}` } : { 'x-api-key': apiKey };
  }

  /**
   * Probe `GET /v2/ping` with each header style; cache and return the one that
   * authenticates. Throws ServiceUnavailable if neither works.
   */
  async detectHeaderStyle(apiKey: string): Promise<PqHeaderStyle> {
    const cached = this.headerStyleCache.get(apiKey);
    if (cached) return cached;

    const styles: PqHeaderStyle[] = ['bearer', 'x-api-key'];
    for (const style of styles) {
      try {
        const res = await this.fetchImpl(`${this.baseUrl}/v2/ping`, {
          method: 'GET',
          headers: { accept: 'application/json', ...this.authHeaders(apiKey, style) },
        });
        if (res.ok) {
          this.headerStyleCache.set(apiKey, style);
          return style;
        }
      } catch {
        /* try the next style */
      }
    }
    throw new ServiceUnavailableException(
      'Could not authenticate with PostQued (GET /v2/ping failed for both header styles). Verify the API key.',
    );
  }

  private async requestJson<T>(path: string, apiKey: string, style: PqHeaderStyle): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: { accept: 'application/json', ...this.authHeaders(apiKey, style) },
    });
    if (!res.ok) {
      throw new ServiceUnavailableException(`PostQued request failed (${res.status}) for ${path}`);
    }
    return (await res.json()) as T;
  }

  /**
   * List platform accounts connected to the active (or given) PostQued workspace.
   * Account linking happens inside PostQued's dashboard; we only import the ids.
   */
  async listIntegrations(workspaceId?: string): Promise<PqPlatformAccount[]> {
    const apiKey = await this.getApiKey();
    const style = await this.detectHeaderStyle(apiKey);
    const qs = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : '';
    const data = await this.requestJson<{ accounts?: PqPlatformAccount[] }>(
      `/v2/integrations${qs}`,
      apiKey,
      style,
    );
    return data.accounts ?? [];
  }
}
