'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SourceStatusBadge } from '@/components/ui/status-badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { relativeTime, absoluteTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { BulkImportModal } from '@/components/source-modals';
import {
  getSourcesView,
  checkSourceNow,
  setSourcePaused,
  deleteSource,
  deleteSourceVideo,
  getSourceVideos,
  retryDownload,
  type SourceVideoView,
} from '@/lib/api-data';
import { ApiError } from '@/lib/api';
import type { Source } from '@/lib/domain-types';

/** Internal DownloadStatus → user-facing pill. DB keeps DONE / SKIPPED_DUPLICATE. */
const DOWNLOAD_STATUS_UI: Record<
  SourceVideoView['downloadStatus'],
  { tone: 'neutral' | 'amber' | 'green' | 'red' | 'indigo'; label: string }
> = {
  PENDING: { tone: 'neutral', label: 'QUEUED' },
  DOWNLOADING: { tone: 'amber', label: 'DOWNLOADING' },
  DONE: { tone: 'green', label: 'DOWNLOADED' },
  FAILED: { tone: 'red', label: 'FAILED' },
  SKIPPED_DUPLICATE: { tone: 'indigo', label: 'SKIPPED' },
};

const FAST_POLL_MS = 2_000;
const IDLE_POLL_MS = 15_000;

function isActiveDownload(status: string): boolean {
  return status === 'PENDING' || status === 'DOWNLOADING' || status === 'PROCESSING';
}

export default function AccountSourcesPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [videosBySource, setVideosBySource] = useState<Record<string, SourceVideoView[] | 'loading' | 'error'>>({});

  const videosRef = useRef(videosBySource);
  videosRef.current = videosBySource;
  const expandedRef = useRef(expandedId);
  expandedRef.current = expandedId;

  /** Silent re-fetch (no 'loading' flash) — used for polling live progress. */
  const refreshVideos = useCallback(async (sourceId: string) => {
    try {
      const v = await getSourceVideos(sourceId);
      setVideosBySource((m) => ({ ...m, [sourceId]: v }));
      return v;
    } catch {
      return null;
    }
  }, []);

  const refreshSources = useCallback(async () => {
    try {
      const { sources: list, demo: isDemo } = await getSourcesView(id);
      setSources(list);
      setDemo(isDemo);
      return list;
    } catch {
      return null;
    }
  }, [id]);

  async function toggleExpand(sourceId: string) {
    if (expandedId === sourceId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(sourceId);
    if (!videosBySource[sourceId] || videosBySource[sourceId] === 'error') {
      setVideosBySource((m) => ({ ...m, [sourceId]: 'loading' }));
      try {
        const v = await getSourceVideos(sourceId);
        setVideosBySource((m) => ({ ...m, [sourceId]: v }));
      } catch {
        setVideosBySource((m) => ({ ...m, [sourceId]: 'error' }));
      }
    }
  }

  const hasActiveDownloads = Object.values(videosBySource).some(
    (vids) => Array.isArray(vids) && vids.some((v) => isActiveDownload(v.downloadStatus)),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { sources: list, demo: isDemo } = await getSourcesView(id);
        if (cancelled) return;
        setSources(list);
        setDemo(isDemo);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Prefetch video lists so in-flight downloads are visible on parent rows
  // without requiring the Videos panel to be open.
  useEffect(() => {
    if (loading || demo) return;
    for (const s of sources) {
      if (videosBySource[s.id] === undefined) void refreshVideos(s.id);
    }
  }, [loading, demo, sources, videosBySource, refreshVideos]);

  // Fast poll while any item is PENDING/DOWNLOADING/PROCESSING; slow poll when
  // idle so parent-row counts/status still catch up. Never flashes 'loading'.
  useEffect(() => {
    if (demo || loading) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const { sources: list, demo: isDemo } = await getSourcesView(id);
        if (cancelled) return;
        setSources(list);
        setDemo(isDemo);

        const ids = new Set<string>();
        const expanded = expandedRef.current;
        if (expanded) ids.add(expanded);
        for (const s of list) {
          const vids = videosRef.current[s.id];
          if (Array.isArray(vids) && vids.some((v) => isActiveDownload(v.downloadStatus))) {
            ids.add(s.id);
          }
        }
        await Promise.all(
          [...ids].map(async (sourceId) => {
            if (cancelled) return;
            try {
              const v = await getSourceVideos(sourceId);
              if (cancelled) return;
              setVideosBySource((m) => ({ ...m, [sourceId]: v }));
            } catch {
              /* keep the last good list */
            }
          }),
        );
      } catch {
        /* keep the last good list */
      }
    };

    void tick();
    const t = window.setInterval(() => void tick(), hasActiveDownloads ? FAST_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [id, demo, loading, hasActiveDownloads]);

  const runAction = async (sourceId: string, action: () => Promise<void>, done: string) => {
    if (demo) return toast('Connect a real account to manage sources', 'info');
    setBusyId(sourceId);
    try {
      await action();
      toast(done, 'success');
      await refreshSources();
      if (expandedRef.current) void refreshVideos(expandedRef.current);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onDone = async () => {
    const list = await refreshSources();
    const newest = list?.[0];
    if (newest) {
      setExpandedId(newest.id);
      void refreshVideos(newest.id);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Bulk-import video URLs to ingest them. Existing watched profiles stay listed and are still checked automatically.
        </p>
        <div className="flex gap-2">
          <Button variant="primary" size="sm" onClick={() => setImportOpen(true)}>
            Bulk import URLs
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="p-4 text-sm text-zinc-500">Loading sources…</p>
      ) : sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          hint="Bulk-import video URLs to start the ingestion pipeline for this account."
          cta={
            <Button variant="primary" size="sm" onClick={() => setImportOpen(true)}>
              Bulk import URLs
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Source</TH>
              <TH>Type</TH>
              <TH>Check interval</TH>
              <TH>Last checked</TH>
              <TH numeric>Videos</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {sources.map((s) => {
              const isBatch = s.type === 'BULK_IMPORT';
              const paused = s.status === 'PAUSED';
              const expanded = expandedId === s.id;
              const vids = videosBySource[s.id];
              return (
                <Fragment key={s.id}>
                  <TR>
                    <TD>
                      <span className="font-medium text-zinc-900">{s.label}</span>
                      <span className="mt-0.5 block max-w-[260px] truncate text-xs text-zinc-400">
                        {s.url}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={s.type === 'WATCHED_PROFILE' ? 'indigo' : 'neutral'}>
                        {s.type === 'WATCHED_PROFILE' ? 'Watched profile' : 'Bulk import'}
                      </Badge>
                    </TD>
                    <TD>{s.checkIntervalHours > 0 ? `every ${s.checkIntervalHours}h` : '—'}</TD>
                    <TD title={absoluteTime(s.lastCheckedAt)}>{relativeTime(s.lastCheckedAt)}</TD>
                    <TD numeric>
                      {s.newItems > 0 ? (
                        <Badge tone="green" className="nums">
                          {s.newItems}
                        </Badge>
                      ) : (
                        '0'
                      )}
                    </TD>
                    <TD>
                      <SourceRowStatus status={s.status} videos={vids} />
                    </TD>
                    <TD>
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={() => void toggleExpand(s.id)}>
                          {expanded ? 'Hide videos' : 'Videos'}
                        </Button>
                        {!isBatch && (
                          <Button
                            size="sm"
                            disabled={busyId === s.id || paused}
                            title={paused ? 'Resume the source to check it' : 'Poll for new videos now'}
                            onClick={() =>
                              void runAction(s.id, () => checkSourceNow(s.id), 'Check queued')
                            }
                          >
                            Check now
                          </Button>
                        )}
                        {!isBatch && (
                          <Button
                            size="sm"
                            disabled={busyId === s.id}
                            onClick={() =>
                              void runAction(
                                s.id,
                                () => setSourcePaused(s.id, !paused),
                                paused ? 'Resumed' : 'Paused',
                              )
                            }
                          >
                            {paused ? 'Resume' : 'Pause'}
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={busyId === s.id}
                          onClick={() =>
                            void runAction(s.id, () => deleteSource(s.id), 'Source removed')
                          }
                        >
                          Remove
                        </Button>
                      </div>
                    </TD>
                  </TR>
                  {expanded && (
                    <TR>
                      <TD colSpan={7} className="bg-zinc-50">
                        <SourceVideosPanel
                          videos={vids}
                          onChanged={() => {
                            if (expandedId) void refreshVideos(expandedId);
                          }}
                        />
                      </TD>
                    </TR>
                  )}
                </Fragment>
              );
            })}
          </TBody>
        </Table>
      )}

      <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
        Once a video reaches <b>DOWNLOADED</b> here, the media processor turns it into a content item and it lands in this account&apos;s <a className="font-medium underline" href={`/accounts/${id}/review`}>Review queue</a>.
      </div>

      <BulkImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        accountId={id}
        onDone={() => void onDone()}
      />
    </div>
  );
}

function SourceRowStatus({
  status,
  videos,
}: {
  status: Source['status'];
  videos: SourceVideoView[] | 'loading' | 'error' | undefined;
}) {
  if (Array.isArray(videos)) {
    const downloading = videos.filter((v) => v.downloadStatus === 'DOWNLOADING');
    if (downloading.length > 0) {
      const pct = Math.round(
        downloading.reduce((n, v) => n + v.downloadPercent, 0) / downloading.length,
      );
      return <Badge tone="amber">DOWNLOADING {pct}%</Badge>;
    }
    if (videos.some((v) => v.downloadStatus === 'PENDING')) {
      return <Badge tone="neutral">{DOWNLOAD_STATUS_UI.PENDING.label}</Badge>;
    }
    if (videos.length > 0) {
      const keys: Array<keyof typeof DOWNLOAD_STATUS_UI> = [];
      if (videos.some((v) => v.downloadStatus === 'DONE')) keys.push('DONE');
      if (videos.some((v) => v.downloadStatus === 'SKIPPED_DUPLICATE')) keys.push('SKIPPED_DUPLICATE');
      if (videos.some((v) => v.downloadStatus === 'FAILED')) keys.push('FAILED');
      const showSource = status === 'PAUSED' || status === 'ERROR';
      return (
        <span className="inline-flex flex-wrap items-center gap-1">
          {keys.map((k) => (
            <Badge key={k} tone={DOWNLOAD_STATUS_UI[k].tone}>
              {DOWNLOAD_STATUS_UI[k].label}
            </Badge>
          ))}
          {showSource && <SourceStatusBadge status={status} />}
        </span>
      );
    }
  }
  return <SourceStatusBadge status={status} />;
}

function SourceVideosPanel({
  videos,
  onChanged,
}: {
  videos: SourceVideoView[] | 'loading' | 'error' | undefined;
  onChanged?: () => void;
}) {
  const toast = useToast();
  const onRetry = async (videoId: string) => {
    try {
      await retryDownload(videoId);
      toast('Download re-queued.', 'success');
      onChanged?.();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Retry failed', 'error');
    }
  };
  const onDelete = async (video: SourceVideoView) => {
    if (!confirm(`Delete video “${video.title ?? video.sourceUrl}”?`)) return;
    try {
      await deleteSourceVideo(video.id);
      toast('Video deleted', 'success');
      onChanged?.();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Delete failed', 'error');
    }
  };
  if (videos === undefined || videos === 'loading') {
    return <p className="p-3 text-xs text-zinc-500">Loading videos…</p>;
  }
  if (videos === 'error') {
    return <p className="p-3 text-xs text-red-600">Failed to load videos.</p>;
  }
  if (videos.length === 0) {
    return <p className="p-3 text-xs text-zinc-500">No videos for this source yet.</p>;
  }
  const dripSummary = videos.find((v) => v.downloadDripSummary)?.downloadDripSummary;
  return (
    <div className="p-3">
      {dripSummary && (
        <p className="mb-2 rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 text-[11px] text-zinc-600">
          {dripSummary}
        </p>
      )}
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-2 py-1 text-left">URL</th>
            <th className="px-2 py-1 text-left">Title</th>
            <th className="px-2 py-1 text-left">Status</th>
            <th className="px-2 py-1 text-left">Progress</th>
            <th className="px-2 py-1 text-left">Next download</th>
            <th className="px-2 py-1 text-left">Added</th>
            <th className="px-2 py-1 text-left"> </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {videos.map((v) => (
            <tr key={v.id}>
              <td className="max-w-[280px] truncate px-2 py-1">
                <a
                  href={v.sourceUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-indigo-700 hover:underline"
                >
                  {v.sourceUrl}
                </a>
              </td>
              <td className="px-2 py-1 text-zinc-800">{v.title ?? '—'}</td>
              <td className="px-2 py-1">
                <Badge tone={DOWNLOAD_STATUS_UI[v.downloadStatus].tone}>
                  {DOWNLOAD_STATUS_UI[v.downloadStatus].label}
                </Badge>
              </td>
              <td className="px-2 py-1">
                <ProgressCell v={v} onRetry={() => onRetry(v.id)} />
              </td>
              <td
                className="px-2 py-1 text-zinc-600"
                title={v.nextDownloadAt ? absoluteTime(v.nextDownloadAt) : undefined}
              >
                {v.downloadStatus === 'PENDING'
                  ? (v.nextDownloadLabel ?? 'Queued')
                  : v.downloadStatus === 'DOWNLOADING'
                    ? 'In progress'
                    : '—'}
              </td>
              <td className="px-2 py-1 text-zinc-500" title={absoluteTime(v.createdAt)}>
                {relativeTime(v.createdAt)}
              </td>
              <td className="px-2 py-1">
                <button
                  type="button"
                  onClick={() => void onDelete(v)}
                  className="rounded-md border border-red-300 bg-white px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgressCell({ v, onRetry }: { v: SourceVideoView; onRetry: () => void | Promise<void> }) {
  if (v.downloadStatus === 'DONE') return <span className="text-green-600">100%</span>;
  if (v.downloadStatus === 'SKIPPED_DUPLICATE') {
    return (
      <span className="inline-flex items-center gap-2">
        <span
          className="text-zinc-400"
          title="Exact match of a video already ingested on this account. Other accounts may still import the same URL."
        >
          same account
        </span>
        <button
          type="button"
          onClick={() => void onRetry()}
          className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
          title="Re-queue download (e.g. after a false positive)."
        >
          Retry
        </button>
      </span>
    );
  }
  if (v.downloadStatus === 'FAILED') {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-red-600">failed</span>
        <button
          type="button"
          onClick={() => void onRetry()}
          className="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-[11px] text-zinc-700 hover:bg-zinc-50"
        >
          Retry
        </button>
      </span>
    );
  }

  const pct = Math.round(v.downloadPercent);
  const bits: string[] = [`${pct}%`];
  if (v.downloadSpeedBps) bits.push(fmtSpeed(v.downloadSpeedBps));
  if (v.downloadEtaSec != null) bits.push(`ETA ${fmtEta(v.downloadEtaSec)}`);
  // PENDING rows wait on the download drip — show queue ETA, not a false “stuck” retry.
  if (v.downloadStatus === 'PENDING') {
    return (
      <p className="text-[10px] text-zinc-500">
        {v.nextDownloadLabel ?? 'Waiting in drip queue…'}
      </p>
    );
  }
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200">
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            v.downloadStatus === 'DOWNLOADING' ? 'bg-indigo-500' : 'bg-zinc-300',
          )}
          style={{ width: `${Math.max(2, pct)}%` }}
        />
      </div>
      <p className="mt-0.5 flex items-center gap-2 text-[10px] text-zinc-500">
        <span>{bits.join(' · ')}</span>
      </p>
    </div>
  );
}

function fmtSpeed(bps: number): string {
  if (bps >= 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
  return `${bps} B/s`;
}

function fmtEta(sec: number): string {
  if (sec < 60) return `0:${String(sec).padStart(2, '0')}`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}:${String(s).padStart(2, '0')}`;
  const h = Math.floor(m / 60);
  return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
