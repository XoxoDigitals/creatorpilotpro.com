import { YtDlp } from './ytdlp.js';
import { resolveKuaishou } from './kuaishou-resolver.js';
import { downloadWithProgress } from './http-download.js';
import type {
  SourceAdapter,
  WatchedSource,
  VideoRef,
  DownloadResult,
  SourceProgressCallback,
} from './types.js';

/** Newest N entries pulled per poll; the watcher dedupes by sourcePlatformId. */
const LIST_LIMIT = 20;

/**
 * Kuaishou profile source adapter (docs/01 FR-B, docs/04 §1).
 *
 * Listing still goes through yt-dlp (it handles profile pages). Downloading a
 * single video does NOT — yt-dlp has no extractor for Kuaishou share links, so
 * we resolve the direct CDN mp4 ourselves (see kuaishou-resolver.ts) and stream
 * it over plain HTTP. That also gives exact byte-level progress.
 */
export class KuaishouAdapter implements SourceAdapter {
  readonly type = 'KUAISHOU_PROFILE' as const;

  constructor(
    private readonly ytdlp: YtDlp = new YtDlp(),
    /** Injectable for tests — resolves a share URL to a direct CDN mp4. */
    private readonly resolve: typeof resolveKuaishou = resolveKuaishou,
    /** Injectable for tests — streams the CDN URL to disk with progress. */
    private readonly httpDownload: typeof downloadWithProgress = downloadWithProgress,
  ) {}

  async listNewVideos(source: WatchedSource): Promise<VideoRef[]> {
    return this.ytdlp.listEntries(source.url, LIST_LIMIT);
  }

  async download(
    videoRef: VideoRef,
    destPath: string,
    onProgress?: SourceProgressCallback,
  ): Promise<DownloadResult> {
    const resolved = await this.resolve(videoRef.sourceUrl);
    const { bytes, md5 } = await this.httpDownload(resolved.videoUrl, destPath, onProgress, {
      referer: videoRef.sourceUrl,
    });
    return {
      localPath: destPath,
      bytes,
      md5,
      ...(resolved.durationSec != null ? { durationSec: resolved.durationSec } : {}),
      ...(resolved.width != null ? { width: resolved.width } : {}),
      ...(resolved.height != null ? { height: resolved.height } : {}),
    };
  }
}
