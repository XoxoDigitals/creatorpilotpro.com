import {
  PostQuedV2Client,
  verifyFromStatus,
  type PostQuedV2ClientConfig,
} from './postqued-client.js';
import type {
  PublishAdapter,
  PublishTarget,
  LocalFile,
  ResolvedMetadata,
  PlatformIssue,
  PlatformConstraints,
} from './types.js';

/**
 * YouTube adapter — **publishes via PostQued** (Owner decision 2026-07-14, docs/06 §2).
 * Same upload/idempotency/verify machinery as TikTok; only the per-target `options`
 * differ. Direct googleapis upload stays documented as a fallback (interface unchanged).
 *
 * Credentials: constructed with the owner's PostQued API key. The per-channel PostQued
 * integration id is read from `target.auth`:
 *   `{ postquedAccountId: string, workspaceId?: string }`
 * (falls back to `target.accountId`). Google OAuth stays connected per channel but
 * read-only (analytics, thumbnails, claim detection) — not used by this adapter.
 *
 * publish() returns the PostQued **publishId** as `platformPostId`; the verify job polls
 * status on it and the real YouTube video id is surfaced by getPublishStatus once live.
 */

interface PostQuedAuth {
  postquedAccountId?: string;
  workspaceId?: string;
}

/** Map our generic visibility to YouTube's privacyStatus values. */
function toYouTubeVisibility(visibility: ResolvedMetadata['visibility']): string {
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

export class YouTubeAdapter implements PublishAdapter {
  readonly platform = 'YOUTUBE' as const;
  private readonly client: PostQuedV2Client;

  constructor(config: PostQuedV2ClientConfig) {
    this.client = new PostQuedV2Client(config);
  }

  async publish(
    target: PublishTarget,
    media: LocalFile,
    meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }> {
    const auth = target.auth as PostQuedAuth;
    const accountId = auth.postquedAccountId ?? target.accountId;

    // PostQued YouTube options (docs/06 §2 — confirmed against their spec).
    const options: Record<string, unknown> = {
      visibility: toYouTubeVisibility(meta.visibility),
      title: meta.title,
      description: meta.description,
      tags: meta.tags,
      madeForKids: false,
      containsSyntheticMedia: meta.aiLabel ?? false,
      // `category` is a resolved category name/id from the Channel Profile; passed as
      // categoryId. YouTube requires a numeric id — the caller resolves the mapping.
      ...(meta.category ? { categoryId: meta.category } : {}),
    };

    const { contentId } = await this.client.uploadContent(media);
    const { publishId } = await this.client.publish({
      contentId,
      platform: 'youtube',
      accountId,
      intent: 'publish',
      caption: meta.description?.trim() || meta.title,
      dispatchAt: null, // we own timing
      options,
      idempotencyKey: `scp-${target.id}`,
    });

    return { platformPostId: publishId };
  }

  async verify(platformPostId: string): Promise<{ live: boolean; issues: PlatformIssue[] }> {
    const status = await this.client.getPublishStatus(platformPostId);
    return verifyFromStatus(status);
  }

  getConstraints(): PlatformConstraints {
    // Placeholder values — refine against YouTube limits in publishing phase.
    return {
      maxDurationSec: 12 * 60 * 60,
      maxBytes: 256 * 1024 * 1024 * 1024,
      maxTitleLength: 100,
      maxTags: 500,
      allowedFormats: ['mp4', 'mov'],
    };
  }
}
