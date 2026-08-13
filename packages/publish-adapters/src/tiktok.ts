import { createReadStream } from 'node:fs';
import type {
  PublishAdapter,
  PublishTarget,
  LocalFile,
  ResolvedMetadata,
  PlatformIssue,
  PlatformConstraints,
} from './types.js';

/**
 * TikTok adapter — native Content Posting API v2 (Phase 9.6).
 *
 * Publish (DIRECT_POST flow):
 *   1. POST /v2/post/publish/video/init/  →  { publish_id, upload_url }
 *      body: {
 *        post_info: { title, privacy_level, disable_duet, disable_comment,
 *                     disable_stitch, video_cover_timestamp_ms, brand_content_toggle,
 *                     brand_organic_toggle },
 *        source_info: { source: 'FILE_UPLOAD', video_size, chunk_size, total_chunk_count }
 *      }
 *   2. PUT <upload_url>  (Content-Range: bytes 0-{end}/{total}, Content-Type: video/mp4)
 *
 * Verify:
 *   POST /v2/post/publish/status/fetch/   body: { publish_id }
 *   → { status: 'PROCESSING_UPLOAD'|'PROCESSING_DOWNLOAD'|'PUBLISH_COMPLETE'|'FAILED',
 *       fail_reason?, publicaly_available_post_id: [tiktokPostId, ...] }
 *
 * Auth: OAuth 2.0 bearer token stored in target.auth.accessToken. Scopes required:
 *   video.upload  +  video.publish  +  user.info.basic
 *
 * Only Direct Post is supported here; Inbox (draft) flow can be added if the
 * Owner opts into a review-in-TikTok-app workflow.
 */

export interface TikTokAdapterConfig {
  /** Overridable for tests. Defaults to the platform global fetch (Node 24). */
  fetchImpl?: typeof fetch;
}

interface TikTokAuth {
  accessToken: string;
}

const API_BASE = 'https://open.tiktokapis.com';

