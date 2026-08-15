'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { BreakdownBars } from '@/components/analytics/breakdown-bars';
import { cn } from '@/lib/cn';
import { compactNumber, relativeTime, absoluteTime } from '@/lib/format';
import {
  getAccountView,
  getAccountMetrics,
  getAccountPostMetrics,
  getPostMetricsView,
  triggerAccountSync,
  type AccountMetrics,
  type PostTableRow,
  type PostMetrics,
} from '@/lib/api-data';
import type { Account } from '@/lib/domain-types';

type Preset = '7D' | '30D' | '90D' | 'CUSTOM';

function presetDates(preset: Preset, from: string, to: string): { from: string; to: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === '7D') {
    const f = new Date(now); f.setUTCDate(f.getUTCDate() - 7);
    return { from: fmt(f), to: fmt(now) };
  }
  if (preset === '30D') {
    const f = new Date(now); f.setUTCDate(f.getUTCDate() - 30);
    return { from: fmt(f), to: fmt(now) };
  }
  if (preset === '90D') {
    const f = new Date(now); f.setUTCDate(f.getUTCDate() - 90);
    return { from: fmt(f), to: fmt(now) };
  }
  const f = new Date(now); f.setUTCDate(f.getUTCDate() - 30);
  return { from: from || fmt(f), to: to || fmt(now) };
}

