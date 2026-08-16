'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import type { Route } from 'next';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { PostDetailModal } from '@/components/post-detail-modal';
import { ApiError } from '@/lib/api';
import { ManualUploadModal } from '@/components/manual-upload-modal';
import { relativeTime, absoluteTime } from '@/lib/format';
import { destinationAccountIds } from '@/components/crosspost-account-picker';
import {
  getApiAccount,
  getUpcomingView,
  publishDefaultsFromProfile,
  publishTargetNow,
  retryPublishTarget,
  schedulePublish,
  type PublishTargetDetail,
  type UpcomingResult,
} from '@/lib/api-data';

const QUEUE_STATUS_TONE: Record<
  NonNullable<UpcomingResult['scheduled'][number]['status']>,
  'neutral' | 'indigo' | 'amber' | 'green' | 'red'
> = {
  PENDING: 'amber',
  SCHEDULED: 'indigo',
  PUBLISHING: 'amber',
  PUBLISHED: 'green',
  FAILED: 'red',
  DRAFT: 'neutral',
};

function statusLabel(status?: PublishTargetDetail['status']): string {
  switch (status) {
    case 'PENDING':
      return 'Pending';
    case 'PUBLISHING':
      return 'Publishing';
    case 'PUBLISHED':
      return 'Published';
    case 'FAILED':
      return 'Failed';
    case 'DRAFT':
      return 'Draft';
    default:
      return 'Scheduled';
  }
}

