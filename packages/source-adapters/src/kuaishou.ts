import { YtDlp } from './ytdlp.js';
import type { SourceAdapter, WatchedSource, VideoRef, DownloadResult } from './types.js';

/** Newest N entries pulled per poll; the watcher dedupes by sourcePlatformId. */
const LIST_LIMIT = 20;

/**
 * Kuaishou profile source adapter (docs/01 FR-B, docs/04 §1).
 * Best-effort profile monitoring via yt-dlp; there is no official API.
 */
export class KuaishouAdapter implements SourceAdapter {
  readonly type = 'KUAISHOU_PROFILE' as const;

  constructor(private readonly ytdlp: YtDlp = new YtDlp()) {}

  async listNewVideos(source: WatchedSource): Promise<VideoRef[]> {
    return this.ytdlp.listEntries(source.url, LIST_LIMIT);
  }

  async download(videoRef: VideoRef, destPath: string): Promise<DownloadResult> {
    const meta = await this.ytdlp.download(videoRef.sourceUrl, destPath);
    return { localPath: destPath, ...meta };
  }
}