export default function AccountAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<Account | null>(null);
  const [preset, setPreset] = useState<Preset>('30D');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [metrics, setMetrics] = useState<AccountMetrics | null>(null);
  const [posts, setPosts] = useState<PostTableRow[]>([]);
  const [selected, setSelected] = useState<PostMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const range = useMemo(() => presetDates(preset, from, to), [preset, from, to]);

  const loadAccount = useCallback(async () => {
    try {
      const result = await getAccountView(id);
      setAccount(result.account);
    } catch { /* keep null */ }
  }, [id]);

  const loadMetrics = useCallback(async () => {
    setLoading(true);
    try {
      const [m, p] = await Promise.all([
        getAccountMetrics(id, range.from, range.to),
        // Per-video table is always all-time (not scoped to the KPI date range).
        getAccountPostMetrics(id),
      ]);
      setMetrics(m);
      setPosts(p);
    } catch { /* keep empty */ }
    finally { setLoading(false); }
  }, [id, range.from, range.to]);

  useEffect(() => { void loadAccount(); }, [loadAccount]);
  useEffect(() => { void loadMetrics(); }, [loadMetrics]);

  async function handleSync() {
    setSyncing(true);
    try {
      await triggerAccountSync(id);
      setTimeout(() => {
        void loadMetrics();
        void loadAccount();
      }, 3000);
    } catch { /* ignore */ }
    finally { setSyncing(false); }
  }

  async function handlePostClick(publishTargetId: string) {
    try { setSelected(await getPostMetricsView(publishTargetId)); }
    catch { /* ignore */ }
  }

  if (!account) return loading ? <Skeleton className="h-64 w-full" /> : null;

  const totals = metrics?.totals ?? {
    views: 0, uniqueViewers: 0, watchTimeMin: 0, revenue: '0',
    followersDelta: 0, engagements: 0, impressions: 0, avgCtr: 0, avgRetentionRate: 0,
  };
  const latest = metrics?.latest;
  const rev = parseFloat(totals.revenue);

  return (
    <div className="space-y-6">
      {/* Range controls */}
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
        <Button size="sm" variant="secondary" className="ml-auto" onClick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing...' : 'Sync now'}
        </Button>
      </div>

      {/* KPI cards — row 1 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Views" value={compactNumber(totals.views)} hint="range total" />
        <StatCard label="Unique viewers" value={compactNumber(totals.uniqueViewers)} hint="deduped" />
        <StatCard label="Impressions" value={compactNumber(totals.impressions)} hint="range total" />
        <StatCard label="Watch time" value={`${compactNumber(totals.watchTimeMin)} min`} hint="range total" />
        <StatCard label="Followers" value={compactNumber(latest?.followers ?? account.followers)}
          delta={totals.followersDelta !== 0 ? `${totals.followersDelta > 0 ? '+' : ''}${totals.followersDelta}` : undefined}
        />
      </div>

      {/* KPI cards — row 2 */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Engagements" value={compactNumber(totals.engagements)} hint="likes+comments+shares" />
        <StatCard label="Avg CTR" value={`${totals.avgCtr.toFixed(2)}%`} hint="impressions→click" />
        <StatCard label="Retention" value={`${totals.avgRetentionRate.toFixed(1)}%`} hint="avg % watched" />
        {account.monetized ? (
          <StatCard label="Est. revenue" value={rev > 0 ? `$${rev.toFixed(2)}` : '—'} hint="range total" />
        ) : (
          <StatCard label="Est. revenue" value="—" hint="not monetized" />
        )}
      </div>

      {/* Trend + audience breakdowns */}
      {metrics && metrics.snapshots.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-4 lg:col-span-2">
            <p className="mb-2 text-xs font-medium text-zinc-600">Views per day</p>
            <div className="flex h-24 items-end gap-1 rounded-md border border-zinc-100 bg-zinc-50/60 p-2">
              {metrics.snapshots.map((s) => {
                const maxV = Math.max(...metrics.snapshots.map((x) => x.views), 1);
                const h = Math.max(5, (s.views / maxV) * 100);
                return (
                  <div key={s.date} style={{ height: `${h}%` }}
                    className="flex-1 rounded-sm bg-indigo-400/80"
                    title={`${s.date}: ${s.views.toLocaleString()} views`}
                  />
                );
              })}
            </div>
          </Card>

          <Card className="p-4 space-y-4">
            <BreakdownBars
              title="Traffic countries"
              rows={(latest?.trafficCountries ?? []).map((c) => ({ label: c.country, pct: c.pct, extra: c.views }))}
            />
          </Card>
        </div>
      )}

      {/* More breakdowns */}
      {latest && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="p-4">
            <BreakdownBars
              title="Age groups"
              rows={(latest.ageGroups ?? []).map((a) => ({ label: a.range, pct: a.pct }))}
            />
          </Card>
          <Card className="p-4">
            <BreakdownBars
              title="Traffic sources"
              rows={(latest.trafficSources ?? []).map((s) => ({ label: s.source, pct: s.pct, extra: s.views }))}
            />
          </Card>
          <Card className="p-4 space-y-3">
            <BreakdownBars
              title="Devices"
              rows={(latest.deviceSplit ?? []).map((d) => ({ label: d.device, pct: d.pct }))}
            />
            {latest.genderSplit && (latest.genderSplit.male || latest.genderSplit.female) ? (
              <BreakdownBars
                title="Gender"
                rows={[
                  ...(latest.genderSplit.male != null ? [{ label: 'Male', pct: latest.genderSplit.male }] : []),
                  ...(latest.genderSplit.female != null ? [{ label: 'Female', pct: latest.genderSplit.female }] : []),
                  ...(latest.genderSplit.other != null ? [{ label: 'Other', pct: latest.genderSplit.other }] : []),
                ]}
              />
            ) : null}
          </Card>
        </div>
      )}

      {/* Per-video table */}
      <Card>
        <CardHeader
          title="Per-video performance"
          description="All published videos (all time). Click any row for the full breakdown."
        />
        {posts.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No published videos yet"
              hint="Sync the account or publish something first."
            />
          </div>
        ) : (
          <Table className="rounded-t-none border-0">
            <THead>
              <TR>
                <TH>Video</TH>
                <TH>Published</TH>
                <TH numeric>Views</TH>
                <TH numeric>Unique</TH>
                <TH numeric>Impressions</TH>
                <TH numeric>CTR</TH>
                <TH numeric>Watch</TH>
                <TH numeric>Retention</TH>
                <TH numeric>Likes</TH>
                <TH numeric>Comments</TH>
                <TH numeric>Shares</TH>
              </TR>
            </THead>
            <TBody>
              {posts.map((p) => (
                <TR
                  key={p.publishTargetId}
                  onClick={() => handlePostClick(p.publishTargetId)}
                  className="cursor-pointer"
                >
                  <TD className="font-medium text-zinc-900">{p.contentTitle}</TD>
                  <TD title={p.publishedAt ? absoluteTime(p.publishedAt) : ''}>
                    {p.publishedAt ? relativeTime(p.publishedAt) : '—'}
                  </TD>
                  <TD numeric>{compactNumber(p.views)}</TD>
                  <TD numeric>{compactNumber(p.uniqueViewers)}</TD>
                  <TD numeric>{compactNumber(p.impressions)}</TD>
                  <TD numeric>{p.ctr.toFixed(1)}%</TD>
                  <TD numeric>{compactNumber(p.watchTimeMin)}m</TD>
                  <TD numeric>{p.retentionRate.toFixed(0)}%</TD>
                  <TD numeric>{compactNumber(p.likes)}</TD>
                  <TD numeric>{compactNumber(p.comments)}</TD>
                  <TD numeric>{compactNumber(p.shares)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      {/* Per-video drill-down */}
      <Drawer open={selected != null} onClose={() => setSelected(null)} title={selected?.contentTitle ?? ''}>
        {selected && (() => {
          const s = selected.snapshots.length > 0 ? selected.snapshots[selected.snapshots.length - 1]! : null;
          return (
            <div className="space-y-5 text-sm">
              {s && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <StatCard label="Views" value={compactNumber(s.views)} />
                    <StatCard label="Unique viewers" value={compactNumber(s.uniqueViewers)} />
                    <StatCard label="Impressions" value={compactNumber(s.impressions)} />
                    <StatCard label="CTR" value={`${s.ctr.toFixed(1)}%`} />
                    <StatCard label="Watch time" value={`${compactNumber(s.watchTimeMin)} min`} />
                    <StatCard label="Avg view duration" value={`${s.averageViewDurationSec}s`} />
                    <StatCard label="Retention" value={`${s.retentionRate.toFixed(0)}%`} />
                    <StatCard label="Engagement" value={compactNumber(s.likes + s.comments + s.shares + s.saves)} />
                  </div>

                  {selected.snapshots.length > 1 && (
                    <div>
                      <p className="mb-2 text-xs font-medium text-zinc-600">Views by day</p>
                      <div className="flex h-20 items-end gap-1 rounded-md border border-zinc-100 bg-zinc-50/60 p-2">
                        {selected.snapshots.map((sn) => {
                          const max = Math.max(...selected.snapshots.map((x) => x.views), 1);
                          const h = Math.max(5, (sn.views / max) * 100);
                          return (
                            <div key={sn.date} style={{ height: `${h}%` }}
                              className="flex-1 rounded-sm bg-indigo-400/80"
                              title={`${sn.date}: ${sn.views}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {Array.isArray(selected.retentionCurve) && selected.retentionCurve.length > 0 && (
                    <div>
                      <p className="mb-2 text-xs font-medium text-zinc-600">Audience retention curve</p>
                      <div className="flex h-16 items-end gap-0.5 rounded-md border border-zinc-100 bg-zinc-50/60 p-2">
                        {(selected.retentionCurve as number[]).map((pct, i) => (
                          <div key={i} style={{ height: `${Math.max(5, pct)}%` }}
                            className="flex-1 rounded-sm bg-violet-400/70"
                            title={`${i * 5}%: ${pct}%`}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  <BreakdownBars
                    title="Traffic countries"
                    rows={(s.trafficCountries ?? []).map((c) => ({ label: c.country, pct: c.pct, extra: c.views }))}
                  />
                  <BreakdownBars
                    title="Age groups"
                    rows={(s.ageGroups ?? []).map((a) => ({ label: a.range, pct: a.pct }))}
                  />
                  <BreakdownBars
                    title="Traffic sources"
                    rows={(s.trafficSources ?? []).map((src) => ({ label: src.source, pct: src.pct, extra: src.views }))}
                  />
                  <BreakdownBars
                    title="Devices"
                    rows={(s.deviceSplit ?? []).map((d) => ({ label: d.device, pct: d.pct }))}
                  />
                </>
              )}

              <Button size="sm" variant="secondary" onClick={() => setSelected(null)}>Close</Button>
            </div>
          );
        })()}
      </Drawer>
    </div>
  );
}
