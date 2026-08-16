import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
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
 * Facebook adapter — Reels for ≤90s, Page Videos for longer clips.
 *
 * Reels (≤90s):
 *   POST /{page-id}/video_reels?upload_phase=start  → { video_id, upload_url }
 *   POST <upload_url> (rupload.facebook.com) with the file bytes
 *   POST /{page-id}/video_reels?upload_phase=finish
 *
 * Page Videos (>90s), chunked upload on graph-video.facebook.com:
 *   POST /{page-id}/videos upload_phase=start
 *   POST /{page-id}/videos upload_phase=transfer (chunks)
 *   POST /{page-id}/videos upload_phase=finish
 *
 * Credentials: `target.auth` = `{ pageId, pageAccessToken }`.
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
const GRAPH_VIDEO_BASE = 'https://graph-video.facebook.com';

/** Meta Reels hard max (docs). Longer clips must use Page Videos. */
export const FACEBOOK_REEL_MAX_DURATION_SEC = 90;
/** Meta Page Video max length (docs error 1363026). */
export const FACEBOOK_PAGE_VIDEO_MAX_DURATION_SEC = 40 * 60;

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

  private graphVideoUrl(path: string): string {
    return `${GRAPH_VIDEO_BASE}/${this.graphVersion}/${path.replace(/^\//, '')}`;
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

  private static caption(meta: ResolvedMetadata): string {
    return [meta.title?.trim(), meta.description?.trim()]
      .filter((p): p is string => !!p && p.length > 0)
      .join('\n\n');
  }

  /** Prefer Reels for short clips; Page Videos when duration exceeds the Reels cap. */
  static shouldPublishAsReel(durationSec: number | undefined): boolean {
    if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) {
      return true;
    }
    return durationSec <= FACEBOOK_REEL_MAX_DURATION_SEC;
  }

  async publish(
    target: PublishTarget,
    media: LocalFile,
    meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }> {
    const auth = FacebookAdapter.readAuth(target);
    if (FacebookAdapter.shouldPublishAsReel(media.durationSec)) {
      return this.publishReel(auth, media, meta);
    }
    return this.publishPageVideo(auth, media, meta);
  }

  private async publishReel(
    auth: FacebookAuth,
    media: LocalFile,
    meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }> {
    const { pageId, pageAccessToken } = auth;
    const description = FacebookAdapter.caption(meta);

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

    this.authByVideoId.set(videoId, auth);
    return { platformPostId: videoId };
  }

  /**
   * Chunked Page Video upload (graph-video host). Used when duration > Reels max.
   */
  private async publishPageVideo(
    auth: FacebookAuth,
    media: LocalFile,
    meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }> {
    const { pageId, pageAccessToken } = auth;
    const description = FacebookAdapter.caption(meta);
    const title = meta.title?.trim() || 'Video';
    const videosUrl = this.graphVideoUrl(`${pageId}/videos`);
    const authHeader = { Authorization: `Bearer ${pageAccessToken}`, accept: 'application/json' };

    const startParams = new URLSearchParams({
      upload_phase: 'start',
      file_size: String(media.bytes),
    });
    const startRes = await this.fetchImpl(videosUrl, {
      method: 'POST',
      headers: {
        ...authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: startParams.toString(),
    });
    const start = (await startRes.json().catch(() => ({}))) as {
      upload_session_id?: string;
      video_id?: string;
      start_offset?: string | number;
      end_offset?: string | number;
      error?: { message?: string };
    };
    if (!startRes.ok || !start.upload_session_id || !start.video_id) {
      throw new Error(
        `Facebook Page Video start failed (${startRes.status}): ${start.error?.message ?? JSON.stringify(start)}`,
      );
    }

    const sessionId = start.upload_session_id;
    const videoId = start.video_id;
    let startOffset = Number(start.start_offset ?? 0);
    let endOffset = Number(start.end_offset ?? 0);

    const fh = await open(media.path, 'r');
    try {
      while (startOffset !== endOffset) {
        const chunkSize = endOffset - startOffset;
        if (chunkSize <= 0) break;
        const buf = Buffer.alloc(chunkSize);
        const { bytesRead } = await fh.read(buf, 0, chunkSize, startOffset);
        const chunk = bytesRead === chunkSize ? buf : buf.subarray(0, bytesRead);

        const form = new FormData();
        form.append('upload_phase', 'transfer');
        form.append('upload_session_id', sessionId);
        form.append('start_offset', String(startOffset));
        form.append('video_file_chunk', new Blob([new Uint8Array(chunk)]), 'chunk.mp4');

        const transferRes = await this.fetchImpl(videosUrl, {
          method: 'POST',
          headers: authHeader,
          body: form,
        });
        const transfer = (await transferRes.json().catch(() => ({}))) as {
          start_offset?: string | number;
          end_offset?: string | number;
          error?: { message?: string };
        };
        if (!transferRes.ok) {
          throw new Error(
            `Facebook Page Video transfer failed (${transferRes.status}): ${transfer.error?.message ?? JSON.stringify(transfer)}`,
          );
        }
        const nextStart = Number(transfer.start_offset ?? endOffset);
        const nextEnd = Number(transfer.end_offset ?? endOffset);
        if (nextStart === startOffset && nextEnd === endOffset) {
          throw new Error('Facebook Page Video transfer made no progress.');
        }
        startOffset = nextStart;
        endOffset = nextEnd;
      }
    } finally {
      await fh.close();
    }

    const finishParams = new URLSearchParams({
      upload_phase: 'finish',
      upload_session_id: sessionId,
      title,
      description,
      published: 'true',
    });
    const finishRes = await this.fetchImpl(videosUrl, {
      method: 'POST',
      headers: {
        ...authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: finishParams.toString(),
    });
    const finish = (await finishRes.json().catch(() => ({}))) as {
      success?: boolean;
      id?: string;
      error?: { message?: string };
    };
    if (!finishRes.ok) {
      throw new Error(
        `Facebook Page Video finish failed (${finishRes.status}): ${finish.error?.message ?? JSON.stringify(finish)}`,
      );
    }

    this.authByVideoId.set(videoId, auth);
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

    const res = await this.fetchImpl(
      this.graphUrl(`${platformPostId}?fields=status,title,privacy,permalink_url`),
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${auth.pageAccessToken}`, accept: 'application/json' },
      },
    );
    const data = (await res.json().catch(() => ({}))) as {
      status?: { video_status?: string; processing_progress?: number } | string;
      privacy?: { value?: string } | string;
      error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
    };

    const errMsg = [data.error?.message, data.error?.error_user_msg].filter(Boolean).join(' ');
    if (!res.ok || data.error) {
      if (FacebookAdapter.isMissingVideoError(res.status, data.error?.code, errMsg)) {
        return {
          live: false,
          issues: [
            {
              code: 'video-deleted',
              message: `Video was removed from Facebook${errMsg ? `: ${errMsg}` : '.'}`,
              severity: 'BLOCK',
            },
          ],
        };
      }
      if (FacebookAdapter.looksLikeCopyright(errMsg)) {
        return {
          live: false,
          issues: [
            {
              code: 'copyright',
              message: errMsg || 'Facebook reported a copyright / rights issue.',
              severity: 'BLOCK',
            },
          ],
        };
      }
      return {
        live: false,
        issues: [
          {
            code: 'video-error',
            message: errMsg || `Facebook status GET failed (${res.status}).`,
            severity: 'BLOCK',
          },
        ],
      };
    }

    const videoStatus = (
      typeof data.status === 'string' ? data.status : (data.status?.video_status ?? 'unknown')
    ).toLowerCase();
    const privacy =
      typeof data.privacy === 'string'
        ? data.privacy.toLowerCase()
        : String(data.privacy?.value ?? '').toLowerCase();

    const issues: PlatformIssue[] = [];
    let live = false;

    if (FacebookAdapter.looksLikeCopyright(videoStatus)) {
      issues.push({
        code: 'copyright',
        message: `Facebook copyright/rights status: ${videoStatus}`,
        severity: 'BLOCK',
      });
      return { live: false, issues };
    }

    if (videoStatus === 'ready' || videoStatus === 'published' || videoStatus === 'live') {
      live = true;
      if (privacy === 'secret' || privacy === 'self_only') {
        issues.push({
          code: 'privacy-restricted',
          message: `Facebook video privacy is "${privacy}" (may indicate a rights restriction).`,
          severity: 'WARNING',
        });
      }
    } else if (videoStatus === 'error' || videoStatus === 'expired' || videoStatus === 'failed') {
      const msg = `Facebook reported video_status "${videoStatus}".`;
      issues.push({
        code: FacebookAdapter.looksLikeCopyright(msg) ? 'copyright' : `video-${videoStatus}`,
        message: msg,
        severity: 'BLOCK',
      });
    } else {
      issues.push({
        code: 'processing',
        message: `Facebook video_status "${videoStatus}".`,
        severity: 'INFO',
      });
    }

    return { live, issues };
  }

  /**
   * Delete a Page video / Reel from Facebook.
   * Call {@link primeVerifyAuth} first so the page token is available.
   */
  async delete(platformPostId: string): Promise<void> {
    const auth = this.authByVideoId.get(platformPostId);
    if (!auth) {
      throw new Error(
        `FacebookAdapter.delete: no page token cached for video ${platformPostId}. ` +
          'Call primeVerifyAuth(videoId, { pageId, pageAccessToken }) first.',
      );
    }
    const res = await this.fetchImpl(this.graphUrl(platformPostId), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${auth.pageAccessToken}`, accept: 'application/json' },
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      error?: { message?: string; code?: number };
    };
    if (res.ok && (data.success === true || data.success === undefined)) {
      this.authByVideoId.delete(platformPostId);
      return;
    }
    // Already gone — treat as success for idempotent deletes.
    if (FacebookAdapter.isMissingVideoError(res.status, data.error?.code, data.error?.message ?? '')) {
      this.authByVideoId.delete(platformPostId);
      return;
    }
    throw new Error(
      `Facebook delete failed (${res.status}): ${data.error?.message ?? JSON.stringify(data)}`,
    );
  }

  static looksLikeCopyright(text: string): boolean {
    return /copyright|claim|takedown|rights.?manager|infring|dmca|muted|matched.?third.?party|content.?id/i.test(
      text,
    );
  }

  static isMissingVideoError(httpStatus: number, graphCode: number | undefined, message: string): boolean {
    if (httpStatus === 404) return true;
    // Graph: 100 unsupported get / 803 unknown path / 33 object missing
    if (graphCode === 100 || graphCode === 803 || graphCode === 33) return true;
    return /does not exist|unsupported get request|nonexisting|has been deleted|was deleted|cannot be found/i.test(
      message,
    );
  }

  getConstraints(): PlatformConstraints {
    return {
      // Page Videos allow up to 40 minutes; Reels path is chosen when ≤90s.
      maxDurationSec: FACEBOOK_PAGE_VIDEO_MAX_DURATION_SEC,
      maxBytes: 4 * 1024 * 1024 * 1024,
      maxTitleLength: 255,
      maxTags: 30,
      allowedFormats: ['mp4', 'mov'],
    };
  }
}