/** TikTok privacy levels mapped from our generic visibility. */
function toTikTokPrivacy(visibility: ResolvedMetadata['visibility']): string {
  switch (visibility) {
    case 'PRIVATE':  return 'SELF_ONLY';
    case 'UNLISTED': return 'MUTUAL_FOLLOW_FRIENDS';
    case 'PUBLIC':
    default:         return 'PUBLIC_TO_EVERYONE';
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Terminal codes that map to BLOCK issues on the target. */
const BLOCK_RE = /copyright|policy|violat|reject|fail|invalid|duplicate/i;

export class TikTokError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly body: unknown;
  constructor(message: string, opts: { status: number; retryable: boolean; body?: unknown }) {
    super(message);
    this.name = 'TikTokError';
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.body = opts.body;
  }
}

/** Chunk size TikTok expects (up to 64 MB per chunk, single-chunk allowed for < 64 MB). */
const CHUNK_MAX = 64 * 1024 * 1024;

export class TikTokAdapter implements PublishAdapter {
  readonly platform = 'TIKTOK' as const;
  private readonly fetchImpl: typeof fetch;
  /** Cache access token per publish_id so verify() authenticates without re-priming. */
  private readonly authByPublishId = new Map<string, TikTokAuth>();

  constructor(config: TikTokAdapterConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  /** Re-seed the access token for a publish_id so verify() runs in a fresh worker process. */
  primeVerifyAuth(publishId: string, auth: TikTokAuth): void {
    this.authByPublishId.set(publishId, auth);
  }

  private static readAuth(target: PublishTarget): TikTokAuth {
    const auth = target.auth as Partial<TikTokAuth>;
    if (!auth.accessToken) {
      throw new TikTokError('TikTok target.auth.accessToken is required.', {
        status: 0, retryable: false,
      });
    }
    return { accessToken: auth.accessToken };
  }

  private async requestJson<T>(
    path: string,
    accessToken: string,
    body: unknown,
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${API_BASE}${path}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          accept: 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new TikTokError(`TikTok ${path} network failure: ${(err as Error).message}`, {
        status: 0, retryable: true,
      });
    }
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      throw new TikTokError(`TikTok ${path} returned ${res.status}: ${raw.slice(0, 400)}`, {
        status: res.status, retryable: isRetryableStatus(res.status), body: raw,
      });
    }
    let parsed: unknown;
    try { parsed = raw ? JSON.parse(raw) : {}; }
    catch { throw new TikTokError(`TikTok ${path} returned non-JSON body.`, {
      status: 200, retryable: false, body: raw,
    }); }
    // TikTok wraps every response in { data, error: { code, message } }.
    const p = parsed as { error?: { code?: string; message?: string } };
    if (p.error && p.error.code && p.error.code !== 'ok') {
      throw new TikTokError(`TikTok ${path} — ${p.error.code}: ${p.error.message ?? ''}`, {
        status: 200, retryable: false, body: parsed,
      });
    }
    return parsed as T;
  }

  async publish(
    target: PublishTarget,
    media: LocalFile,
    meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }> {
    const auth = TikTokAdapter.readAuth(target);

    // Step 1 — initiate upload. Description is derived from meta.description
    // (falls back to title). Hashtags in caption are honored by TikTok.
    const caption = (meta.description?.trim() || meta.title).slice(0, 2200);
    const totalChunkCount = Math.max(1, Math.ceil(media.bytes / CHUNK_MAX));
    const chunkSize = totalChunkCount === 1 ? media.bytes : CHUNK_MAX;

    const initBody = {
      post_info: {
        title: caption,
        privacy_level: toTikTokPrivacy(meta.visibility),
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        video_cover_timestamp_ms: 1000,
        // AI-content disclosure per TikTok's synthetic-media policy.
        brand_content_toggle: false,
        brand_organic_toggle: !!meta.aiLabel,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: media.bytes,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    };

    const init = await this.requestJson<{
      data: { publish_id: string; upload_url: string };
    }>('/v2/post/publish/video/init/', auth.accessToken, initBody);

    const publishId = init.data?.publish_id;
    const uploadUrl = init.data?.upload_url;
    if (!publishId || !uploadUrl) {
      throw new TikTokError('TikTok init response missing publish_id / upload_url.', {
        status: 200, retryable: false, body: init,
      });
    }

    // Step 2 — PUT the bytes. Single-chunk upload for < 64 MB (typical shorts);
    // multi-chunk splits the file with Content-Range on each PUT.
    for (let i = 0; i < totalChunkCount; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, media.bytes) - 1;
      const chunkBytes = end - start + 1;
      // Node's createReadStream honors start/end (inclusive), converted to a web
      // ReadableStream so `fetch` can consume it with `duplex: 'half'`.
      const nodeStream = createReadStream(media.path, { start, end });
      const body = (await import('node:stream')).Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;

      let putRes: Response;
      try {
        putRes = await this.fetchImpl(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': media.mimeType,
            'Content-Length': String(chunkBytes),
            'Content-Range': `bytes ${start}-${end}/${media.bytes}`,
          },
          body,
          duplex: 'half',
        } as unknown as RequestInit);
      } catch (err) {
        throw new TikTokError(`TikTok chunk upload failed (network): ${(err as Error).message}`, {
          status: 0, retryable: true,
        });
      }
      // 201/206 are progress markers, 200 = final chunk accepted.
      if (!putRes.ok && putRes.status !== 201 && putRes.status !== 206) {
        const raw = await putRes.text().catch(() => '');
        throw new TikTokError(`TikTok upload chunk ${i + 1}/${totalChunkCount} returned ${putRes.status}: ${raw.slice(0, 300)}`, {
          status: putRes.status, retryable: isRetryableStatus(putRes.status), body: raw,
        });
      }
    }

    // Cache the auth so verify() in the same process authenticates without priming.
    this.authByPublishId.set(publishId, auth);
    return { platformPostId: publishId };
  }

  async verify(platformPostId: string): Promise<{ live: boolean; issues: PlatformIssue[] }> {
    const auth = this.authByPublishId.get(platformPostId);
    if (!auth) {
      return { live: false, issues: [{
        code: 'auth-missing',
        message: 'TikTok verify: access token not seeded for this publish id.',
        severity: 'INFO',
      }] };
    }

    const res = await this.requestJson<{
      data: {
        status: string;
        fail_reason?: string;
        publicaly_available_post_id?: string[];
      };
    }>('/v2/post/publish/status/fetch/', auth.accessToken, { publish_id: platformPostId });

    const status = res.data?.status ?? 'UNKNOWN';
    const failReason = res.data?.fail_reason;
    const publishedIds = res.data?.publicaly_available_post_id ?? [];

    const issues: PlatformIssue[] = [];
    if (failReason) {
      issues.push({
        code: `tiktok-${failReason}`,
        message: `TikTok publish failed: ${failReason}`,
        severity: BLOCK_RE.test(failReason) ? 'BLOCK' : 'WARNING',
      });
    }
    if (status === 'FAILED') {
      issues.push({
        code: 'publish-failed',
        message: `TikTok reported status FAILED${failReason ? ` (${failReason})` : ''}`,
        severity: 'BLOCK',
      });
    }

    const live = status === 'PUBLISH_COMPLETE' && publishedIds.length > 0;
    return { live, issues };
  }

  getConstraints(): PlatformConstraints {
    return {
      // TikTok Shorts (< 60 s vertical) — Content Posting API supports up to 10 minutes.
      maxDurationSec: 10 * 60,
      // Hard limit for a single Content Posting API upload session.
      maxBytes: 4 * 1024 * 1024 * 1024,
      // Caption max = 2200 chars; title/desc share it. Keep title strict for our template guard.
      maxTitleLength: 150,
      maxTags: 30,
      allowedFormats: ['mp4', 'mov'],
    };
  }
}
