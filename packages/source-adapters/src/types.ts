/** A watched source (docs/03 Domain 3 watched_sources). */
export interface WatchedSource {
  id: string;
  type: 'KUAISHOU_PROFILE' | 'GENERIC_URL';
  url: string;
  label?: string;
  trimStartMs?: number;
}

/** A discovered source video not yet downloaded. */
export interface VideoRef {
  sourcePlatformId: string;
  sourceUrl: string;
  uploaderName?: string;
  title?: string;
  durationSec?: number;
  publishedAt?: Date;
}

export interface DownloadResult {
  localPath: string;
  bytes: number;
  md5: string;
  durationSec?: number;
  width?: number;
  height?: number;
}

/**
 * Source adapter interface (designed for this scaffold, docs/02 boundary rule).
 * listNewVideos discovers new items; download fetches one to local hot storage.
 */
export interface SourceAdapter {
  type: WatchedSource['type'];
  listNewVideos(source: WatchedSource): Promise<VideoRef[]>;
  download(videoRef: VideoRef, destPath: string): Promise<DownloadResult>;
}
