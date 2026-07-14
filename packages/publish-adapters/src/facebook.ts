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
 * Path: /{page-id}/video_reels start -> upload -> finish. Page/system-user tokens.
 * TODO(publishing): implement Graph API Reels publishing + webhook status verify.
 */
export class FacebookAdapter implements PublishAdapter {
  readonly platform = 'FACEBOOK' as const;

  async publish(
    _target: PublishTarget,
    _media: LocalFile,
    _meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }> {
    throw new Error('TODO(publishing): FacebookAdapter.publish not implemented yet');
  }

  async verify(_platformPostId: string): Promise<{ live: boolean; issues: PlatformIssue[] }> {
    throw new Error('TODO(publishing): FacebookAdapter.verify not implemented yet');
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
