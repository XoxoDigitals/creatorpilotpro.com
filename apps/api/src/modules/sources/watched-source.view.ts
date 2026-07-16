import type { WatchedSource } from '@scp/db';

/** Public view of a watched source (docs/03 Domain 3). */
export interface WatchedSourceView {
  id: string;
  type: WatchedSource['type'];
  url: string;
  label: string | null;
  checkIntervalMin: number;
  trimStartMs: number;
  status: WatchedSource['status'];
  lastCheckedAt: string | null;
  consecutiveFailures: number;
  errorNote: string | null;
  targetAccountId: string | null;
  videoCount: number;
  createdAt: string;
}

export function toWatchedSourceView(
  s: WatchedSource & { _count?: { videos: number } },
): WatchedSourceView {
  return {
    id: s.id,
    type: s.type,
    url: s.url,
    label: s.label,
    checkIntervalMin: s.checkIntervalMin,
    trimStartMs: s.trimStartMs,
    status: s.status,
    lastCheckedAt: s.lastCheckedAt ? s.lastCheckedAt.toISOString() : null,
    consecutiveFailures: s.consecutiveFailures,
    errorNote: s.errorNote,
    targetAccountId: s.targetAccountId,
    videoCount: s._count?.videos ?? 0,
    createdAt: s.createdAt.toISOString(),
  };
}
