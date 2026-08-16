import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FacebookAdapter } from './facebook.js';
import { TikTokAdapter } from './tiktok.js';
import { YouTubeAdapter } from './youtube.js';
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

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

// ── YouTube (native Data API v3) ──────────────────────────────────────────────

describe('YouTubeAdapter (native Data API v3)', () => {
  function ytTarget(): PublishTarget {
    return {
      id: 'yt-tgt',
      contentItemId: 'ci',
      accountId: 'a',
      platform: 'YOUTUBE',
      auth: { accessToken: 'ya29.TOKEN' },
    };
  }

  it('does init POST → PUT with the Location URL and returns the returned video id', async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> });
      if (u.includes('/upload/youtube/v3/videos')) {
        return new Response(null, { status: 200, headers: { location: 'https://upload.google/session-XYZ' } });
      }
      if (u === 'https://upload.google/session-XYZ') {
        return jsonResponse(200, { id: 'yt_VIDEO_ID' });
      }
      return jsonResponse(404, {});
    }) as unknown as typeof fetch;

    const adapter = new YouTubeAdapter({ fetchImpl });
    const res = await adapter.publish(ytTarget(), media(), meta());
    expect(res.platformPostId).toBe('yt_VIDEO_ID');

    expect(calls[0]!.url).toContain('/upload/youtube/v3/videos');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers).toHaveProperty('Authorization', 'Bearer ya29.TOKEN');
    expect(calls[1]!.url).toBe('https://upload.google/session-XYZ');
    expect(calls[1]!.method).toBe('PUT');
  });

  it('throws when target.auth.accessToken is missing', async () => {
    const adapter = new YouTubeAdapter({ fetchImpl: (async () => jsonResponse(200, {})) as unknown as typeof fetch });
    await expect(
      adapter.publish({ ...ytTarget(), auth: {} }, media(), meta()),
    ).rejects.toThrow(/accessToken/i);
  });

  it('marks 5xx retryable and 4xx terminal on init failure', async () => {
    const mk = (status: number) => new YouTubeAdapter({
      fetchImpl: (async () => jsonResponse(status, { error: 'x' })) as unknown as typeof fetch,
    });
    await expect(mk(503).publish(ytTarget(), media(), meta())).rejects.toMatchObject({ retryable: true });
    await expect(mk(400).publish(ytTarget(), media(), meta())).rejects.toMatchObject({ retryable: false });
  });

  it('verify() → live when processed + no issues', async () => {
    const fetchImpl = (async () => jsonResponse(200, {
      items: [{
        status: { uploadStatus: 'processed', privacyStatus: 'public' },
        processingDetails: { processingStatus: 'succeeded' },
      }],
    })) as unknown as typeof fetch;
    const adapter = new YouTubeAdapter({ fetchImpl });
    adapter.primeVerifyAuth('yt_VIDEO_ID', { accessToken: 'ya29.TOKEN' });
    const out = await adapter.verify('yt_VIDEO_ID');
    expect(out.live).toBe(true);
    expect(out.issues).toHaveLength(0);
  });

  it('verify() maps rejectionReason with copyright pattern to BLOCK', async () => {
    const fetchImpl = (async () => jsonResponse(200, {
      items: [{
        status: { uploadStatus: 'processed', rejectionReason: 'copyrightMatch' },
        processingDetails: { processingStatus: 'succeeded' },
      }],
    })) as unknown as typeof fetch;
    const adapter = new YouTubeAdapter({ fetchImpl });
    adapter.primeVerifyAuth('yt_VIDEO_ID', { accessToken: 'ya29.TOKEN' });
    const out = await adapter.verify('yt_VIDEO_ID');
    expect(out.live).toBe(false);
    expect(out.issues[0]).toMatchObject({ severity: 'BLOCK' });
  });

  it('verify() returns auth-missing INFO when the video id was not primed', async () => {
    const adapter = new YouTubeAdapter({
      fetchImpl: (async () => jsonResponse(200, {})) as unknown as typeof fetch,
    });
    const out = await adapter.verify('never-seen');
    expect(out.live).toBe(false);
    expect(out.issues[0]).toMatchObject({ code: 'auth-missing', severity: 'INFO' });
  });
});

