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
 * TODO(publishing): implement PostQued v2 client; replaceable by official TikTok API.
 */
export class PostQuedAdapter implements PublishAdapter {
  readonly platform = 'TIKTOK' as const;

  async publish(
    _target: PublishTarget,
    _media: LocalFile,
    _meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }> {
    throw new Error('TODO(publishing): PostQuedAdapter.publish not implemented yet');
  }

  async verify(_platformPostId: string): Promise<{ live: boolean; issues: PlatformIssue[] }> {
    throw new Error('TODO(publishing): PostQuedAdapter.verify not implemented yet');
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