function errorText(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export default function AccountSchedulePage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const [data, setData] = useState<UpcomingResult>({
    scheduled: [],
    failed: [],
    published: [],
    freeSlots: [],
    demo: false,
  });
  const [loading, setLoading] = useState(true);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>();
  // Content item passed in via ?itemId=… from the AI tab. When present, we
  // render an inline "schedule this item" panel at the top of the page.
  const pendingItemId = search.get('itemId');
  const [schedBusy, setSchedBusy] = useState(false);
  const [customDate, setCustomDate] = useState('');
  const [crosspostIds, setCrosspostIds] = useState<string[]>([]);
  const [retryingId, setRetryingId] = useState<string | null>(null);

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

  useEffect(() => {
    let cancelled = false;
    void getApiAccount(id).then((account) => {
      if (cancelled || !account) return;
      const defaults = publishDefaultsFromProfile(account.profile);
      setCrosspostIds(defaults.crosspostAccountIds.filter((x) => x !== id));
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const openUpload = () => {
    if (data.demo) {
      toast('Connect a real account to upload and schedule videos', 'info');
      return;
    }
    setUploadOpen(true);
  };

  const dropItemIdFromUrl = useCallback(() => {
    router.replace(`/accounts/${id}/schedule` as Route);
  }, [id, router]);

  async function submitSchedule(
    mode: 'NOW' | 'QUEUE_SLOT' | 'FIXED',
    scheduledAt?: string,
  ) {
    if (!pendingItemId) return;
    setSchedBusy(true);
    try {
      const destinations = destinationAccountIds(id, crosspostIds);
      await schedulePublish(pendingItemId, destinations, mode, scheduledAt);
      const extra =
        destinations.length > 1 ? ` across ${destinations.length} channels` : '';
      const label =
        mode === 'NOW'
          ? `Queued for Review — Approve to publish${extra}`
          : mode === 'QUEUE_SLOT'
            ? `Queued for Review — Approve to allow the next free slot${extra}`
            : `Queued for Review — Approve to publish at ${new Date(scheduledAt!).toLocaleString()}${extra}`;
      toast(label, 'success');
      dropItemIdFromUrl();
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not schedule this item', 'error');
    } finally {
      setSchedBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {pendingItemId && (
        <Card className="border-indigo-200 bg-indigo-50/40">
          <CardHeader
            title="Schedule this item"
            description={`Content item ${pendingItemId.slice(0, 8)}… — pick when to publish. Crosspost destinations come from channel settings.`}
            action={
              <button
                type="button"
                onClick={() => {
                  dropItemIdFromUrl();
                }}
                className="text-xs text-zinc-500 hover:text-zinc-700"
              >
                Cancel
              </button>
            }
          />
          <div className="space-y-4 p-4">
            {crosspostIds.length > 0 && (
              <p className="text-xs text-zinc-600">
                Also posting to {crosspostIds.length} other channel
                {crosspostIds.length === 1 ? '' : 's'} (from channel settings).
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => void submitSchedule('NOW')}
                disabled={schedBusy || data.demo}
              >
                Publish now
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void submitSchedule('QUEUE_SLOT')}
                disabled={schedBusy || data.demo}
              >
                Next free slot
              </Button>
              <div className="ml-2 flex items-center gap-2">
                <input
                  type="datetime-local"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="rounded-md border border-zinc-300 px-2 py-1 text-xs"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (!customDate) {
                      toast('Pick a date and time first.', 'error');
                      return;
                    }
                    void submitSchedule('FIXED', new Date(customDate).toISOString());
                  }}
                  disabled={schedBusy || data.demo}
                >
                  Schedule at picked time
                </Button>
              </div>
              {data.demo && (
                <span className="ml-2 text-xs text-amber-700">
                  Connect a real account to actually schedule.
                </span>
              )}
            </div>
          </div>
        </Card>
      )}

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
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.scheduled.map((p) => (
                <TR key={p.publishTargetId}>
                  <TD className="font-medium text-zinc-900">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(p.publishTargetId);
                        setSelectedTitle(p.title);
                      }}
                      className="text-left text-indigo-700 underline-offset-2 hover:underline"
                    >
                      {p.title}
                    </button>
                  </TD>
                  <TD>
                    <Badge tone={QUEUE_STATUS_TONE[p.status ?? 'SCHEDULED']}>
                      {statusLabel(p.status)}
                    </Badge>
                  </TD>
                  <TD title={absoluteTime(p.scheduledAt)}>{relativeTime(p.scheduledAt)}</TD>
                  <TD>
                    {(p.status === 'SCHEDULED' || p.status === 'PENDING' || p.status === 'FAILED') && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={schedBusy || data.demo}
                        onClick={() => {
                          void (async () => {
                            setSchedBusy(true);
                            try {
                              await publishTargetNow(p.publishTargetId);
                              toast('Set to publish now', 'success');
                              await load();
                            } catch (err) {
                              toast(
                                err instanceof ApiError ? err.message : 'Publish now failed',
                                'error',
                              );
                            } finally {
                              setSchedBusy(false);
                            }
                          })();
                        }}
                      >
                        Publish now
                      </Button>
                    )}
                  </TD>
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
      <PostDetailModal
        open={selectedId != null}
        onClose={() => setSelectedId(null)}
        publishTargetId={selectedId}
        seedTitle={selectedTitle}
        onChanged={() => void load()}
      />
      </div>

      <Card>
        <CardHeader
          title="Failed publishes"
          description="Drafts and failures that need a retry (includes media or platform errors)"
        />
        {loading ? (
          <p className="p-4 text-sm text-zinc-500">Loading…</p>
        ) : data.failed.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No failed publishes" hint="Failed or blocked posts will show up here with a Retry action." />
          </div>
        ) : (
          <Table className="rounded-t-none border-0">
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Status</TH>
                <TH>Error</TH>
                <TH>Updated</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {data.failed.map((p) => (
                <TR key={p.publishTargetId}>
                  <TD className="font-medium text-zinc-900">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(p.publishTargetId);
                        setSelectedTitle(p.title);
                      }}
                      className="text-left text-indigo-700 underline-offset-2 hover:underline"
                    >
                      {p.title}
                    </button>
                  </TD>
                  <TD>
                    <Badge tone={QUEUE_STATUS_TONE[p.status]}>{statusLabel(p.status)}</Badge>
                  </TD>
                  <TD className="max-w-xs truncate text-xs text-red-700" title={errorText(p.lastError)}>
                    {errorText(p.lastError) || '—'}
                  </TD>
                  <TD title={absoluteTime(p.updatedAt)}>{relativeTime(p.updatedAt)}</TD>
                  <TD>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={schedBusy || data.demo || retryingId === p.publishTargetId}
                        onClick={() => {
                          void (async () => {
                            setRetryingId(p.publishTargetId);
                            try {
                              await retryPublishTarget(p.publishTargetId);
                              toast('Retry queued', 'success');
                              await load();
                            } catch (err) {
                              toast(
                                err instanceof ApiError ? err.message : 'Retry failed',
                                'error',
                              );
                            } finally {
                              setRetryingId(null);
                            }
                          })();
                        }}
                      >
                        {retryingId === p.publishTargetId ? 'Retrying…' : 'Retry'}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        disabled={schedBusy || data.demo || retryingId === p.publishTargetId}
                        onClick={() => {
                          void (async () => {
                            setSchedBusy(true);
                            try {
                              await publishTargetNow(p.publishTargetId);
                              toast('Set to publish now', 'success');
                              await load();
                            } catch (err) {
                              toast(
                                err instanceof ApiError ? err.message : 'Publish now failed',
                                'error',
                              );
                            } finally {
                              setSchedBusy(false);
                            }
                          })();
                        }}
                      >
                        Publish now
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>

      <Card>
        <CardHeader title="Last 10 published" description="Most recently published posts on this account" />
        {loading ? (
          <p className="p-4 text-sm text-zinc-500">Loading…</p>
        ) : data.published.length === 0 ? (
          <div className="p-4">
            <EmptyState title="Nothing published yet" hint="Published videos will appear here." />
          </div>
        ) : (
          <Table className="rounded-t-none border-0">
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Status</TH>
                <TH>Published</TH>
              </TR>
            </THead>
            <TBody>
              {data.published.map((p) => (
                <TR key={p.publishTargetId}>
                  <TD className="font-medium text-zinc-900">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(p.publishTargetId);
                        setSelectedTitle(p.title);
                      }}
                      className="text-left text-indigo-700 underline-offset-2 hover:underline"
                    >
                      {p.title}
                    </button>
                  </TD>
                  <TD>
                    <Badge tone="green">Published</Badge>
                  </TD>
                  <TD title={p.publishedAt ? absoluteTime(p.publishedAt) : ''}>
                    {p.publishedAt ? relativeTime(p.publishedAt) : '—'}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
