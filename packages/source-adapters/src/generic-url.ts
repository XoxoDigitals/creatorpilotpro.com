import { YtDlp } from './ytdlp.js';
import type { SourceAdapter, WatchedSource, VideoRef, DownloadResult } from './types.js';

/**
 * Generic URL source adapter — the bulk-import fallback (docs/01 FR-B2).
 * Wraps yt-dlp for arbitrary supported URLs.
 */
export class GenericUrlAdapter implements SourceAdapter {
  readonly type = 'GENERIC_URL' as const;

  constructor(private readonly ytdlp: YtDlp = new YtDlp()) {}

  async listNewVideos(source: WatchedSource): Promise<VideoRef[]> {
    // Bulk import treats the source URL itself as the single video ref.
    return [{ sourcePlatformId: source.url, sourceUrl: source.url }];
  }

  async download(videoRef: VideoRef, destPath: string): Promise<DownloadResult> {
    const meta = await this.ytdlp.download(videoRef.sourceUrl, destPath);
    return { localPath: destPath, ...meta };
  }
}
