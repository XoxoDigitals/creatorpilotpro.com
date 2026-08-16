import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
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
 * Publish: resumable upload + optional custom thumbnail:
 *   1. POST resumable init with snippet/status/(recordingDetails)
 *   2. PUT video bytes
 *   3. Optional thumbnails.set
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
    case 'PRIVATE':
      return 'private';
    case 'UNLISTED':
      return 'unlisted';
    case 'PUBLIC':
    default:
      return 'public';
  }
}

function thumbMime(path: string): string {
  const ext = extname(path).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
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
        status: 0,
        retryable: false,
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

    const lang = (meta.defaultLanguage ?? 'en').trim() || 'en';
    const audioLang = (meta.defaultAudioLanguage ?? lang).trim() || lang;

    const snippet: Record<string, unknown> = {
      title: meta.title,
      description: meta.description ?? '',
      tags: meta.tags ?? [],
      ...(meta.category ? { categoryId: String(meta.category) } : {}),
      defaultLanguage: lang,
      defaultAudioLanguage: audioLang,
    };
    const status = {
      privacyStatus: toYouTubePrivacy(meta.visibility),
      selfDeclaredMadeForKids: meta.madeForKids === true,
      containsSyntheticMedia: meta.aiLabel ?? false,
    };
    const initBody: Record<string, unknown> = { snippet, status };
    if (meta.recordingCountry?.trim()) {
      initBody.recordingDetails = {
        locationDescription: meta.recordingCountry.trim().toUpperCase(),
      };
    }

    const parts = meta.recordingCountry?.trim()
      ? 'snippet,status,recordingDetails'
      : 'snippet,status';
    const initUrl = `${UPLOAD_BASE}/videos?uploadType=resumable&part=${parts}`;
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
        status: 0,
        retryable: true,
      });
    }
    if (!initRes.ok) {
      const raw = await initRes.text().catch(() => '');
      throw new YouTubeError(`YouTube init returned ${initRes.status}: ${raw.slice(0, 400)}`, {
        status: initRes.status,
        retryable: isRetryableStatus(initRes.status),
        body: raw,
      });
    }

    const uploadUrl = initRes.headers.get('location');
    if (!uploadUrl) {
      throw new YouTubeError('YouTube init response missing Location upload URL.', {
        status: 200,
        retryable: false,
        body: null,
      });
    }

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
        duplex: 'half',
      } as unknown as RequestInit);
    } catch (err) {
      throw new YouTubeError(`YouTube upload PUT failed (network): ${(err as Error).message}`, {
        status: 0,
        retryable: true,
      });
    }
    if (!putRes.ok) {
      const raw = await putRes.text().catch(() => '');
      throw new YouTubeError(`YouTube upload PUT returned ${putRes.status}: ${raw.slice(0, 400)}`, {
        status: putRes.status,
        retryable: isRetryableStatus(putRes.status),
        body: raw,
      });
    }

    const uploaded = (await putRes.json().catch(() => ({}))) as { id?: string };
    const videoId = uploaded.id;
    if (!videoId) {
      throw new YouTubeError('YouTube upload response missing video id.', {
        status: 200,
        retryable: false,
        body: uploaded,
      });
    }

    if (meta.thumbnailPath?.trim()) {
      try {
        await this.setThumbnail(auth.accessToken, videoId, meta.thumbnailPath.trim());
      } catch (err) {
        console.warn(
          `[youtube] thumbnails.set failed for ${videoId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    this.authByVideoId.set(videoId, auth);
    return { platformPostId: videoId };
  }

  private async setThumbnail(accessToken: string, videoId: string, imagePath: string): Promise<void> {
    const bytes = await readFile(imagePath);
    const mime = thumbMime(imagePath);
    const url = `${UPLOAD_BASE}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`;
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': mime,
        'Content-Length': String(bytes.byteLength),
      },
      body: bytes,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new YouTubeError(`YouTube thumbnails.set returned ${res.status}: ${raw.slice(0, 300)}`, {
        status: res.status,
        retryable: isRetryableStatus(res.status),
        body: raw,
      });
    }
  }

  async verify(platformPostId: string): Promise<{ live: boolean; issues: PlatformIssue[] }> {
    const auth = this.authByVideoId.get(platformPostId);
    if (!auth) {
      return {
        live: false,
        issues: [
          {
            code: 'auth-missing',
            message: 'YouTube verify: access token not seeded for this video id.',
            severity: 'INFO',
          },
        ],
      };
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
        status: 0,
        retryable: true,
      });
    }
    if (!res.ok) {
      const raw = await res.text().catch(() => '');
      throw new YouTubeError(`YouTube verify returned ${res.status}: ${raw.slice(0, 400)}`, {
        status: res.status,
        retryable: isRetryableStatus(res.status),
        body: raw,
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
      return {
        live: false,
        issues: [
          {
            code: 'not-found',
            message: `YouTube videos.list returned no item for ${platformPostId}.`,
            severity: 'BLOCK',
          },
        ],
      };
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
