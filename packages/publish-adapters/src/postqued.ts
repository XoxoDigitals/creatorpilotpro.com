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
 * TikTok via PostQued adapter (docs/06 §2, validated vs OpenAPI 2026-07-14).
 * Flow: /v2/content/upload -> PUT -> /v2/content/upload/complete -> /v2/publish
 * with Idempotency-Key. We own timing (dispatchAt:null). Verify via /v2/publish/{id}.
 *
 * Credentials: the client is constructed with the owner's PostQued API key. The
 * per-account PostQued integration id is read from `target.auth`:
 *   `{ postquedAccountId: string, workspaceId?: string }`
 * (falls back to `target.accountId` if `postquedAccountId` is absent).
 *
 * publish() returns the PostQued **publishId** as `platformPostId` (not the eventual
 * TikTok post id): the verify job polls status keyed on that publishId, and the real
 * platform post id is surfaced by getPublishStatus once the post goes live.
 */

/** Expected decrypted `target.auth` shape for PostQued-backed adapters. */
interface PostQuedAuth {
  postquedAccountId?: string;
  workspaceId?: string;
}

/** Map our generic visibility to TikTok privacy levels (TikTok Content Posting API). */
function toTikTokPrivacy(visibility: ResolvedMetadata['visibility']): string {
  switch (visibility) {
    case 'PRIVATE':
    case 'UNLISTED': // TikTok has no unlisted concept — keep it self-only.
      return 'SELF_ONLY';
    case 'PUBLIC':
    default:
      return 'PUBLIC_TO_EVERYONE';
  }
}

/** Build a TikTok caption from resolved metadata (title + description + hashtags). */
function buildCaption(meta: ResolvedMetadata): string {
  const parts = [meta.title?.trim(), meta.description?.trim()].filter(
    (p): p is string => !!p && p.length > 0,
  );
  const base = parts.join('\n\n');
  const hashtags = (meta.tags ?? [])
    .map((t) => t.trim().replace(/^#/, ''))
    .filter((t) => t.length > 0)
    .map((t) => `#${t}`);
  return hashtags.length > 0 ? `${base}\n\n${hashtags.join(' ')}`.trim() : base;
}

export class PostQuedAdapter implements PublishAdapter {
  readonly platform = 'TIKTOK' as const;
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

    const options: Record<string, unknown> = {
      privacyLevel: toTikTokPrivacy(meta.visibility),
      disableComment: false,
      disableDuet: false,
      disableStitch: false,
      // aiLabel → TikTok AIGC disclosure. brandContentToggle/brandOrganicToggle are the
      // separate "branded content" flags and stay off unless the caller opts in.
      ...(meta.aiLabel ? { aiGeneratedContent: true, brandContentToggle: false } : {}),
    };

    const { contentId } = await this.client.uploadContent(media);
    const { publishId } = await this.client.publish({
      contentId,
      platform: 'tiktok',
      accountId,
      intent: 'publish',
      caption: buildCaption(meta),
      dispatchAt: null, // we own timing
      options,
      // Stable per-target key so retries dedupe (docs/06 §4 idempotency design).
      idempotencyKey: `scp-${target.id}`,
    });

    return { platformPostId: publishId };
  }

  async verify(platformPostId: string): Promise<{ live: boolean; issues: PlatformIssue[] }> {
    const status = await this.client.getPublishStatus(platformPostId);
    return verifyFromStatus(status);
  }

  getConstraints(): PlatformConstraints {
    return {
      maxDurationSec: 10 * 60,
      maxBytes: 4 * 1024 * 1024 * 1024,
      maxTitleLength: 2200,
      maxTags: 30,
      allowedFormats: ['mp4', 'mov', 'webm'],
    };
  }
}
