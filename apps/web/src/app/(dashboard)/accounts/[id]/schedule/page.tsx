'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { ManualUploadModal } from '@/components/manual-upload-modal';
import { relativeTime, absoluteTime } from '@/lib/format';
import { getUpcomingView, type UpcomingResult } from '@/lib/api-data';

export default function AccountSchedulePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [data, setData] = useState<UpcomingResult>({ scheduled: [], freeSlots: [], demo: false });
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getUpcomingView(id));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const openUpload = () => {
    if (data.demo) {
      toast('Connect a real account to upload and schedule videos', 'info');
      return;
    }
    setUploadOpen(true);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader
          title="Upcoming queue"
          description="Posts waiting on their scheduled slot"
          action={
            <Button size="sm" variant="primary" onClick={openUpload}>
              Upload video
            </Button>
          }
        />
        {loading ? (
          <p className="p-4 text-sm text-zinc-500">Loading…</p>
        ) : data.scheduled.length === 0 ? (
          <div className="p-4">
            <EmptyState
              title="Nothing scheduled"
              hint="Upload a video, or let approved content flow into this account's next free slots automatically."
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
              {data.scheduled.map((p) => (
                <TR key={p.publishTargetId}>
                  <TD className="font-medium text-zinc-900">{p.title}</TD>
                  <TD>
                    <Badge tone="indigo">Scheduled</Badge>
                  </TD>
                  <TD title={absoluteTime(p.scheduledAt)}>{relativeTime(p.scheduledAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Next free slots" description="Generated from this account's schedule rules" />
        <div className="space-y-2 p-4 text-sm">
          {data.freeSlots.length === 0 ? (
            <p className="text-xs text-zinc-400">
              {data.demo
                ? 'Slot generation runs for real accounts. Connect one to see upcoming slots.'
                : 'No upcoming slots — set post times in the account’s connect/schedule settings.'}
            </p>
          ) : (
            data.freeSlots.map((slot) => (
              <div key={slot} className="flex items-center justify-between">
                <span className="text-zinc-500">{relativeTime(slot)}</span>
                <span className="nums text-xs text-zinc-700" title={absoluteTime(slot)}>
                  {new Date(slot).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
            ))
          )}
        </div>
      </Card>

      <ManualUploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        accountId={id}
        onUploaded={() => void load()}
      />
    </div>
  );
}
