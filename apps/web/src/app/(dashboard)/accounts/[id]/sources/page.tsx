'use client';

import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SourceStatusBadge } from '@/components/ui/status-badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { relativeTime, absoluteTime } from '@/lib/format';
import { getSources } from '@/lib/mock-data';

export default function AccountSourcesPage() {
  const { id } = useParams<{ id: string }>();
  const sources = getSources(id);
  const toast = useToast();

  const comingSoon = () => toast('Source management arrives in Phase 2 (ingestion)', 'info');

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Watched profiles are checked automatically; new videos land in this account's review queue.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={comingSoon}>
            Bulk import URLs
          </Button>
          <Button variant="primary" size="sm" onClick={comingSoon}>
            Add watched profile
          </Button>
        </div>
      </div>

      {sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          hint="Add a watched profile URL or bulk-import video URLs to start the ingestion pipeline for this account."
          cta={
            <Button variant="primary" size="sm" onClick={comingSoon}>
              Add watched profile
            </Button>
          }
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Source</TH>
              <TH>Type</TH>
              <TH>Check interval</TH>
              <TH>Last checked</TH>
              <TH numeric>New items</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <TBody>
            {sources.map((s) => (
              <TR key={s.id}>
                <TD>
                  <span className="font-medium text-zinc-900">{s.label}</span>
                  <span className="mt-0.5 block max-w-[260px] truncate text-xs text-zinc-400">
                    {s.url}
                  </span>
                </TD>
                <TD>
                  <Badge tone={s.type === 'WATCHED_PROFILE' ? 'indigo' : 'neutral'}>
                    {s.type === 'WATCHED_PROFILE' ? 'Watched profile' : 'Bulk import'}
                  </Badge>
                </TD>
                <TD>{s.checkIntervalHours > 0 ? `every ${s.checkIntervalHours}h` : '—'}</TD>
                <TD title={absoluteTime(s.lastCheckedAt)}>{relativeTime(s.lastCheckedAt)}</TD>
                <TD numeric>
                  {s.newItems > 0 ? (
                    <Badge tone="green" className="nums">
                      +{s.newItems}
                    </Badge>
                  ) : (
                    '0'
                  )}
                </TD>
                <TD>
                  <SourceStatusBadge status={s.status} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
