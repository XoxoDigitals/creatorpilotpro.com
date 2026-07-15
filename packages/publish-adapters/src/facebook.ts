import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import type {
  PublishAdapter,
  PublishTarget,
  LocalFile,
  ResolvedMetadata,
  PlatformIssue,
  PlatformConstraints,
} from './types.js';

/**
 * Facebook adapter — Reels only (Owner decision 2026-07-14, docs/06 §2).
 * Direct Meta Graph API (does NOT use PostQued):
 *   POST /{page-id}/video_reels?upload_phase=start  → { video_id, upload_url }
 *   POST <upload_url> (rupload.facebook.com) with the file bytes
 *   POST /{page-id}/video_reels?upload_phase=finish  (video_id, description, video_state=PUBLISHED)
 *
 * Credentials: read from `target.auth`:
 *   `{ pageId: string, pageAccessToken: string }`
 * (system-user page token preferred — non-expiring). Tokens are sent in the
 * `Authorization` header, never in the URL query string.
 *
 * publish() returns the real Graph `video_id` as `platformPostId`.
 *
 * verify() note: the frozen PublishAdapter.verify(platformPostId) signature carries no
 * auth, but Graph status GET needs the page token. publish() caches the credentials by
 * video id in-process; for a fresh worker process the caller must re-seed them via
 * {@link FacebookAdapter.primeVerifyAuth} before calling verify().
 */

export interface FacebookAdapterConfig {
  /** Graph API version, e.g. 'v21.0'. Fields are per Meta Graph vLatest. */
  graphVersion?: string;
  /** Overridable for tests. Defaults to the platform global fetch (Node 24). */
  fetchImpl?: typeof fetch;
}

interface FacebookAuth {
  pageId: string;
  pageAccessToken: string;
}

const GRAPH_BASE = 'https://graph.facebook.com';

export class FacebookAdapter implements PublishAdapter {
  readonly platform = 'FACEBOOK' as const;
  private readonly graphVersion: string;
  private readonly fetchImpl: typeof fetch;
  /** In-process cache of page token by video id, so verify() can authenticate (see class doc). */
  private readonly authByVideoId = new Map<string, FacebookAuth>();

  constructor(config: FacebookAdapterConfig = {}) {
    this.graphVersion = config.graphVersion ?? 'v21.0';
    this.fetchImpl = config.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  /** Re-seed the page token for a video id so verify() can run in a fresh process. */
  primeVerifyAuth(videoId: string, auth: FacebookAuth): void {
    this.authByVideoId.set(videoId, auth);
  }

  private graphUrl(path: string): string {
    return `${GRAPH_BASE}/${this.graphVersion}/${path.replace(/^\//, '')}`;
  }

  private static readAuth(target: PublishTarget): FacebookAuth {
    const auth = target.auth as Partial<FacebookAuth>;
    if (!auth.pageId || !auth.pageAccessToken) {
      throw new Error(
        'FacebookAdapter requires target.auth = { pageId, pageAccessToken }.',
      );
    }
    return { pageId: auth.pageId, pageAccessToken: auth.pageAccessToken };
  }

  async publish(
    target: PublishTarget,
    media: LocalFile,
    meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }> {
    const { pageId, pageAccessToken } = FacebookAdapter.readAuth(target);
    const description = [meta.title?.trim(), meta.description?.trim()]
      .filter((p): p is string => !!p && p.length > 0)
      .join('\n\n');

    // Phase 1 — start: reserve a video id + upload url.
    const startRes = await this.fetchImpl(
      this.graphUrl(`${pageId}/video_reels?upload_phase=start`),
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${pageAccessToken}`, accept: 'application/json' },
      },
    );
    const start = (await startRes.json().catch(() => ({}))) as {
      video_id?: string;
      upload_url?: string;
      error?: { message?: string };
    };
    if (!startRes.ok || !start.video_id || !start.upload_url) {
      throw new Error(
        `Facebook Reels start failed (${startRes.status}): ${start.error?.message ?? JSON.stringify(start)}`,
      );
    }
    const videoId = start.video_id;

    // Phase 2 — upload: POST the raw bytes to the rupload host.
    // rupload uses `Authorization: OAuth <token>` plus offset/file_size headers.
    const body = Readable.toWeb(createReadStream(media.path)) as unknown as ReadableStream<Uint8Array>;
    const uploadInit = {
      method: 'POST',
      headers: {
        Authorization: `OAuth ${pageAccessToken}`,
        offset: '0',
        file_size: String(media.bytes),
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(media.bytes),
      },
      body,
      duplex: 'half',
    } as unknown as RequestInit;
    const uploadRes = await this.fetchImpl(start.upload_url, uploadInit);
    if (!uploadRes.ok) {
      const raw = await uploadRes.text().catch(() => '');
      throw new Error(`Facebook Reels upload failed (${uploadRes.status}): ${raw.slice(0, 300)}`);
    }

    // Phase 3 — finish: publish the reel.
    const finishParams = new URLSearchParams({
      upload_phase: 'finish',
      video_id: videoId,
      video_state: 'PUBLISHED',
      description,
    });
    const finishRes = await this.fetchImpl(this.graphUrl(`${pageId}/video_reels`), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${pageAccessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body: finishParams.toString(),
    });
    if (!finishRes.ok) {
      const raw = await finishRes.text().catch(() => '');
      throw new Error(`Facebook Reels finish failed (${finishRes.status}): ${raw.slice(0, 300)}`);
    }

    this.authByVideoId.set(videoId, { pageId, pageAccessToken });
    return { platformPostId: videoId };
  }

  async verify(platformPostId: string): Promise<{ live: boolean; issues: PlatformIssue[] }> {
    const auth = this.authByVideoId.get(platformPostId);
    if (!auth) {
      throw new Error(
        `FacebookAdapter.verify: no page token cached for video ${platformPostId}. ` +
          'Call primeVerifyAuth(videoId, { pageId, pageAccessToken }) first.',
      );
    }

    const res = await this.fetchImpl(this.graphUrl(`${platformPostId}?fields=status`), {
      method: 'GET',
      headers: { Authorization: `Bearer ${auth.pageAccessToken}`, accept: 'application/json' },
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: { video_status?: string; processing_progress?: number } | string;
      error?: { message?: string };
    };
    if (!res.ok) {
      throw new Error(
        `Facebook status GET failed (${res.status}): ${data.error?.message ?? JSON.stringify(data)}`,
      );
    }

    // `status` is `{ video_status }` on newer Graph versions, or a bare string on older ones.
    const videoStatus = (
      typeof data.status === 'string' ? data.status : (data.status?.video_status ?? 'unknown')
    ).toLowerCase();

    const issues: PlatformIssue[] = [];
    let live = false;
    if (videoStatus === 'ready' || videoStatus === 'published' || videoStatus === 'live') {
      live = true;
    } else if (videoStatus === 'error' || videoStatus === 'expired' || videoStatus === 'failed') {
      issues.push({
        code: `video-${videoStatus}`,
        message: `Facebook reported video_status "${videoStatus}".`,
        severity: 'BLOCK',
      });
    } else {
      // processing / uploading / unknown — not live yet, not a failure.
      issues.push({
        code: 'processing',
        message: `Facebook video_status "${videoStatus}".`,
        severity: 'INFO',
      });
    }

    return { live, issues };
  }

  getConstraints(): PlatformConstraints {
    return {
      maxDurationSec: 90,
      maxBytes: 4 * 1024 * 1024 * 1024,
      maxTitleLength: 255,
      maxTags: 30,
      allowedFormats: ['mp4', 'mov'],
    };
  }
}
