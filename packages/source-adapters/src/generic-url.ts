import { YtDlp } from './ytdlp.js';
import { isKuaishouUrl, resolveKuaishou } from './kuaishou-resolver.js';
import { downloadWithProgress } from './http-download.js';
import type {
  SourceAdapter,
  WatchedSource,
  VideoRef,
  DownloadResult,
  SourceProgressCallback,
} from './types.js';

/**
 * Generic URL source adapter — the bulk-import fallback (docs/01 FR-B2).
 *
 * Routes by host: Kuaishou links are resolved to a direct CDN mp4 and streamed
 * over plain HTTP (yt-dlp has no extractor for them); everything else goes
 * through yt-dlp, which covers YouTube and ~1800 other sites.
 */
export class GenericUrlAdapter implements SourceAdapter {
  readonly type = 'GENERIC_URL' as const;

  constructor(
    private readonly ytdlp: YtDlp = new YtDlp(),
    /** Injectable for tests — resolves a Kuaishou share URL to a direct mp4. */
    private readonly resolve: typeof resolveKuaishou = resolveKuaishou,
    /** Injectable for tests — streams a direct URL to disk with progress. */
    private readonly httpDownload: typeof downloadWithProgress = downloadWithProgress,
  ) {}

  async listNewVideos(source: WatchedSource): Promise<VideoRef[]> {
    // Bulk import treats the source URL itself as the single video ref.
    return [{ sourcePlatformId: source.url, sourceUrl: source.url }];
  }

  async download(
    videoRef: VideoRef,
    destPath: string,
    onProgress?: SourceProgressCallback,
  ): Promise<DownloadResult> {
    if (isKuaishouUrl(videoRef.sourceUrl)) {
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

    const meta = await this.ytdlp.download(videoRef.sourceUrl, destPath, onProgress);
    return { localPath: destPath, ...meta };
  }
}
