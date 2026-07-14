import type { SourceAdapter, WatchedSource, VideoRef, DownloadResult } from './types.js';

/**
 * Generic URL source adapter — the bulk-import fallback (docs/01 FR-B2).
 * Wraps yt-dlp for arbitrary supported URLs.
 * TODO(ingest): implement yt-dlp resolve + download.
 */
export class GenericUrlAdapter implements SourceAdapter {
  readonly type = 'GENERIC_URL' as const;

  async listNewVideos(source: WatchedSource): Promise<VideoRef[]> {
    // Bulk import treats the source URL itself as the single video ref.
    return [{ sourcePlatformId: source.url, sourceUrl: source.url }];
  }

  async download(_videoRef: VideoRef, _destPath: string): Promise<DownloadResult> {
    throw new Error('TODO(ingest): GenericUrlAdapter.download not implemented yet');
  }
}
