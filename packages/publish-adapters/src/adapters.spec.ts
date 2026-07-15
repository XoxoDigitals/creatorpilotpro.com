import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostQuedAdapter } from './postqued.js';
import { FacebookAdapter } from './facebook.js';
import { PostQuedV2Client, PostQuedError } from './postqued-client.js';
import { validateMetadata } from './validate.js';
import type { LocalFile, PublishTarget, ResolvedMetadata } from './types.js';

// A real on-disk file so createReadStream() streams cleanly (the mock never reads it).
let tmpDir: string;
let mediaPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'scp-pub-'));
  mediaPath = join(tmpDir, 'clip.mp4');
  writeFileSync(mediaPath, Buffer.from('fake-mp4-bytes'));
});
afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

function media(): LocalFile {
  return { path: mediaPath, bytes: 14, mimeType: 'video/mp4', durationSec: 12, width: 1080, height: 1920 };
}

function meta(over: Partial<ResolvedMetadata> = {}): ResolvedMetadata {
  return {
    title: 'My Clip',
    description: 'A great clip',
    tags: ['fun', 'viral'],
    visibility: 'PUBLIC',
    aiLabel: true,
    ...over,
  };
}

function target(over: Partial<PublishTarget> = {}): PublishTarget {
  return {
    id: 'tgt-1',
    contentItemId: 'ci-1',
    accountId: 'acct-internal-1',
    platform: 'TIKTOK',
    auth: { postquedAccountId: 'pq-acct-9' },
    ...over,
  };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Mock fetch covering the PostQued upload+publish+status endpoints. */
function makePostQuedFetch(overrides?: { statusBody?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    const u = String(url);
    calls.push({
      url: u,
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    if (u.endsWith('/v2/content/upload'))
      return jsonResponse(200, {
        contentId: 'content-1',
        upload: { url: 'https://storage.example/put/abc', key: 'key-1', method: 'PUT', headers: { 'Content-Type': 'video/mp4' } },
      });
    if (u === 'https://storage.example/put/abc') return new Response('', { status: 200 });
    if (u.endsWith('/v2/content/upload/complete'))
      return jsonResponse(200, { content: { id: 'content-1' } });
    if (u.endsWith('/v2/publish'))
      return jsonResponse(200, { id: 'publish-1', targets: [{ id: 'ptarget-1' }] });
    if (u.includes('/v2/publish/'))
      return jsonResponse(200, overrides?.statusBody ?? { targets: [{ status: 'processing' }] });
    return jsonResponse(404, { error: 'not found' });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe('PostQuedAdapter (TikTok)', () => {
  it('runs the 3-step upload then publish, in order, with the Idempotency-Key header', async () => {
    const { calls, fetchImpl } = makePostQuedFetch();
    const adapter = new PostQuedAdapter({
      baseUrl: 'https://api.postqued.com',
      apiKey: 'pq_test',
      headerStyle: 'bearer',
      fetchImpl,
    });

    const res = await adapter.publish(target(), media(), meta());

    // publish() returns the PostQued publishId (verify job polls it).
    expect(res.platformPostId).toBe('publish-1');

    const seq = calls.map((c) => `${c.method} ${c.url.replace('https://api.postqued.com', '')}`);
    expect(seq).toEqual([
      'POST /v2/content/upload',
      'PUT https://storage.example/put/abc',
      'POST /v2/content/upload/complete',
      'POST /v2/publish',
    ]);

    // Bearer auth on the API calls; NO auth header on the presigned PUT.
    expect(calls[0]!.headers).toHaveProperty('Authorization', 'Bearer pq_test');
    expect(calls[1]!.headers).not.toHaveProperty('Authorization');

    // Idempotency-Key present + stable per target id.
    const publishCall = calls.find((c) => c.url.endsWith('/v2/publish'))!;
    expect(publishCall.headers['Idempotency-Key']).toBe('scp-tgt-1');
  });

  it('sends the postquedAccountId from target.auth and TikTok options built from metadata', async () => {
    const bodies: any[] = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (init?.body && typeof init.body === 'string') bodies.push({ u, body: JSON.parse(init.body) });
      if (u.endsWith('/v2/content/upload'))
        return jsonResponse(200, { contentId: 'c', upload: { url: 'https://s/put', key: 'k', method: 'PUT' } });
      if (u === 'https://s/put') return new Response('', { status: 200 });
      if (u.endsWith('/v2/content/upload/complete')) return jsonResponse(200, { content: { id: 'c' } });
      if (u.endsWith('/v2/publish')) return jsonResponse(200, { id: 'pub' });
      return jsonResponse(404, {});
    }) as unknown as typeof fetch;

    const adapter = new PostQuedAdapter({
      baseUrl: 'https://api.postqued.com',
      apiKey: 'pq_test',
      headerStyle: 'x-api-key',
      fetchImpl,
    });
    await adapter.publish(target(), media(), meta({ visibility: 'PRIVATE' }));

    const publishBody = bodies.find((b) => b.u.endsWith('/v2/publish'))!.body;
    const t = publishBody.targets[0];
    expect(t.platform).toBe('tiktok');
    expect(t.accountId).toBe('pq-acct-9');
    expect(t.dispatchAt).toBeNull();
    expect(t.options.privacyLevel).toBe('SELF_ONLY');
    expect(t.options.aiGeneratedContent).toBe(true);
    expect(t.caption).toContain('#fun');
  });

  it('verify() maps a copyright issue to BLOCK and reports not-live', async () => {
    const { fetchImpl } = makePostQuedFetch({
      statusBody: {
        targets: [
          {
            status: 'published',
            platformPostId: 'tt_123',
            issues: [{ code: 'copyright_claim', message: 'Matched third-party content', severity: 'warning' }],
          },
        ],
      },
    });
    const adapter = new PostQuedAdapter({
      baseUrl: 'https://api.postqued.com',
      apiKey: 'pq_test',
      headerStyle: 'bearer',
      fetchImpl,
    });
    const out = await adapter.verify('publish-1');
    expect(out.live).toBe(false);
    expect(out.issues[0]).toMatchObject({ code: 'copyright_claim', severity: 'BLOCK' });
  });

  it('verify() reports live when state is published with no issues', async () => {
    const { fetchImpl } = makePostQuedFetch({
      statusBody: { targets: [{ status: 'published', platformPostId: 'tt_999', issues: [] }] },
    });
    const adapter = new PostQuedAdapter({
      baseUrl: 'https://api.postqued.com',
      apiKey: 'pq_test',
      headerStyle: 'bearer',
      fetchImpl,
    });
    const out = await adapter.verify('publish-1');
    expect(out.live).toBe(true);
    expect(out.issues).toHaveLength(0);
  });
});

describe('PostQuedV2Client error classification', () => {
  it('marks 5xx as retryable and 4xx as terminal', async () => {
    const mk = (status: number) =>
      new PostQuedV2Client({
        baseUrl: 'https://api.postqued.com',
        apiKey: 'k',
        headerStyle: 'bearer',
        fetchImpl: (async () => jsonResponse(status, { error: 'x', code: 'E' })) as unknown as typeof fetch,
      });

    await expect(mk(503).getPublishStatus('p')).rejects.toMatchObject({ retryable: true });
    const terminal = await mk(400)
      .getPublishStatus('p')
      .catch((e: PostQuedError) => e);
    expect(terminal).toBeInstanceOf(PostQuedError);
    expect((terminal as PostQuedError).retryable).toBe(false);
  });
});

describe('FacebookAdapter (Reels)', () => {
  function fbTarget(): PublishTarget {
    return {
      id: 'fb-tgt',
      contentItemId: 'ci',
      accountId: 'a',
      platform: 'FACEBOOK',
      auth: { pageId: 'PAGE1', pageAccessToken: 'TKN' },
    };
  }

  it('runs start → upload → finish and returns the video id; token never in the URL', async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> });
      if (u.includes('upload_phase=start'))
        return jsonResponse(200, { video_id: 'vid_1', upload_url: 'https://rupload.facebook.com/vid_1' });
      if (u.startsWith('https://rupload.facebook.com')) return new Response('', { status: 200 });
      if (u.endsWith('/video_reels')) return jsonResponse(200, { success: true });
      return jsonResponse(404, {});
    }) as unknown as typeof fetch;

    const adapter = new FacebookAdapter({ graphVersion: 'v21.0', fetchImpl });
    const res = await adapter.publish(fbTarget(), media(), meta());
    expect(res.platformPostId).toBe('vid_1');

    const phases = calls.map((c) => c.url);
    expect(phases[0]).toContain('upload_phase=start');
    expect(phases[1]).toBe('https://rupload.facebook.com/vid_1');
    expect(phases[2]).toContain('/video_reels');
    // No access token leaked into any URL.
    expect(calls.every((c) => !c.url.includes('TKN'))).toBe(true);
    expect(calls[0]!.headers).toHaveProperty('Authorization', 'Bearer TKN');
    expect(calls[1]!.headers).toHaveProperty('Authorization', 'OAuth TKN');
  });

  it('verify() maps ready → live and error → BLOCK (after primeVerifyAuth)', async () => {
    let statusValue = 'ready';
    const fetchImpl = (async () => jsonResponse(200, { status: { video_status: statusValue } })) as unknown as typeof fetch;
    const adapter = new FacebookAdapter({ fetchImpl });
    adapter.primeVerifyAuth('vid_1', { pageId: 'PAGE1', pageAccessToken: 'TKN' });

    expect((await adapter.verify('vid_1')).live).toBe(true);

    statusValue = 'error';
    const errored = await adapter.verify('vid_1');
    expect(errored.live).toBe(false);
    expect(errored.issues[0]).toMatchObject({ severity: 'BLOCK' });
  });

  it('verify() throws when no page token is cached for the video', async () => {
    const adapter = new FacebookAdapter({ fetchImpl: (async () => jsonResponse(200, {})) as unknown as typeof fetch });
    await expect(adapter.verify('unknown-vid')).rejects.toThrow(/primeVerifyAuth/);
  });
});

describe('validateMetadata', () => {
  const constraints = {
    maxDurationSec: 60,
    maxBytes: 100,
    maxTitleLength: 10,
    maxTags: 2,
    allowedFormats: ['mp4'],
  };

  it('returns no issues for valid metadata', () => {
    const issues = validateMetadata(
      { title: 'ok', description: '', tags: ['a'] },
      { path: 'x/clip.mp4', bytes: 50, mimeType: 'video/mp4', durationSec: 10 },
      constraints,
    );
    expect(issues).toHaveLength(0);
  });

  it('flags long title, too many tags, oversize, long duration, bad format as BLOCK', () => {
    const issues = validateMetadata(
      { title: 'way too long a title', description: '', tags: ['a', 'b', 'c'] },
      { path: 'x/clip.webm', bytes: 999, mimeType: 'video/webm', durationSec: 120 },
      constraints,
    );
    const codes = issues.map((i) => i.code);
    expect(codes).toContain('title-too-long');
    expect(codes).toContain('too-many-tags');
    expect(codes).toContain('file-too-large');
    expect(codes).toContain('duration-too-long');
    expect(codes).toContain('format-unsupported');
    expect(issues.every((i) => i.severity === 'BLOCK')).toBe(true);
  });
});
