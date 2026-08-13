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
 * YouTube adapter — direct YouTube Data API v3 (docs/06 §2, Phase 9).
 *
 * Publish: resumable upload flow (docs.google → YouTube):
 *   1. POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
 *      (with the snippet+status metadata JSON as body) → returns a `Location` upload URL
 *   2. PUT <upload URL> with the raw video bytes (single chunk; Node streams the file) →
 *      returns the video resource including the `id`.
 *
 * Verify: GET videos.list?id=<videoId>&part=status,processingDetails,contentDetails →
 *   the `uploadStatus`, `privacyStatus`, `rejectionReason`, `processingStatus` and any
 *   `contentDetails.contentRating.ytRating` / copyright claims are mapped to PlatformIssue.
 *
 * Credentials: passed via `target.auth`:
 *   `{ accessToken: string, refreshToken?: string, clientId?: string, clientSecret?: string }`
 * The refresh flow is handled OUT of this adapter (the maintenance job refreshes tokens
 * near expiry — docs/06 §4). This adapter uses only the fresh access token supplied.
 */

export interface YouTubeAdapterConfig {
  /** Overridable for tests. Defaults to the platform global fetch (Node 24). */
  fetchImpl?: typeof fetch;
}

interface YouTubeAuth {
  accessToken: string;
}

const API_BASE = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';

/** Map our generic visibility to YouTube's privacyStatus values. */
function toYouTubePrivacy(visibility: ResolvedMetadata['visibility']): string {
  switch (visibility) {
    case 'PRIVATE':  return 'private';
    case 'UNLISTED': return 'unlisted';
    case 'PUBLIC':
    default:         return 'public';
  }
}

/** 5xx / 429 / transport failures → retryable; other 4xx → terminal. */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Codes/reasons that block go-live (copyright, rejection, processing failure). */
const BLOCK_RE = /copyright|claim|reject|violat|block|processing[-_ ]?fail|takedown/i;

export class YouTubeError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly body: unknown;
  constructor(message: string, opts: { status: number; retryable: boolean; body?: unknown }) {
    super(message);
    this.name = 'YouTubeError';
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.body = opts.body;
  }
}

export class YouTubeAdapter implements PublishAdapter {
  readonly platform = 'YOUTUBE' as const;
  private readonly fetchImpl: typeof fetch;
  /** Per-video access token cache so verify() can authenticate in the same process. */
  private readonly authByVideoId = new Map<string, YouTubeAuth>();

