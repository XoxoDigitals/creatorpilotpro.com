'use client';

import { useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Drawer } from '@/components/ui/drawer';
import { PostStatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { compactNumber, relativeTime, absoluteTime } from '@/lib/format';
import { getAccount, getPosts } from '@/lib/mock-data';
import type { Post } from '@/lib/domain-types';

type Preset = '7D' | '30D' | '90D' | 'CUSTOM';

/** Deterministic pseudo-random helper so mock per-video metrics stay stable. */
function seeded(id: string, salt: number): number {
  let h = salt;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export default function AccountAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const account = getAccount(id);
  const [preset, setPreset] = useState<Preset>('30D');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<Post | null>(null);

  const posts = getPosts(id);

  const range = useMemo(() => {
    const now = Date.now();
    const DAY = 86_400_000;
    if (preset === '7D') return { from: now - 7 * DAY, to: now };
    if (preset === '30D') return { from: now - 30 * DAY, to: now };
    if (preset === '90D') return { from: now - 90 * DAY, to: now };
    return {
      from: from ? Date.parse(from) : now - 30 * DAY,
      to: to ? Date.parse(to) + DAY : now, // inclusive end date
    };
  }, [preset, from, to]);

  if (!account) return null;

  const published = posts.filter((p) => {
    if (p.views == null || !p.publishedAt) return false;
    const t = Date.parse(p.publishedAt);
    return t >= range.from && t <= range.to;
  });
  const totalViews = published.reduce((n, p) => n + (p.views ?? 0), 0);

  return (
    <div className="space-y-6">
      {/* Date range control */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border border-zinc-300 bg-white p-0.5">
          {(['7D', '30D', '90D', 'CUSTOM'] as Preset[]).map((p) => (
            <button
              key={p}
              onClick={() => setPreset(p)}
              className={cn(
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                preset === p ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-800',
              )}
            >
              {p === 'CUSTOM' ? 'Custom' : `Last ${p.replace('D', ' days')}`}
            </button>
          ))}
        </div>
        {preset === 'CUSTOM' && (
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-auto" />
            <span className="text-xs text-zinc-400">to</span>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-auto" />
          </div>
        )}
        <span className="ml-auto text-xs text-zinc-400">
          Metrics are mock until the analytics sync lands (Phase 6) — the controls are real.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Views (range)"
          value={compactNumber(totalViews)}
          hint={`${published.length} published post${published.length === 1 ? '' : 's'}`}
        />
        <StatCard label="Followers" value={compactNumber(account.followers)} delta="+2.4%" hint="current" />
        <StatCard label="Avg. view duration" value="1:42" hint="range avg" />
        {account.monetized ? (
          <StatCard label="Est. revenue" value="$412" delta="+11%" hint="range · RPM $0.171" />
        ) : (
          <StatCard label="Est. revenue" value="—" hint="not monetized" />
        )}
      </div>

      <Card>
        <CardHeader
          title="Per-video performance"
          description="Click any row for the full video breakdown"
        />
        {published.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No published videos in this range"
              hint="Widen the date range, or publish something first."
            />
          </div>
        ) : (
          <Table className="rounded-t-none border-0">
            <THead>
              <TR>
                <TH>Video</TH>
                <TH>Published</TH>
                <TH numeric>Views</TH>
                <TH numeric>Likes</TH>
                <TH numeric>Comments</TH>
                <TH numeric>Avg. watch</TH>
              </TR>
            </THead>
            <TBody>
              {published
                .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
                .map((p) => (
                  <TR key={p.id} onClick={() => setSelected(p)}>
                    <TD className="font-medium text-zinc-900">{p.title}</TD>
                    <TD title={absoluteTime(p.publishedAt)}>{relativeTime(p.publishedAt)}</TD>
                    <TD numeric>{compactNumber(p.views ?? 0)}</TD>
                    <TD numeric>{compactNumber(Math.round((p.views ?? 0) * 0.041) + (seeded(p.id, 7) % 50))}</TD>
                    <TD numeric>{compactNumber(Math.round((p.views ?? 0) * 0.0038) + (seeded(p.id, 13) % 20))}</TD>
                    <TD numeric>{`${1 + (seeded(p.id, 3) % 2)}:${String(seeded(p.id, 17) % 60).padStart(2, '0')}`}</TD>
                  </TR>
                ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Per-video drill-down */}
      <Drawer open={selected != null} onClose={() => setSelected(null)} title={selected?.title ?? ''}>
        {selected && (
          <div className="space-y-5 text-sm">
            <div className="flex items-center gap-2">
              <PostStatusBadge status={selected.status} />
              <span className="text-xs text-zinc-500" title={absoluteTime(selected.publishedAt)}>
                published {relativeTime(selected.publishedAt)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Views" value={compactNumber(selected.views ?? 0)} delta="+12%" hint="vs prev video" />
              <StatCard label="Likes" value={compactNumber(Math.round((selected.views ?? 0) * 0.041))} />
              <StatCard label="CTR" value={`${(4 + (seeded(selected.id, 5) % 40) / 10).toFixed(1)}%`} hint="impressions" />
              <StatCard label="Avg. watch" value={`1:${String(seeded(selected.id, 17) % 60).padStart(2, '0')}`} />
            </div>

            {/* Simple views-by-day sparkline (mock) */}
            <div>
              <p className="mb-2 text-xs font-medium text-zinc-500">Views by day</p>
              <div className="flex h-20 items-end gap-1 rounded-md border border-zinc-100 bg-zinc-50/60 p-2">
                {Array.from({ length: 14 }, (_, i) => {
                  const h = 15 + (seeded(selected.id, i + 23) % 85);
                  return (
                    <div
                      key={i}
                      style={{ height: `${h}%` }}
                      className="flex-1 rounded-sm bg-indigo-400/80"
                      title={`day ${i + 1}`}
                    />
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium text-zinc-500">Audience retention</p>
              <div className="flex h-16 items-end gap-0.5 rounded-md border border-zinc-100 bg-zinc-50/60 p-2">
                {Array.from({ length: 20 }, (_, i) => {
                  const h = Math.max(12, 100 - i * (3 + (seeded(selected.id, i + 41) % 4)));
                  return (
                    <div
                      key={i}
                      style={{ height: `${h}%` }}
                      className="flex-1 rounded-sm bg-violet-400/70"
                      title={`${i * 5}%: ${h}%`}
                    />
                  );
                })}
              </div>
            </div>

            {account.monetized && (
              <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                Est. revenue for this video: ${((selected.views ?? 0) * 0.00017).toFixed(2)} (RPM $0.17)
              </div>
            )}

            <p className="border-t border-zinc-100 pt-3 text-xs text-zinc-400">
              All numbers are mock placeholders — real per-video timelines, retention curves, and
              revenue sync from the platforms in Phase 6.
            </p>
            <Button size="sm" variant="secondary" onClick={() => setSelected(null)}>
              Close
            </Button>
          </div>
        )}
      </Drawer>
    </div>
  );
}
