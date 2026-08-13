import type {
  PublishAdapter,
  PublishTarget,
  LocalFile,
  ResolvedMetadata,
  PlatformIssue,
  PlatformConstraints,
} from './types.js';

/**
 * Manual adapter (Phase 10). For accounts the Owner publishes to by hand:
 * we run the full pipeline (ingest / AI / render / metadata) and stop at the
 * publish step. The target is marked PUBLISHED with a synthetic platformPostId
 * so downstream state machines behave; the UI surfaces a Download button that
 * streams the final asset, and a Mark-published button the Owner clicks after
 * uploading to the platform themselves.
 *
 * verify() always reports live (no external system to check).
 */
export class ManualAdapter implements PublishAdapter {
  readonly platform: 'YOUTUBE' | 'FACEBOOK' | 'TIKTOK';

  constructor(platform: 'YOUTUBE' | 'FACEBOOK' | 'TIKTOK') {
    this.platform = platform;
  }

  async publish(
    target: PublishTarget,
    _media: LocalFile,
    _meta: ResolvedMetadata,
  ): Promise<{ platformPostId: string }> {
    // Synthetic id so the target row has a stable identifier and the download
    // route can key on target.id anyway. Awaiting the Owner's manual upload
    // is signalled by the account.connectionMethod=MANUAL flag on the UI.
    return { platformPostId: `manual-${target.id}` };
  }

  async verify(_platformPostId: string): Promise<{ live: boolean; issues: PlatformIssue[] }> {
    return { live: true, issues: [] };
  }

  /**
   * Broad constraints so validation never blocks the manual path — the Owner
   * has final say on what the platform accepts.
   */
  getConstraints(): PlatformConstraints {
    return {
      maxDurationSec: 12 * 60 * 60,
      maxBytes: 256 * 1024 * 1024 * 1024,
      maxTitleLength: 500,
      maxTags: 500,
      allowedFormats: ['mp4', 'mov', 'webm', 'm4v'],
    };
  }
}
