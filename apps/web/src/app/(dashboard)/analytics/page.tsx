'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Avatar } from '@/components/ui/avatar';
import { Badge, ContentTypeBadge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { compactNumber, relativeTime, absoluteTime } from '@/lib/format';
import { getAccounts, getPosts, getRollups } from '@/lib/mock-data';

export default function GlobalAnalyticsPage() {
  const rollups = getRollups();
  const accounts = [...getAccounts()].sort((a, b) => b.views30d - a.views30d);
  const topPosts = getPosts()
    .filter((p) => p.views != null)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, 8);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="Cross-account performance — deep per-post timelines and revenue sync arrive in Phase 6"
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total views" value={compactNumber(rollups.views30d)} delta="+6.4%" hint="30 days" />
        <StatCard label="Total followers" value={compactNumber(rollups.totalFollowers)} delta="+3.1%" hint="30 days" />
        <StatCard label="Published today" value={rollups.publishedToday} />
        <StatCard label="Est. revenue" value="$412" delta="+11%" hint="monetized accounts · mock" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Accounts by views" description="Last 30 days" />
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
              {accounts.map((a) => (
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
          <CardHeader title="Top posts" description="Best performers across all accounts" />
          <Table className="rounded-t-none border-0">
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Account</TH>
                <TH>Published</TH>
                <TH numeric>Views</TH>
              </TR>
            </THead>
            <TBody>
              {topPosts.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium text-zinc-900">{p.title}</TD>
                  <TD>{accountName(p.accountId)}</TD>
                  <TD title={absoluteTime(p.publishedAt)}>{relativeTime(p.publishedAt)}</TD>
                  <TD numeric>{compactNumber(p.views ?? 0)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      </div>
    </div>
  );
}
