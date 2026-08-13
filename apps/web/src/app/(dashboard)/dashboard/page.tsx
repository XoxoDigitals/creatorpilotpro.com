'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Avatar } from '@/components/ui/avatar';
import { HealthDot } from '@/components/ui/health-dot';
import { ContentTypeBadge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { SeverityBadge } from '@/components/ui/status-badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { compactNumber, relativeTime } from '@/lib/format';
import { getAccountsView, getIncidentsView, getOverviewView, type AnalyticsOverview } from '@/lib/api-data';
import type { Account, Incident } from '@/lib/domain-types';

export default function DashboardPage() {
  const [overview, setOverview] = useState<AnalyticsOverview | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [ov, accts, incs] = await Promise.all([
        getOverviewView(),
        getAccountsView(),
        getIncidentsView(),
      ]);
      setOverview(ov.overview);
      setDemo(ov.demo || accts.demo);
      setAccounts(accts.accounts);
      setIncidents(incs.incidents.filter((i) => i.status === 'OPEN'));
    } catch {
      // fallback: keep loading state empty
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
        <PageHeader title="Dashboard" description="Everything across all connected accounts, at a glance" />
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

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Everything across all connected accounts, at a glance"
      />
      {demo && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo data — connect a real account to see live metrics.
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Accounts" value={accounts.length} hint="connected" />
        <StatCard label="Total followers" value={compactNumber(ov.totalFollowers)} hint="latest sync" />
        <StatCard label="Views" value={compactNumber(ov.totalViews)} hint="today" />
        <StatCard label="Scheduled" value={ov.scheduledCount} hint="upcoming posts" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Published today" value={ov.publishedToday} />
        <StatCard label="Pending reviews" value={ov.pendingReviews} hint="awaiting your approval" />
        <StatCard label="Failed posts" value={ov.failedToday} hint={ov.failedToday > 0 ? 'see incidents' : ''} />
        <StatCard label="Open incidents" value={ov.openIncidents} hint={ov.openIncidents > 0 ? 'needs attention' : 'all clear'} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Accounts" description="Health and performance per account" />
          <Table className="rounded-t-none border-0">
            <THead>
              <TR>
                <TH>Account</TH>
                <TH>Type</TH>
                <TH numeric>Followers</TH>
                <TH numeric>Views 30d</TH>
                <TH numeric>Scheduled</TH>
                <TH>Health</TH>
              </TR>
            </THead>
            <TBody>
              {accounts.map((a) => (
                <TR key={a.id}>
                  <TD>
                    <Link
                      href={`/accounts/${a.id}` as Route}
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
                  <TD numeric>{compactNumber(a.followers)}</TD>
                  <TD numeric>{compactNumber(a.views30d)}</TD>
                  <TD numeric>{a.scheduledCount}</TD>
                  <TD>
                    <HealthDot status={a.health} label />
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>

        <Card>
          <CardHeader
            title="Open incidents"
            action={
              <Link href={'/incidents' as Route} className="text-xs font-medium text-indigo-600 hover:underline">
                View all
              </Link>
            }
          />
          <div className="p-4">
            {incidents.length === 0 ? (
              <p className="text-sm text-zinc-500">No open incidents.</p>
            ) : (
              <ul className="space-y-3">
                {incidents.map((inc) => {
                  const acc = accounts.find((a) => a.id === inc.accountId);
                  return (
                    <li key={inc.id} className="flex items-start gap-2">
                      <SeverityBadge severity={inc.severity} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-zinc-900">{inc.title}</p>
                        <p className="text-xs text-zinc-500">
                          {acc?.name} · {relativeTime(inc.createdAt)}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
