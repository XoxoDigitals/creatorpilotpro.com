'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { relativeTime } from '@/lib/format';
import { getDramasView, createDramaSeries, type CreateSeriesInput } from '@/lib/api-data';
import type { DramaSeries, DramaStatus } from '@/lib/domain-types';

const STATUS: Record<DramaStatus, { tone: BadgeTone; label: string }> = {
  PLANNING: { tone: 'neutral', label: 'Planning' },
  BIBLE_GENERATING: { tone: 'amber', label: 'Generating bible' },
  BIBLE_READY: { tone: 'indigo', label: 'Bible ready' },
  IN_PRODUCTION: { tone: 'indigo', label: 'In production' },
  COMPLETE: { tone: 'green', label: 'Complete' },
  FAILED: { tone: 'red', label: 'Failed' },
};

export default function AccountDramasPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [dramas, setDramas] = useState<DramaSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await getDramasView(id);
      setDramas(result.dramas);
      setDemo(result.demo);
    } catch {
      toast('Failed to load drama series', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  function handleNewSeries() {
    if (demo) {
      toast('Demo mode — connect a real account to create drama series', 'info');
      return;
    }
    setShowWizard(true);
  }

  async function handleCreate(input: CreateSeriesInput) {
    try {
      await createDramaSeries(id, input);
      toast('Series created — bible generation started', 'success');
      setShowWizard(false);
      void load();
    } catch {
      toast('Failed to create series', 'error');
    }
  }

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-10 w-full" /><Skeleton className="h-64 w-full" /></div>;
  }

  if (dramas.length === 0 && !showWizard) {
    return (
      <EmptyState
        title="No drama series yet"
        hint="Start a series and the system generates the story bible, character sheets, and per-episode prompts for your team."
        cta={
          <Button variant="primary" size="sm" onClick={handleNewSeries}>
            New series
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {demo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo data — connect a real account and enable dramas to use the AI series engine.
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Episode prompts unlock as previous episodes are uploaded, keeping the story consistent.
        </p>
        <Button variant="primary" size="sm" onClick={handleNewSeries}>
          New series
        </Button>
      </div>

      {showWizard && (
        <NewSeriesForm onSubmit={handleCreate} onCancel={() => setShowWizard(false)} />
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dramas.map((d) => {
          const s = STATUS[d.status] ?? STATUS.PLANNING;
          const pct = d.episodes === 0 ? 0 : Math.round((d.producedEpisodes / d.episodes) * 100);
          return (
            <Card key={d.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-zinc-900">{d.title}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{d.genre}</p>
                </div>
                <Badge tone={s.tone}>{s.label}</Badge>
              </div>
              <div className="mt-4">
                <div className="flex items-center justify-between text-xs text-zinc-500">
                  <span className="nums">
                    {d.producedEpisodes}/{d.episodes} episodes
                  </span>
                  <span className="nums">{pct}%</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="h-full rounded-full bg-indigo-500 transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
              <p className="mt-3 text-xs text-zinc-400">started {relativeTime(d.createdAt)}</p>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function NewSeriesForm({ onSubmit, onCancel }: { onSubmit: (input: CreateSeriesInput) => void; onCancel: () => void }) {
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [theme, setTheme] = useState('');
  const [audience, setAudience] = useState('');
  const [episodeCount, setEpisodeCount] = useState('8');
  const [episodeDuration, setEpisodeDuration] = useState('60');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit({
      title: title.trim(),
      genre: genre.trim(),
      theme: theme.trim(),
      audience: audience.trim(),
      episodeCount: Number(episodeCount) || 8,
      episodeDurationSec: Number(episodeDuration) || 60,
    });
  }

  return (
    <Card className="p-4">
      <p className="mb-3 text-sm font-semibold text-zinc-900">New drama series</p>
      <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
        <input className="rounded border border-zinc-300 px-2 py-1.5 text-sm sm:col-span-2" placeholder="Series title" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <input className="rounded border border-zinc-300 px-2 py-1.5 text-sm" placeholder="Genre" value={genre} onChange={(e) => setGenre(e.target.value)} />
        <input className="rounded border border-zinc-300 px-2 py-1.5 text-sm" placeholder="Theme" value={theme} onChange={(e) => setTheme(e.target.value)} />
        <input className="rounded border border-zinc-300 px-2 py-1.5 text-sm" placeholder="Target audience" value={audience} onChange={(e) => setAudience(e.target.value)} />
        <div className="flex gap-2">
          <input className="w-20 rounded border border-zinc-300 px-2 py-1.5 text-sm" type="number" min={1} placeholder="Episodes" value={episodeCount} onChange={(e) => setEpisodeCount(e.target.value)} />
          <input className="w-24 rounded border border-zinc-300 px-2 py-1.5 text-sm" type="number" min={15} placeholder="Duration (s)" value={episodeDuration} onChange={(e) => setEpisodeDuration(e.target.value)} />
        </div>
        <div className="flex gap-2 sm:col-span-2">
          <Button variant="primary" size="sm" type="submit">Create series</Button>
          <Button size="sm" type="button" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