  constructor(config: YouTubeAdapterConfig = {}) {
    this.fetchImpl = config.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  /** Re-seed the access token for a video id so verify() can run in a fresh worker process. */
  primeVerifyAuth(videoId: string, auth: YouTubeAuth): void {
    this.authByVideoId.set(videoId, auth);
  }

  private static readAuth(target: PublishTarget): YouTubeAuth {
    const auth = target.auth as Partial<YouTubeAuth>;
    if (!auth.accessToken) {
      throw new YouTubeError('YouTube target.auth.accessToken is required.', {
        status: 0, retryable: false,
      });
    }
    return { accessToken: auth.accessToken };
  }

  async publish(
    target: PublishTarget,
    media: LocalFile,
    meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }> {
    const auth = YouTubeAdapter.readAuth(target);

    // Step 1 — initiate the resumable upload.
    const snippet: Record<string, unknown> = {
      title: meta.title,
      description: meta.description ?? '',
      tags: meta.tags,
      ...(meta.category ? { categoryId: meta.category } : {}),
      // YouTube requires a language hint for closed-caption discovery on Shorts.
      defaultLanguage: 'en',
    };
    const status = {
      privacyStatus: toYouTubePrivacy(meta.visibility),
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: meta.aiLabel ?? false,
    };
    const initBody = { snippet, status };

    const initUrl = `${UPLOAD_BASE}/videos?uploadType=resumable&part=snippet,status`;
    let initRes: Response;
    try {
      initRes = await this.fetchImpl(initUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${auth.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': media.mimeType,
          'X-Upload-Content-Length': String(media.bytes),
        },
        body: JSON.stringify(initBody),
      });
    } catch (err) {
      throw new YouTubeError(`YouTube init failed (network): ${(err as Error).message}`, {
        status: 0, retryable: true,
      });
    }
    if (!initRes.ok) {
      const raw = await initRes.text().catch(() => '');
      throw new YouTubeError(`YouTube init returned ${initRes.status}: ${raw.slice(0, 400)}`, {
        status: initRes.status, retryable: isRetryableStatus(initRes.status), body: raw,
      });
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      throw new YouTubeError('YouTube init response missing Location upload URL.', {
        status: 200, retryable: false, body: null,
      });
    }

    // Step 2 — PUT the file bytes.
    const body = Readable.toWeb(createReadStream(media.path)) as unknown as ReadableStream<Uint8Array>;
    let putRes: Response;
    try {
      putRes = await this.fetchImpl(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': media.mimeType,
          'Content-Length': String(media.bytes),
        },
        body,
        // Node requires duplex when streaming a request body.
        duplex: 'half',
      } as unknown as RequestInit);
    } catch (err) {
      throw new YouTubeError(`YouTube upload PUT failed (network): ${(err as Error).message}`, {
        status: 0, retryable: true,
      });
    }
    if (!putRes.ok) {
      const raw = await putRes.text().catch(() => '');
      throw new YouTubeError(`YouTube upload PUT returned ${putRes.status}: ${raw.slice(0, 400)}`, {
        status: putRes.status, retryable: isRetryableStatus(putRes.status), body: raw,
      });
    }

    const uploaded = (await putRes.json().catch(() => ({}))) as { id?: string };
    const videoId = uploaded.id;
    if (!videoId) {
      throw new YouTubeError('YouTube upload response missing video id.', {
        status: 200, retryable: false, body: uploaded,
      });
    }

    // Cache the auth so verify() in the same process works without re-priming.
    this.authByVideoId.set(videoId, auth);
    return { platformPostId: videoId };
  }

  async verify(platformPostId: string): Promise<{ live: boolean; issues: PlatformIssue[] }> {
    const auth = this.authByVideoId.get(platformPostId);
    if (!auth) {
      // Fresh worker process — the caller (verify job) must primeVerifyAuth first.
      return { live: false, issues: [{
        code: 'auth-missing',
        message: 'YouTube verify: access token not seeded for this video id.',
        severity: 'INFO',
      }] };
    }

    const params = new URLSearchParams({
      id: platformPostId,
      part: 'status,processingDetails,contentDetails,snippet',
    });
    let res: Response;
    try {
      res = await this.fetchImpl(`${API_BASE}/videos?${params}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${auth.accessToken}`, accept: 'application/json' },
      });
    } catch (err) {
      throw new YouTubeError(`YouTube verify network failure: ${(err as Error).message}`, {
        status: 0, retryable: true,
      });
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new YouTubeError(`YouTube verify returned ${res.status}: ${raw.slice(0, 400)}`, {
        status: res.status, retryable: isRetryableStatus(res.status), body: raw,
      });
    }

    const data = (await res.json()) as {
      items?: Array<{
        status?: {
          uploadStatus?: string;
          privacyStatus?: string;
          rejectionReason?: string;
          failureReason?: string;
        };
        processingDetails?: { processingStatus?: string; processingFailureReason?: string };
      }>;
    };
    const item = data.items?.[0];
    if (!item) {
      return { live: false, issues: [{
        code: 'not-found',
        message: `YouTube videos.list returned no item for ${platformPostId}.`,
        severity: 'BLOCK',
      }] };
    }

    const issues: PlatformIssue[] = [];
    const s = item.status ?? {};
    const p = item.processingDetails ?? {};

    if (s.rejectionReason) {
      issues.push({
        code: `rejected-${s.rejectionReason}`,
        message: `YouTube rejected: ${s.rejectionReason}`,
        severity: BLOCK_RE.test(s.rejectionReason) ? 'BLOCK' : 'WARNING',
      });
    }
    if (s.failureReason) {
      issues.push({
        code: `failed-${s.failureReason}`,
        message: `YouTube upload failed: ${s.failureReason}`,
        severity: 'BLOCK',
      });
    }
    if (p.processingFailureReason) {
      issues.push({
        code: `processing-${p.processingFailureReason}`,
        message: `YouTube processing failure: ${p.processingFailureReason}`,
        severity: 'BLOCK',
      });
    }

    const uploadDone = s.uploadStatus === 'processed' || s.uploadStatus === 'uploaded';
    const processingDone = p.processingStatus !== 'processing';
    const hasBlock = issues.some((i) => i.severity === 'BLOCK');
    const live = uploadDone && processingDone && !hasBlock;
    return { live, issues };
  }

  getConstraints(): PlatformConstraints {
    return {
      maxDurationSec: 12 * 60 * 60,
      maxBytes: 256 * 1024 * 1024 * 1024,
      maxTitleLength: 100,
      maxTags: 500,
      allowedFormats: ['mp4', 'mov'],
    };
  }
}
