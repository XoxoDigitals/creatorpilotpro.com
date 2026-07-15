'use client';

import { useParams } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PostStatusBadge } from '@/components/ui/status-badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { relativeTime, absoluteTime } from '@/lib/format';
import { getPosts } from '@/lib/mock-data';

export default function AccountSchedulePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const upcoming = getPosts(id)
    .filter((p) => p.scheduledAt && p.status !== 'PUBLISHED')
    .sort((a, b) => Date.parse(a.scheduledAt!) - Date.parse(b.scheduledAt!));

  const comingSoon = () => toast('Slot rule editing arrives with the scheduling engine (Phase 2)', 'info');

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Upcoming queue"
          description="Posts waiting on their scheduled slot"
          action={
            <Button size="sm" onClick={() => toast('Manual scheduling arrives in Phase 1', 'info')}>
              Schedule post
            </Button>
          }
        />
        {upcoming.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Nothing scheduled"
              hint="Approved content is placed into this account's next free slots automatically."
            />
          </div>
        ) : (
          <Table className="rounded-t-none border-0">
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Status</TH>
                <TH>Publishes</TH>
              </TR>
            </THead>
            <TBody>
              {upcoming.map((p) => (
                <TR key={p.id}>
                  <TD className="font-medium text-zinc-900">{p.title}</TD>
                  <TD>
                    <PostStatusBadge status={p.status} />
                  </TD>
                  <TD title={absoluteTime(p.scheduledAt)}>{relativeTime(p.scheduledAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Slot rules"
          description="How this account picks publish times"
          action={
            <Button size="sm" variant="ghost" onClick={comingSoon}>
              Edit
            </Button>
          }
        />
        <div className="space-y-3 p-4 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Cadence</span>
            <Badge tone="indigo">Daily</Badge>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Window</span>
            <span className="nums">18:00 – 21:00 (randomized)</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Max posts / day</span>
            <span className="nums">2</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Min gap</span>
            <span className="nums">3h</span>
          </div>
          <p className="border-t border-zinc-100 pt-3 text-xs text-zinc-400">
            Mock values — the rule editor ships with the scheduling engine in Phase 2.
          </p>
        </div>
      </Card>
    </div>
  );
}
