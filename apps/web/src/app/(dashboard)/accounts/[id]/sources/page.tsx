'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SourceStatusBadge } from '@/components/ui/status-badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { relativeTime, absoluteTime } from '@/lib/format';
import { cn } from '@/lib/cn';
import { AddWatchedProfileModal, BulkImportModal } from '@/components/source-modals';
import {
  getSourcesView,
  checkSourceNow,
  setSourcePaused,
  deleteSource,
  getSourceVideos,
  retryDownload,
  type SourceVideoView,
} from '@/lib/api-data';
import { ApiError } from '@/lib/api';
import type { Source } from '@/lib/domain-types';

const STATUS_TONE: Record<SourceVideoView['downloadStatus'], 'neutral' | 'amber' | 'green' | 'red' | 'indigo'> = {
  PENDING: 'neutral',
  DOWNLOADING: 'amber',
  DONE: 'green',
  FAILED: 'red',
  SKIPPED_DUPLICATE: 'indigo',
};

export default function AccountSourcesPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [videosBySource, setVideosBySource] = useState<Record<string, SourceVideoView[] | 'loading' | 'error'>>({});

  /** Silent re-fetch (no 'loading' flash) — used for polling live progress. */
  const refreshVideos = useCallback(async (sourceId: string) => {
    try {
      const v = await getSourceVideos(sourceId);
      setVideosBySource((m) => ({ ...m, [sourceId]: v }));
    } catch {
      /* keep the last good list */
    }
  }, []);

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

  // Poll the expanded source's videos every 2s while any are still downloading
  // (PENDING or DOWNLOADING) so the progress bars advance live.
  useEffect(() => {
    if (!expandedId) return;
    const vids = videosBySource[expandedId];
    if (!Array.isArray(vids)) return;
    const active = vids.some((v) => v.downloadStatus === 'DOWNLOADING' || v.downloadStatus === 'PENDING');
    if (!active) return;
    const t = setInterval(() => void refreshVideos(expandedId), 2000);
    return () => clearInterval(t);
  }, [expandedId, videosBySource, refreshVideos]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { sources: list, demo: isDemo } = await getSourcesView(id);
      setSources(list);
      setDemo(isDemo);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (sourceId: string, action: () => Promise<void>, done: string) => {
    if (demo) return toast('Connect a real account to manage sources', 'info');
    setBusyId(sourceId);
    try {
      await action();
      toast(done, 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onDone = () => void load();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Watched profiles are checked automatically; new videos land in this account&apos;s review queue.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setImportOpen(true)}>
            Bulk import URLs
          </Button>
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
            Add watched profile
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="p-4 text-sm text-zinc-500">Loading sources…</p>
      ) : sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          hint="Add a watched profile URL or bulk-import video URLs to start the ingestion pipeline for this account."
          cta={
            <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
              Add watched profile
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
                      <SourceStatusBadge status={s.status} />
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
                        <SourceVideosPanel videos={vids} />
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
        Once a video reaches <b>DONE</b> here, the media processor turns it into a content item and it lands in this account&apos;s <a className="font-medium underline" href={`/accounts/${id}/review`}>Review queue</a>.
      </div>

      <AddWatchedProfileModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        accountId={id}
        onDone={onDone}
      />
      <BulkImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        accountId={id}
        onDone={onDone}
      />
    </div>
  );
}

function SourceVideosPanel({ videos }: { videos: SourceVideoView[] | 'loading' | 'error' | undefined }) {
  const toast = useToast();
  const onRetry = async (videoId: string) => {
    try {
      await retryDownload(videoId);
      // The 2s auto-poll in the parent will pick up the reset row & new progress.
      toast('Download re-queued.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Retry failed', 'error');
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
  return (
    <div className="p-3">
      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wide text-zinc-500">
          <tr>
            <th className="px-2 py-1 text-left">URL</th>
            <th className="px-2 py-1 text-left">Title</th>
            <th className="px-2 py-1 text-left">Status</th>
            <th className="w-[240px] px-2 py-1 text-left">Progress</th>
            <th className="px-2 py-1 text-left">Added</th>
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
                <Badge tone={STATUS_TONE[v.downloadStatus]}>{v.downloadStatus}</Badge>
              </td>
              <td className="px-2 py-1">
                <ProgressCell v={v} onRetry={() => onRetry(v.id)} />
              </td>
              <td className="px-2 py-1 text-zinc-500" title={absoluteTime(v.createdAt)}>
                {relativeTime(v.createdAt)}
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
  // A PENDING row that has been sitting for more than a couple of minutes almost
  // always means the worker never picked it up (crash between enqueue and run,
  // singleton-key collision, restart mid-flight). Surface a Retry so the user
  // can nudge it without having to delete + re-import the whole source.
  const stuck =
    v.downloadStatus === 'PENDING' && Date.now() - new Date(v.createdAt).getTime() > 2 * 60_000;
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
        <span>{v.downloadStatus === 'PENDING' ? 'queued…' : bits.join(' · ')}</span>
        {stuck && (
          <button
            type="button"
            onClick={() => void onRetry()}
            className="rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-[10px] text-zinc-700 hover:bg-zinc-50"
            title="Been queued for a while — nudge the worker to pick it up again."
          >
            Retry
          </button>
        )}
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
