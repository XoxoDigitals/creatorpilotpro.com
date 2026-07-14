import type { SourceAdapter, WatchedSource, VideoRef, DownloadResult } from './types.js';

/**
 * Kuaishou profile source adapter (docs/01 FR-B, docs/04 §1).
 * Best-effort profile monitoring; no official API (scraping is fragile).
 * TODO(ingest): implement profile listing + yt-dlp download wrapper.
 */
export class KuaishouAdapter implements SourceAdapter {
  readonly type = 'KUAISHOU_PROFILE' as const;

  async listNewVideos(_source: WatchedSource): Promise<VideoRef[]> {
    throw new Error('TODO(ingest): KuaishouAdapter.listNewVideos not implemented yet');
  }

  async download(_videoRef: VideoRef, _destPath: string): Promise<DownloadResult> {
    throw new Error('TODO(ingest): KuaishouAdapter.download not implemented yet');
  }
}
