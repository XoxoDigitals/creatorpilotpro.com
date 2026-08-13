'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import {
  addCompetitor,
  analyzeCompetitorNow,
  checkCompetitorNow,
  deleteCompetitor,
  getCompetitorVideos,
  patchCompetitor,
  type CompetitorVideoRow,
} from '@/lib/api-data';
import type { CompetitorChannel } from '@/lib/domain-types';

const PAGE_SIZE = 20;

function formatViews(views: string | number): string {
  const n = typeof views === 'number' ? views : Number(views);
  if (!Number.isFinite(n)) return String(views);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatAnalyzedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

interface VideoListState {
  items: CompetitorVideoRow[];
  total: number;
  nextOffset: number | null;
  loading: boolean;
}

export function ReferenceChannelsPanel({
  accountId,
  demo,
  channels,
  onChanged,
}: {
  accountId: string;
  demo: boolean;
  channels: CompetitorChannel[];
  onChanged: () => void;
}) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [videoLists, setVideoLists] = useState<Record<string, VideoListState>>({});
  const [analyzing, setAnalyzing] = useState<string | null>(null);

  async function add() {
    if (demo) {
      toast('Demo mode — connect a real account to add channels', 'info');
      return;
    }
    if (!url.trim()) return toast('Paste a YouTube channel URL or @handle', 'error');
    setBusy(true);
    try {
      await addCompetitor(accountId, { urlOrHandle: url.trim(), checkIntervalMin: 1440 });
      setUrl('');
      toast('Reference channel added — polling started', 'success');
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to add channel', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function loadVideos(channelId: string, offset = 0, append = false) {
    setVideoLists((prev) => ({
      ...prev,
      [channelId]: {
        items: append ? (prev[channelId]?.items ?? []) : [],
        total: prev[channelId]?.total ?? 0,
        nextOffset: prev[channelId]?.nextOffset ?? null,
        loading: true,
      },
    }));
    try {
      const page = await getCompetitorVideos(channelId, { limit: PAGE_SIZE, offset });
      setVideoLists((prev) => {
        const existing = prev[channelId]?.items ?? [];
        return {
          ...prev,
          [channelId]: {
            items: append ? [...existing, ...page.items] : page.items,
            total: page.total,
            nextOffset: page.nextOffset,
            loading: false,
          },
        };
      });
    } catch {
      setVideoLists((prev) => ({
        ...prev,
        [channelId]: {
          items: prev[channelId]?.items ?? [],
          total: prev[channelId]?.total ?? 0,
          nextOffset: prev[channelId]?.nextOffset ?? null,
          loading: false,
        },
      }));
      toast('Failed to load videos', 'error');
    }
  }

  async function toggleExpand(channelId: string) {
    if (expanded === channelId) {
      setExpanded(null);
      return;
    }
    setExpanded(channelId);
    if (!videoLists[channelId]) {
      await loadVideos(channelId, 0, false);
    }
  }

  async function loadMore(channelId: string) {
    const state = videoLists[channelId];
    if (!state || state.nextOffset == null || state.loading) return;
    await loadVideos(channelId, state.nextOffset, true);
  }

  async function checkNow(channelId: string) {
    try {
      await checkCompetitorNow(channelId);
      toast('Check queued — videos & insights refresh shortly', 'success');
      window.setTimeout(() => {
        onChanged();
        if (expanded === channelId) void loadVideos(channelId, 0, false);
      }, 3500);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Check failed', 'error');
    }
  }

  async function analyze(channelId: string) {
    setAnalyzing(channelId);
    try {
      await analyzeCompetitorNow(channelId);
      toast('Performance analysis queued', 'success');
      window.setTimeout(onChanged, 4000);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Analyze failed', 'error');
    } finally {
      setAnalyzing(null);
    }
  }

  async function pauseOrResume(ch: CompetitorChannel) {
    try {
      await patchCompetitor(ch.id, { status: ch.status === 'PAUSED' ? 'ACTIVE' : 'PAUSED' });
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Update failed', 'error');
    }
  }

  async function remove(channelId: string) {
    try {
      await deleteCompetitor(channelId);
      toast('Channel removed', 'success');
      onChanged();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Remove failed', 'error');
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <Field label="YouTube reference channels">
            <Input
              placeholder="https://youtube.com/@channel or @handle"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void add()}
            />
          </Field>
        </div>
        <Button size="sm" variant="primary" onClick={() => void add()} disabled={busy}>
          {busy ? 'Resolving…' : 'Add channel'}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-zinc-400">
        YouTube only for MVP. New channels poll daily (1440 min) by default. Needs a YouTube Data
        API key in{' '}
        <a
          href="/settings/platform-apps"
          className="text-indigo-600 underline hover:text-indigo-800"
        >
          Settings → Platform Apps
        </a>
        .
      </p>

      {channels.length === 0 ? (
        <p className="mt-3 text-xs text-zinc-400">No reference channels yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {channels.map((ch) => {
            const list = videoLists[ch.id];
            const shown = list?.items.length ?? 0;
            const total = list?.total ?? ch.videoCount;
            const insights = ch.performanceInsights;

            return (
              <li key={ch.id} className="rounded-md border border-zinc-100 bg-zinc-50/80 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <button
                    type="button"
                    className="text-left text-[13px] font-medium text-zinc-900 hover:underline"
                    onClick={() => void toggleExpand(ch.id)}
                  >
                    {ch.name}
                    <span className="ml-2 text-[11px] font-normal text-zinc-400">
                      {ch.videoCount} videos · {ch.status.toLowerCase()}
                      {ch.checkIntervalMin ? ` · every ${ch.checkIntervalMin}m` : ''}
                    </span>
                  </button>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      className="rounded px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-white"
                      onClick={() => void checkNow(ch.id)}
                    >
                      Check now
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-white"
                      onClick={() => void analyze(ch.id)}
                      disabled={analyzing === ch.id}
                    >
                      {analyzing === ch.id ? 'Analyzing…' : 'Analyze'}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-0.5 text-[11px] text-zinc-600 hover:bg-white"
                      onClick={() => void pauseOrResume(ch)}
                    >
                      {ch.status === 'PAUSED' ? 'Resume' : 'Pause'}
                    </button>
                    <button
                      type="button"
                      className="rounded px-2 py-0.5 text-[11px] text-red-600 hover:bg-red-50"
                      onClick={() => void remove(ch.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                {ch.errorNote && <p className="mt-1 text-[11px] text-red-600">{ch.errorNote}</p>}

                {expanded === ch.id && (
                  <div className="mt-2 space-y-3 border-t border-zinc-200 pt-2">
                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-zinc-500">Videos</p>
                        <p className="nums text-[11px] text-zinc-400">
                          {list?.loading && shown === 0
                            ? 'Loading…'
                            : `Showing ${shown} of ${total}`}
                        </p>
                      </div>
                      <ul className="max-h-52 space-y-1 overflow-y-auto">
                        {shown === 0 && !list?.loading ? (
                          <li className="text-[11px] text-zinc-400">
                            No videos fetched yet — try Check now.
                          </li>
                        ) : (
                          (list?.items ?? []).map((v) => (
                            <li
                              key={v.id}
                              className="flex justify-between gap-2 text-[11px] text-zinc-600"
                            >
                              <span className="truncate">{v.title}</span>
                              <span className="nums shrink-0 text-zinc-400">
                                {formatViews(v.views)}
                              </span>
                            </li>
                          ))
                        )}
                      </ul>
                      {list?.nextOffset != null && (
                        <button
                          type="button"
                          className="mt-1.5 text-[11px] font-medium text-indigo-600 hover:text-indigo-800 disabled:opacity-50"
                          disabled={list.loading}
                          onClick={() => void loadMore(ch.id)}
                        >
                          {list.loading ? 'Loading…' : 'Load more'}
                        </button>
                      )}
                    </div>

                    <div>
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <p className="text-[11px] font-medium text-zinc-500">
                          Performance insights · Channel memory
                        </p>
                        {insights?.analyzedAt && (
                          <p className="text-[10px] text-zinc-400">
                            Last analyzed {formatAnalyzedAt(insights.analyzedAt)}
                            {insights.aiAvailable ? '' : ' · patterns only'}
                          </p>
                        )}
                      </div>
                      {!insights ? (
                        <p className="text-[11px] text-zinc-400">
                          No insights yet. Run Check now or Analyze after videos are fetched.
                        </p>
                      ) : (
                        <div className="space-y-1.5 text-[11px] text-zinc-600">
                          <p>{insights.summary}</p>
                          {insights.winningTopics.length > 0 && (
                            <p>
                              <span className="font-medium text-zinc-700">Winning topics: </span>
                              {insights.winningTopics.join(', ')}
                            </p>
                          )}
                          {insights.winningHooks.length > 0 && (
                            <p>
                              <span className="font-medium text-zinc-700">Winning hooks: </span>
                              {insights.winningHooks.slice(0, 4).join(' · ')}
                            </p>
                          )}
                          {insights.avoidPatterns.length > 0 && (
                            <p>
                              <span className="font-medium text-zinc-700">Avoid: </span>
                              {insights.avoidPatterns.join('; ')}
                            </p>
                          )}
                          {insights.topExamples.length > 0 && (
                            <ul className="mt-1 space-y-0.5 border-t border-zinc-100 pt-1">
                              {insights.topExamples.map((ex) => (
                                <li key={ex.title} className="flex justify-between gap-2">
                                  <span className="truncate">{ex.title}</span>
                                  <span className="nums shrink-0 text-zinc-400">
                                    {formatViews(ex.views)}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="text-[10px] text-zinc-400">
                            Based on {insights.sampleSize} titles &amp; view counts — inference only,
                            not causal proof.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
