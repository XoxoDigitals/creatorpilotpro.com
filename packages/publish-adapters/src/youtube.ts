import type {
  PublishAdapter,
  PublishTarget,
  LocalFile,
  ResolvedMetadata,
  PlatformIssue,
  PlatformConstraints,
} from './types.js';

/**
 * YouTube adapter (docs/06 §2). OAuth2 per channel; videos.insert (resumable);
 * status.publishAt scheduling; verify via videos.list uploadStatus/rejectionReason.
 * TODO(publishing): implement googleapis calls + per-channel credential set + quota handling.
 */
export class YouTubeAdapter implements PublishAdapter {
  readonly platform = 'YOUTUBE' as const;

  async publish(
    _target: PublishTarget,
    _media: LocalFile,
    _meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }> {
    throw new Error('TODO(publishing): YouTubeAdapter.publish not implemented yet');
  }

  async verify(_platformPostId: string): Promise<{ live: boolean; issues: PlatformIssue[] }> {
    throw new Error('TODO(publishing): YouTubeAdapter.verify not implemented yet');
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
