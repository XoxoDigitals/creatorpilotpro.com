'use client';

import { useParams } from 'next/navigation';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { relativeTime } from '@/lib/format';
import { getDramas } from '@/lib/mock-data';
import type { DramaStatus } from '@/lib/domain-types';

const STATUS: Record<DramaStatus, { tone: BadgeTone; label: string }> = {
  PLANNING: { tone: 'neutral', label: 'Planning' },
  IN_PRODUCTION: { tone: 'indigo', label: 'In production' },
  PUBLISHING: { tone: 'green', label: 'Publishing' },
  COMPLETE: { tone: 'neutral', label: 'Complete' },
};

export default function AccountDramasPage() {
  const { id } = useParams<{ id: string }>();
  const dramas = getDramas(id);
  const toast = useToast();

  const comingSoon = () => toast('The drama series wizard arrives in Phase 5', 'info');

  if (dramas.length === 0) {
    return (
      <EmptyState
        title="No drama series yet"
        hint="Start a series and the system generates the story bible, character sheets, and per-episode prompts for your team."
        cta={
          <Button variant="primary" size="sm" onClick={comingSoon}>
            New series
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Episode prompts unlock as previous episodes are uploaded, keeping the story consistent.
        </p>
        <Button variant="primary" size="sm" onClick={comingSoon}>
          New series
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {dramas.map((d) => {
          const s = STATUS[d.status];
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
