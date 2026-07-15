'use client';

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
import { compactNumber, relativeTime } from '@/lib/format';
import { getAccounts, getIncidents, getRollups } from '@/lib/mock-data';

export default function DashboardPage() {
  const rollups = getRollups();
  const accounts = getAccounts();
  const openIncidents = getIncidents().filter((i) => i.status === 'OPEN');

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Everything across all connected accounts, at a glance"
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Accounts" value={rollups.accountCount} hint="connected" />
        <StatCard label="Total followers" value={compactNumber(rollups.totalFollowers)} delta="+3.1%" hint="30 days" />
        <StatCard label="Views" value={compactNumber(rollups.views30d)} delta="+6.4%" hint="30 days" />
        <StatCard label="Scheduled" value={rollups.scheduled} hint="upcoming posts" />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Published today" value={rollups.publishedToday} />
        <StatCard label="Pending reviews" value={rollups.pendingReviews} hint="awaiting your approval" />
        <StatCard label="Failed posts" value={rollups.failed} hint={rollups.failed > 0 ? 'see incidents' : ''} />
        <StatCard label="Open incidents" value={rollups.openIncidents} hint={rollups.openIncidents > 0 ? 'needs attention' : 'all clear'} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {/* Account health table */}
        <Card className="xl:col-span-2">
          <CardHeader title="Accounts" description="Health and 30-day performance per account" />
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

        {/* Open incidents */}
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
            {openIncidents.length === 0 ? (
              <p className="text-sm text-zinc-500">No open incidents. 🎉</p>
            ) : (
              <ul className="space-y-3">
                {openIncidents.map((inc) => {
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
