'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Avatar } from '@/components/ui/avatar';
import { Badge, ContentTypeBadge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { compactNumber } from '@/lib/format';
import {
  getOverviewView,
  getAccountsView,
  type AnalyticsOverview,
} from '@/lib/api-data';
import type { Account } from '@/lib/domain-types';

export default function GlobalAnalyticsPage() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [ov, accts] = await Promise.all([getOverviewView(), getAccountsView()]);
      setOverview(ov.overview);
      setAccounts(accts.accounts);
      setDemo(ov.demo || accts.demo);
    } catch {
      // keep empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Analytics" description="Cross-account performance" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const ov = overview ?? {
    totalFollowers: 0,
    totalViews: 0,
    totalRevenue: '0',
    publishedToday: 0,
    failedToday: 0,
    scheduledCount: 0,
    pendingReviews: 0,
    openIncidents: 0,
    aiSpendToday: '0',
  };

  const sorted = [...accounts].sort((a, b) => b.views30d - a.views30d);
  const revenue = parseFloat(ov.totalRevenue);

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Cross-account performance overview"
      />
      {demo && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo data — connect a real account to see live analytics.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total views" value={compactNumber(ov.totalViews)} hint="today" />
        <StatCard label="Total followers" value={compactNumber(ov.totalFollowers)} hint="latest sync" />
        <StatCard label="Published today" value={ov.publishedToday} />
        <StatCard
          label="Est. revenue"
          value={revenue > 0 ? `$${revenue.toFixed(2)}` : '—'}
          hint={revenue > 0 ? 'monetized accounts' : 'no revenue data yet'}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Accounts by views" description="Latest snapshot" />
          <Table className="rounded-t-none border-0">
            <THead>
              <TR>
                <TH>Account</TH>
                <TH>Type</TH>
                <TH numeric>Views 30d</TH>
                <TH numeric>Followers</TH>
                <TH>Revenue</TH>
              </TR>
            </THead>
            <TBody>
              {sorted.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link
                      href={`/accounts/${a.id}/analytics` as Route}
                      className="flex items-center gap-2 font-medium text-zinc-900 hover:text-indigo-600"
                    >
                      <span className="relative shrink-0">
                        <Avatar name={a.name} size="sm" />
                        <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-0.5">
                          <PlatformIcon platform={a.platform} size={10} />
                        </span>
                      </span>
                      {a.name}
                    </Link>
                  </TD>
                  <TD>
                    <ContentTypeBadge type={a.contentType} />
                  </TD>
                  <TD numeric>{compactNumber(a.views30d)}</TD>
                  <TD numeric>{compactNumber(a.followers)}</TD>
                  <TD>
                    {a.monetized ? <Badge tone="green">Monetized</Badge> : <span className="text-xs text-zinc-400">—</span>}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="AI spend" description="Today" />
          <div className="p-4">
            <StatCard
              label="AI cost today"
              value={`$${parseFloat(ov.aiSpendToday).toFixed(4)}`}
              hint="all providers"
            />
            <p className="mt-3 text-xs text-zinc-400">
              Detailed per-provider breakdown available in Settings → AI Costs.
            </p>
          </div>
        </Card>
      </div>
    </div>
  );
}