// ── Facebook (Reels — direct Meta Graph) ──────────────────────────────────────

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
    expect(calls.every((c) => !c.url.includes('TKN'))).toBe(true);
    expect(calls[0]!.headers).toHaveProperty('Authorization', 'Bearer TKN');
    expect(calls[1]!.headers).toHaveProperty('Authorization', 'OAuth TKN');
  });

  it('publishes videos longer than 90s via Page Videos (not Reels)', async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> });
      if (u.includes('graph-video.facebook.com') && u.endsWith('/videos')) {
        const body = typeof init?.body === 'string' ? init.body : '';
        if (body.includes('upload_phase=start') || (init?.body instanceof FormData) === false && body.includes('start')) {
          if (body.includes('upload_phase=start')) {
            return jsonResponse(200, {
              upload_session_id: 'sess_1',
              video_id: 'vid_long',
              start_offset: '0',
              end_offset: '14',
            });
          }
          if (body.includes('upload_phase=finish')) {
            return jsonResponse(200, { success: true });
          }
        }
        if (init?.body instanceof FormData) {
          return jsonResponse(200, { start_offset: '14', end_offset: '14' });
        }
        if (body.includes('upload_phase=finish')) {
          return jsonResponse(200, { success: true });
        }
      }
      return jsonResponse(404, { error: { message: `unexpected ${u}` } });
    }) as unknown as typeof fetch;

    const adapter = new FacebookAdapter({ graphVersion: 'v21.0', fetchImpl });
    const long = { ...media(), durationSec: 170.56 };
    const res = await adapter.publish(fbTarget(), long, meta());
    expect(res.platformPostId).toBe('vid_long');
    expect(calls.some((c) => c.url.includes('/video_reels'))).toBe(false);
    expect(calls.some((c) => c.url.includes('graph-video.facebook.com') && c.url.endsWith('/videos'))).toBe(
      true,
    );
    expect(adapter.getConstraints().maxDurationSec).toBeGreaterThan(90);
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

// ── TikTok (Content Posting API v2 — DIRECT_POST) ────────────────────────────

describe('TikTokAdapter (native)', () => {
  function ttTarget(): PublishTarget {
    return { id: 'tt-tgt', contentItemId: 'ci', accountId: 'a', platform: 'TIKTOK', auth: { accessToken: 'act.TOKEN' } };
  }

  it('does init POST → single-chunk PUT and returns the publish_id', async () => {
    const calls: Call[] = [];
    const fetchImpl = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      calls.push({ url: u, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string> });
      if (u.endsWith('/v2/post/publish/video/init/')) {
        return jsonResponse(200, { data: { publish_id: 'pub_ABC', upload_url: 'https://tiktok.upload/session-XYZ' } });
      }
      if (u === 'https://tiktok.upload/session-XYZ') {
        return new Response('', { status: 200 });
      }
      return jsonResponse(404, {});
    }) as unknown as typeof fetch;

    const adapter = new TikTokAdapter({ fetchImpl });
    const res = await adapter.publish(ttTarget(), media(), meta());
    expect(res.platformPostId).toBe('pub_ABC');
    expect(calls[0]!.url).toContain('/v2/post/publish/video/init/');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers).toHaveProperty('Authorization', 'Bearer act.TOKEN');
    expect(calls[1]!.url).toBe('https://tiktok.upload/session-XYZ');
    expect(calls[1]!.method).toBe('PUT');
    expect(calls[1]!.headers).toHaveProperty('Content-Range', 'bytes 0-13/14');
  });

  it('throws when target.auth.accessToken is missing', async () => {
    const adapter = new TikTokAdapter({ fetchImpl: (async () => jsonResponse(200, {})) as unknown as typeof fetch });
    await expect(
      adapter.publish({ ...ttTarget(), auth: {} }, media(), meta()),
    ).rejects.toThrow(/accessToken/i);
  });

  it('surfaces TikTok error envelope { error: { code } } as a terminal error', async () => {
    const fetchImpl = (async () =>
      jsonResponse(200, { error: { code: 'spam_risk', message: 'video appears spammy' } })
    ) as unknown as typeof fetch;
    const adapter = new TikTokAdapter({ fetchImpl });
    await expect(adapter.publish(ttTarget(), media(), meta())).rejects.toMatchObject({ retryable: false });
  });

  it('verify() → live when PUBLISH_COMPLETE with a published post id', async () => {
    const fetchImpl = (async () => jsonResponse(200, {
      data: { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: ['tt_LIVE'] },
    })) as unknown as typeof fetch;
    const adapter = new TikTokAdapter({ fetchImpl });
    adapter.primeVerifyAuth('pub_ABC', { accessToken: 'act.TOKEN' });
    const out = await adapter.verify('pub_ABC');
    expect(out.live).toBe(true);
    expect(out.issues).toHaveLength(0);
  });

  it('verify() maps FAILED + copyright fail_reason to BLOCK', async () => {
    const fetchImpl = (async () => jsonResponse(200, {
      data: { status: 'FAILED', fail_reason: 'copyright_violation' },
    })) as unknown as typeof fetch;
    const adapter = new TikTokAdapter({ fetchImpl });
    adapter.primeVerifyAuth('pub_ABC', { accessToken: 'act.TOKEN' });
    const out = await adapter.verify('pub_ABC');
    expect(out.live).toBe(false);
    expect(out.issues.some((i) => i.severity === 'BLOCK')).toBe(true);
  });

  it('verify() returns auth-missing INFO when the publish id was not primed', async () => {
    const adapter = new TikTokAdapter({
      fetchImpl: (async () => jsonResponse(200, {})) as unknown as typeof fetch,
    });
    const out = await adapter.verify('never-seen');
    expect(out.live).toBe(false);
    expect(out.issues[0]).toMatchObject({ code: 'auth-missing', severity: 'INFO' });
  });
});

// ── validateMetadata ─────────────────────────────────────────────────────────

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
