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

/** Live download progress tick (percent/eta/speed) surfaced to the worker. */
export interface SourceDownloadProgress {
  percent: number;
  etaSec?: number;
  speedBps?: number;
}

export type SourceProgressCallback = (p: SourceDownloadProgress) => void;

/**
 * Source adapter interface (designed for this scaffold, docs/02 boundary rule).
 * listNewVideos discovers new items; download fetches one to local hot storage.
 * `onProgress` streams live download progress when the adapter supports it.
 */
export interface SourceAdapter {
  type: WatchedSource['type'];
  listNewVideos(source: WatchedSource): Promise<VideoRef[]>;
  download(
    videoRef: VideoRef,
    destPath: string,
    onProgress?: SourceProgressCallback,
  ): Promise<DownloadResult>;
}
