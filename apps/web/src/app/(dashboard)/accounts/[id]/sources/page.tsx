'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SourceStatusBadge } from '@/components/ui/status-badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { relativeTime, absoluteTime } from '@/lib/format';
import { AddWatchedProfileModal, BulkImportModal } from '@/components/source-modals';
import {
  getSourcesView,
  checkSourceNow,
  setSourcePaused,
  deleteSource,
} from '@/lib/api-data';
import type { Source } from '@/lib/domain-types';

export default function AccountSourcesPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [sources, setSources] = useState<Source[]>([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { sources: list, demo: isDemo } = await getSourcesView(id);
      setSources(list);
      setDemo(isDemo);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = async (sourceId: string, action: () => Promise<void>, done: string) => {
    if (demo) return toast('Connect a real account to manage sources', 'info');
    setBusyId(sourceId);
    try {
      await action();
      toast(done, 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Action failed', 'error');
    } finally {
      setBusyId(null);
    }
  };

  const onDone = () => void load();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Watched profiles are checked automatically; new videos land in this account&apos;s review queue.
        </p>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setImportOpen(true)}>
            Bulk import URLs
          </Button>
          <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
            Add watched profile
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="p-4 text-sm text-zinc-500">Loading sources…</p>
      ) : sources.length === 0 ? (
        <EmptyState
          title="No sources yet"
          hint="Add a watched profile URL or bulk-import video URLs to start the ingestion pipeline for this account."
          cta={
            <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>
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
              <TH numeric>Videos</TH>
              <TH>Status</TH>
              <TH>Actions</TH>
            </TR>
          </THead>
          <TBody>
            {sources.map((s) => {
              const isBatch = s.type === 'BULK_IMPORT';
              const paused = s.status === 'PAUSED';
              return (
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
                        {s.newItems}
                      </Badge>
                    ) : (
                      '0'
                    )}
                  </TD>
                  <TD>
                    <SourceStatusBadge status={s.status} />
                  </TD>
                  <TD>
                    <div className="flex gap-1.5">
                      {!isBatch && (
                        <Button
                          size="sm"
                          disabled={busyId === s.id || paused}
                          title={paused ? 'Resume the source to check it' : 'Poll for new videos now'}
                          onClick={() =>
                            void runAction(s.id, () => checkSourceNow(s.id), 'Check queued')
                          }
                        >
                          Check now
                        </Button>
                      )}
                      {!isBatch && (
                        <Button
                          size="sm"
                          disabled={busyId === s.id}
                          onClick={() =>
                            void runAction(
                              s.id,
                              () => setSourcePaused(s.id, !paused),
                              paused ? 'Resumed' : 'Paused',
                            )
                          }
                        >
                          {paused ? 'Resume' : 'Pause'}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busyId === s.id}
                        onClick={() =>
                          void runAction(s.id, () => deleteSource(s.id), 'Source removed')
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      )}

      <AddWatchedProfileModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        accountId={id}
        onDone={onDone}
      />
      <BulkImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        accountId={id}
        onDone={onDone}
      />
    </div>
  );
}
