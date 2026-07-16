'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

interface UsageStats {
  totalCalls: number;
  cacheHits: number;
  totalTokensIn: number;
  totalTokensOut: number;
  estimatedCostUsd: number;
}

interface AiProviderView {
  id: string;
  name: string;
  kind: string;
  enabled: boolean;
}

type Period = '24h' | '7d' | '30d' | 'all';

function periodToRange(period: Period): { since?: string; until?: string } {
  if (period === 'all') return {};
  const now = new Date();
  const ms: Record<string, number> = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  };
  const since = new Date(now.getTime() - ms[period]!);
  return { since: since.toISOString() };
}

export default function CostDashboardPage() {
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [providers, setProviders] = useState<AiProviderView[]>([]);
  const [period, setPeriod] = useState<Period>('7d');
  const [providerId, setProviderId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const range = periodToRange(period);
      const params = new URLSearchParams();
      if (providerId) params.set('providerId', providerId);
      if (range.since) params.set('since', range.since);
      if (range.until) params.set('until', range.until);

      const [s, p] = await Promise.all([
        api.get<UsageStats>(`/ai/usage?${params.toString()}`),
        api.get<AiProviderView[]>('/ai/providers'),
      ]);
      setStats(s);
      setProviders(p);
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load usage stats');
    } finally {
      setLoading(false);
    }
  }, [period, providerId]);

  useEffect(() => {
    void load();
  }, [load]);

  const inputCls =
    'rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none';

  const cacheRate = stats && stats.totalCalls > 0
    ? ((stats.cacheHits / stats.totalCalls) * 100).toFixed(1)
    : '0.0';

  return (
    <div>
      <h2 className="mb-1 text-lg font-medium text-slate-200">AI Cost Dashboard</h2>
      <p className="mb-6 text-sm text-slate-400">
        Token usage, costs, and cache efficiency from the AI usage log.
      </p>

      {error && (
        <p className="mb-4 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div className="flex gap-1">
          {(['24h', '7d', '30d', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                period === p
                  ? 'bg-indigo-600 text-white'
                  : 'border border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {p === 'all' ? 'All time' : p}
            </button>
          ))}
        </div>
        <select
          value={providerId}
          onChange={(e) => setProviderId(e.target.value)}
          className={inputCls}
        >
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Total calls"
            value={stats.totalCalls.toLocaleString()}
          />
          <StatTile
            label="Cache hits"
            value={`${stats.cacheHits.toLocaleString()} (${cacheRate}%)`}
            accent={Number(cacheRate) > 50 ? 'green' : undefined}
          />
          <StatTile
            label="Tokens"
            value={`${(stats.totalTokensIn + stats.totalTokensOut).toLocaleString()}`}
            sub={`${stats.totalTokensIn.toLocaleString()} in / ${stats.totalTokensOut.toLocaleString()} out`}
          />
          <StatTile
            label="Estimated cost"
            value={`$${stats.estimatedCostUsd.toFixed(4)}`}
            accent={stats.estimatedCostUsd > 1 ? 'amber' : undefined}
          />
        </div>
      )}

      {stats && stats.totalCalls === 0 && (
        <p className="mt-8 text-center text-sm text-slate-500">
          No AI usage recorded yet. Add API keys and run the pipeline to see stats here.
        </p>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'green' | 'amber';
}) {
  const valueColor = accent === 'green'
    ? 'text-emerald-300'
    : accent === 'amber'
      ? 'text-amber-300'
      : 'text-slate-100';

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueColor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
    </div>
  );
}
