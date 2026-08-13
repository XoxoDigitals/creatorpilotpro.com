import type { SourceVideo } from '@scp/db';

/** Public view of a discovered/imported source video (docs/03 Domain 3). */
export interface SourceVideoView {
  id: string;
  watchedSourceId: string | null;
  sourceUrl: string;
  sourcePlatformId: string;
  uploaderName: string | null;
  title: string | null;
  durationSec: number | null;
  publishedAt: string | null;
  downloadStatus: SourceVideo['downloadStatus'];
  downloadPercent: number;
  downloadEtaSec: number | null;
  downloadSpeedBps: number | null;
  perceptualHash: string | null;
  md5: string | null;
  rightsNote: string | null;
  rightsConfirmedById: string | null;
  nearDuplicateOfId: string | null;
  createdAt: string;
}

export function toSourceVideoView(v: SourceVideo): SourceVideoView {
  return {
    id: v.id,
    watchedSourceId: v.watchedSourceId,
    sourceUrl: v.sourceUrl,
    sourcePlatformId: v.sourcePlatformId,
    uploaderName: v.uploaderName,
    title: v.title,
    durationSec: v.durationSec,
    publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
    downloadStatus: v.downloadStatus,
    downloadPercent: v.downloadPercent,
    downloadEtaSec: v.downloadEtaSec,
    downloadSpeedBps: v.downloadSpeedBps,
    perceptualHash: v.perceptualHash,
    md5: v.md5,
    rightsNote: v.rightsNote,
    rightsConfirmedById: v.rightsConfirmedById,
    nearDuplicateOfId: v.nearDuplicateOfId,
    createdAt: v.createdAt.toISOString(),
  };
}
