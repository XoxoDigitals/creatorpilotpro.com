'use client';

import { useCallback, useEffect, useState } from 'react';
import { StatCard } from '@/components/ui/stat-card';
import { Select } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
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
  const toast = useToast();
  const [stats, setStats] = useState<UsageStats | null>(null);
  const [providers, setProviders] = useState<AiProviderView[]>([]);
  const [period, setPeriod] = useState<Period>('7d');
  const [providerId, setProviderId] = useState<string>('');
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
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load usage stats', 'error');
    } finally {
      setLoading(false);
    }
  }, [period, providerId, toast]);

  useEffect(() => { void load(); }, [load]);

  const cacheRate = stats && stats.totalCalls > 0
    ? ((stats.cacheHits / stats.totalCalls) * 100).toFixed(1)
    : '0.0';

  return (
    <div>
      <p className="mb-6 text-sm text-zinc-500">
        Token usage, costs, and cache efficiency from the AI usage log.
      </p>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="flex rounded-md border border-zinc-300 bg-white p-0.5">
          {(['24h', '7d', '30d', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'rounded px-3 py-1 text-xs font-medium transition-colors',
                period === p ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-800',
              )}
            >
              {p === 'all' ? 'All time' : p}
            </button>
          ))}
        </div>
        <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} className="w-auto">
          <option value="">All providers</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      </div>

      {loading && <p className="text-sm text-zinc-500">Loading…</p>}

      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total calls" value={stats.totalCalls.toLocaleString()} />
          <StatCard
            label="Cache hits"
            value={`${stats.cacheHits.toLocaleString()} (${cacheRate}%)`}
            hint={Number(cacheRate) > 50 ? 'good' : ''}
          />
          <StatCard
            label="Tokens"
            value={(stats.totalTokensIn + stats.totalTokensOut).toLocaleString()}
            hint={`${stats.totalTokensIn.toLocaleString()} in / ${stats.totalTokensOut.toLocaleString()} out`}
          />
          <StatCard
            label="Estimated cost"
            value={`$${stats.estimatedCostUsd.toFixed(4)}`}
            hint={stats.estimatedCostUsd > 1 ? 'over $1 in range' : ''}
          />
        </div>
      )}

      {stats && stats.totalCalls === 0 && (
        <p className="mt-8 text-center text-sm text-zinc-500">
          No AI usage recorded yet. Add API keys and run the pipeline to see stats here.
        </p>
      )}
    </div>
  );
}
