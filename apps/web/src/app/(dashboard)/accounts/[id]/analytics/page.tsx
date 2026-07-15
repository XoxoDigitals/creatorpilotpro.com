'use client';

import { useParams } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { compactNumber, relativeTime, absoluteTime } from '@/lib/format';
import { getAccount, getPosts } from '@/lib/mock-data';

export default function AccountAnalyticsPage() {
  const { id } = useParams<{ id: string }>();
  const account = getAccount(id);
  if (!account) return null;

  const top = getPosts(id)
    .filter((p) => p.views != null)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Views" value={compactNumber(account.views30d)} delta="+8.1%" hint="30 days" />
        <StatCard label="Followers" value={compactNumber(account.followers)} delta="+2.4%" hint="30 days" />
        <StatCard label="Avg. view duration" value="1:42" hint="mock until Phase 6" />
        {account.monetized ? (
          <StatCard label="Est. revenue" value="$412" delta="+11%" hint="30 days · mock" />
        ) : (
          <StatCard label="Est. revenue" value="—" hint="not monetized" />
        )}
      </div>

      <Card>
        <CardHeader
          title="Top posts"
          description="By views — full per-post metric timelines arrive with the analytics sync (Phase 6)"
        />
        {top.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="No published posts yet"
              hint="Post-level metrics appear within a day of first publishing."
            />
          </div>
        ) : (
          <Table className="rounded-t-none border-0">
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Published</TH>
                <TH numeric>Views</TH>
              </TR>
            </THead>
            <TBody>
              {top.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium text-zinc-900">{p.title}</TD>
                  <TD title={absoluteTime(p.publishedAt)}>{relativeTime(p.publishedAt)}</TD>
                  <TD numeric>{compactNumber(p.views ?? 0)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
