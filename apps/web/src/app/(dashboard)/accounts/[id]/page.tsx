'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { PostStatusBadge } from '@/components/ui/status-badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { compactNumber, relativeTime, absoluteTime } from '@/lib/format';
import { getAccountView } from '@/lib/api-data';
import { getPosts, getIncidents } from '@/lib/mock-data';
import type { Account } from '@/lib/domain-types';

export default function AccountOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const [account, setAccount] = useState<Account | null>(null);

  useEffect(() => {
    void getAccountView(id).then(({ account: acc }) => setAccount(acc));
  }, [id]);

  if (!account) return null; // layout renders loading / not-found states

  const posts = getPosts(id);
  const recent = [...posts].sort((a, b) => {
    const ta = Date.parse(a.publishedAt ?? a.scheduledAt ?? '') || 0;
    const tb = Date.parse(b.publishedAt ?? b.scheduledAt ?? '') || 0;
    return tb - ta;
  });
  const openIncidents = getIncidents(id).filter((i) => i.status === 'OPEN');

  return (
    <div className="space-y-6">
      {/* Stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Followers" value={compactNumber(account.followers)} delta="+2.4%" hint="30 days" />
        <StatCard label="Views" value={compactNumber(account.views30d)} delta="+8.1%" hint="30 days" />
        <StatCard label="Scheduled" value={account.scheduledCount} hint="upcoming posts" />
        <StatCard
          label="Open incidents"
          value={account.openIncidents}
          hint={account.openIncidents > 0 ? 'needs attention' : 'all clear'}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent & upcoming posts */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent & upcoming posts"
            description="Latest published and scheduled content for this account"
          />
          {recent.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No posts yet"
                hint="Content appears here once the first video is scheduled or published."
              />
            </div>
          ) : (
            <Table className="rounded-t-none border-0">
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Status</TH>
                  <TH>When</TH>
                  <TH numeric>Views</TH>
                </TR>
              </THead>
              <TBody>
                {recent.map((p) => (
                  <TR key={p.id}>
                    <TD className="font-medium text-zinc-900">{p.title}</TD>
                    <TD>
                      <PostStatusBadge status={p.status} />
                    </TD>
                    <TD title={absoluteTime(p.publishedAt ?? p.scheduledAt)}>
                      {relativeTime(p.publishedAt ?? p.scheduledAt)}
                    </TD>
                    <TD numeric>{p.views == null ? '—' : compactNumber(p.views)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </Card>

        {/* Connection health */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Connection" description="Token & publishing bridge health" />
            <div className="space-y-3 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Status</span>
                <Badge
                  tone={
                    account.connection === 'CONNECTED'
                      ? 'green'
                      : account.connection === 'EXPIRING'
                        ? 'amber'
                        : 'red'
                  }
                >
                  {account.connection === 'CONNECTED'
                    ? 'Connected'
                    : account.connection === 'EXPIRING'
                      ? 'Expiring soon'
                      : 'Disconnected'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Token expires</span>
                <span title={absoluteTime(account.tokenExpiresAt)}>
                  {relativeTime(account.tokenExpiresAt)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Monetized</span>
                <Badge tone={account.monetized ? 'green' : 'neutral'}>
                  {account.monetized ? 'Yes' : 'No'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Connected</span>
                <span title={absoluteTime(account.createdAt)}>{relativeTime(account.createdAt)}</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Open incidents" />
            <div className="p-4">
              {openIncidents.length === 0 ? (
                <p className="text-sm text-zinc-500">No open incidents for this account.</p>
              ) : (
                <ul className="space-y-2">
                  {openIncidents.map((inc) => (
                    <li key={inc.id} className="text-sm">
                      <Link
                        href={'/incidents' as Route}
                        className="font-medium text-red-600 hover:underline"
                      >
                        {inc.title}
                      </Link>
                      <p className="text-xs text-zinc-500">{relativeTime(inc.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
