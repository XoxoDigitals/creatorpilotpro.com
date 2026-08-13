/**
 * Ingestion job contract (docs/04 §1–3). Each stage rides its own pg-boss queue
 * (WATCHER → DOWNLOAD → MEDIA), so unlike the publish queue there is one payload
 * type per queue. Payloads are still typed + guarded so a stage's shape is
 * defined in exactly one place, mirroring publish-jobs.ts.
 */

/** WATCHER: poll one watched source for new videos. */
export interface WatchJob {
  kind: 'watch';
  watchedSourceId: string;
}

/**
 * DOWNLOAD: fetch one discovered source video to the hot tier + dedupe.
 *
 * TODO(gdrive): after MEDIA produces FINAL, archive ORIGINAL (and optionally
 * the source download) to Drive when STORAGE_BACKEND=gdrive — today only
 * API uploads + render FINALs are archived; source downloads still land on disk.
 */
export interface DownloadJob {
  kind: 'download';
  sourceVideoId: string;
}

/** MEDIA: trim/normalize a downloaded video into a reviewable ContentItem. */
export interface MediaJob {
  kind: 'media';
  sourceVideoId: string;
}

export function isWatchJob(data: unknown): data is WatchJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'watch' &&
    typeof (data as WatchJob).watchedSourceId === 'string'
  );
}

export function isDownloadJob(data: unknown): data is DownloadJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'download' &&
    typeof (data as DownloadJob).sourceVideoId === 'string'
  );
}

export function isMediaJob(data: unknown): data is MediaJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'media' &&
    typeof (data as MediaJob).sourceVideoId === 'string'
  );
}

/** MEDIA: generate auto-subtitles for a rendered content item (Phase 7 #9). */
export interface SubtitlesJob {
  kind: 'subtitles';
  contentItemId: string;
}

export function isSubtitlesJob(data: unknown): data is SubtitlesJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'subtitles' &&
    typeof (data as SubtitlesJob).contentItemId === 'string'
  );
}

/** WATCHER: poll one competitor channel for new videos (Phase 4). */
export interface CompetitorPollJob {
  kind: 'competitor_poll';
  competitorChannelId: string;
}

export function isCompetitorPollJob(data: unknown): data is CompetitorPollJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'competitor_poll' &&
    typeof (data as CompetitorPollJob).competitorChannelId === 'string'
  );
}
