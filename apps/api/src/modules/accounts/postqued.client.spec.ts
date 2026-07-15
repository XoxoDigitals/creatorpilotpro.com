import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { PostQuedClient } from './postqued.client';
import type { SettingsService } from '../system/settings.service';

/**
 * PostQued client tests against fixtures derived from the OpenAPI spec
 * (docs/specs/postqued-openapi.json — PlatformAccount schema + /v2/integrations).
 * No network: `fetchImpl` is stubbed. Covers the auth-header probe (docs mission
 * "PostQued auth-header finding") and integration parsing.
 */

// Fixture: /v2/integrations 200 body (PlatformAccount[]).
const INTEGRATIONS_FIXTURE = {
  accounts: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      platform: 'tiktok',
      externalAccountId: 'tt_ext_1',
      username: 'neon.drama',
      displayName: 'Neon Drama',
      avatarUrl: 'https://cdn.example/a.png',
      accountStatus: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      platform: 'youtube',
      externalAccountId: 'yt_ext_1',
      username: 'mindful',
      displayName: null,
      avatarUrl: null,
      accountStatus: 'active',
      createdAt: '2026-02-01T00:00:00.000Z',
    },
  ],
};

function makeSettings(apiKey: string | undefined): SettingsService {
  return {
    getDecrypted: vi.fn().mockResolvedValue(apiKey ? { apiKey } : undefined),
  } as unknown as SettingsService;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('PostQuedClient', () => {
  let client: PostQuedClient;

  beforeEach(() => {
    client = new PostQuedClient(makeSettings('pq_testkey_1234'));
  });

  it('throws a 400-style error when no API key is configured', async () => {
    const c = new PostQuedClient(makeSettings(undefined));
    await expect(c.getApiKey()).rejects.toThrow(/not configured/i);
  });

  it('detects the x-api-key header style when Bearer is rejected', async () => {
    const calls: Array<Record<string, string>> = [];
    client.fetchImpl = vi.fn(async (_url, init) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push(headers);
      // Bearer → 401, x-api-key → 200.
      if ('Authorization' in headers) return jsonResponse(401, { error: 'unauthorized' });
      return jsonResponse(200, { pong: 'it worked!' });
    }) as unknown as typeof fetch;

    const style = await client.detectHeaderStyle('pq_testkey_1234');
    expect(style).toBe('x-api-key');
    // Probed Bearer first, then x-api-key.
    expect(calls[0]).toHaveProperty('Authorization');
    expect(calls[1]).toHaveProperty('x-api-key');
  });

  it('prefers Bearer when it authenticates, and caches the style', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { pong: 'it worked!' }));
    client.fetchImpl = fetchMock as unknown as typeof fetch;

    expect(await client.detectHeaderStyle('pq_testkey_1234')).toBe('bearer');
    // Second call is served from cache — no extra fetch.
    expect(await client.detectHeaderStyle('pq_testkey_1234')).toBe('bearer');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws ServiceUnavailable when neither header style authenticates', async () => {
    client.fetchImpl = vi.fn(async () => jsonResponse(401, { error: 'nope' })) as unknown as typeof fetch;
    await expect(client.detectHeaderStyle('pq_bad')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('lists integrations from the /v2/integrations fixture', async () => {
    client.fetchImpl = vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith('/v2/ping')) return jsonResponse(200, { pong: 'it worked!' });
      if (u.includes('/v2/integrations')) return jsonResponse(200, INTEGRATIONS_FIXTURE);
      return jsonResponse(404, {});
    }) as unknown as typeof fetch;

    const accounts = await client.listIntegrations();
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({ platform: 'tiktok', username: 'neon.drama' });
    expect(accounts[1]).toMatchObject({ platform: 'youtube', displayName: null });
  });

  it('passes workspaceId as a query param when provided', async () => {
    const seen: string[] = [];
    client.fetchImpl = vi.fn(async (url) => {
      const u = String(url);
      seen.push(u);
      if (u.endsWith('/v2/ping')) return jsonResponse(200, { pong: 'it worked!' });
      return jsonResponse(200, { accounts: [] });
    }) as unknown as typeof fetch;

    await client.listIntegrations('ws-123');
    expect(seen.some((u) => u.includes('/v2/integrations?workspaceId=ws-123'))).toBe(true);
  });
});
