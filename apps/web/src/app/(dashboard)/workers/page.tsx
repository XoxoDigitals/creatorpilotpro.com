'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { TaskStatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { relativeTime, absoluteTime, formatBytes } from '@/lib/format';
import {
  getTasksView,
  startTask,
  requestRevision,
  acceptTask,
  getAccountsView,
  getLocalMediaAssets,
  deleteLocalMediaAsset,
  deleteLocalMediaAssetsBulk,
  clearLocalMediaIncidents,
  type LocalMediaAsset,
} from '@/lib/api-data';
import { api } from '@/lib/api';
import { isSystemAdmin, type SessionUser } from '@/lib/types';
import type { Account, TaskStatus, WorkerTask } from '@/lib/domain-types';

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'UPLOADED', label: 'Uploaded' },
  { key: 'DONE', label: 'Done' },
];

/**
 * Production board + local hot-tier media inventory (Owner/Admin).
 * Local delete time for dual-store = driveUploadedAt + 12h.
 */
export default function WorkersPage() {
  const toast = useToast();
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tasks, setTasks] = useState<WorkerTask[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [localAssets, setLocalAssets] = useState<LocalMediaAsset[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  const accountName = (accountId: string) => accounts.find((a) => a.id === accountId)?.name ?? accountId;

  useEffect(() => {
    let alive = true;
    void api
      .get<{ user: SessionUser }>('/auth/me')
      .then(({ user }) => {
        if (!alive) return;
        if (!isSystemAdmin(user.role)) {
          setAllowed(false);
          router.replace('/dashboard');
          return;
        }
        setAllowed(true);
      })
      .catch(() => {
        if (alive) {
          setAllowed(false);
          router.replace('/dashboard');
        }
      });
    return () => {
      alive = false;
    };
  }, [router]);

  const load = useCallback(async () => {
    try {
      const [result, accts, media] = await Promise.all([
        getTasksView(),
        getAccountsView(),
        getLocalMediaAssets().catch(() => [] as LocalMediaAsset[]),
      ]);
      setTasks(result.tasks);
      setAccounts(accts.accounts);
      setLocalAssets(media);
      setDemo(result.demo || accts.demo);
      setSelected(new Set());
    } catch {
      toast('Failed to load workers data', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const allSelected = useMemo(
    () => localAssets.length > 0 && selected.size === localAssets.length,
    [localAssets, selected],
  );

  function toggleAll() {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(localAssets.map((a) => a.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleStart(taskId: string) {
    if (demo) { toast('Demo mode — connect a real account', 'info'); return; }
    try {
      await startTask(taskId);
      toast('Task started', 'success');
      void load();
    } catch { toast('Failed to start task', 'error'); }
  }

  async function handleAccept(taskId: string) {
    if (demo) { toast('Demo mode — connect a real account', 'info'); return; }
    try {
      await acceptTask(taskId);
      toast('Task accepted — content item created', 'success');
      void load();
    } catch { toast('Failed to accept task', 'error'); }
  }

  async function handleRevision(taskId: string) {
    if (demo) { toast('Demo mode — connect a real account', 'info'); return; }
    const note = prompt('Revision note:');
    if (!note) return;
    try {
      await requestRevision(taskId, note);
      toast('Revision requested', 'success');
      void load();
    } catch { toast('Failed to request revision', 'error'); }
  }

  async function onDeleteLocal(asset: LocalMediaAsset) {
    if (!asset.canDeleteLocal) {
      toast('Local-only files cannot be deleted here — archive to Drive first', 'info');
      return;
    }
    if (!confirm(`Delete local copy of “${asset.title}”? Drive copy is kept.`)) return;
    setBusy(true);
    try {
      await deleteLocalMediaAsset(asset.id);
      toast('Local file deleted', 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Delete failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onBulkDelete() {
    const ids = [...selected].filter((id) => localAssets.find((a) => a.id === id)?.canDeleteLocal);
    if (ids.length === 0) {
      toast('Select dual-store items (Drive copy required) to delete local files', 'info');
      return;
    }
    if (!confirm(`Delete local copies for ${ids.length} item(s)? Drive copies are kept.`)) return;
    setBusy(true);
    try {
      const result = await deleteLocalMediaAssetsBulk(ids);
      toast(`Deleted ${result.deleted} local file(s)${result.skipped ? ` (${result.skipped} skipped)` : ''}`, 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Bulk delete failed', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function onClearIncidents(asset: LocalMediaAsset) {
    if (asset.relatedIncidentIds.length === 0) {
      toast('No related open media incidents', 'info');
      return;
    }
    setBusy(true);
    try {
      const result = await clearLocalMediaIncidents(asset.id);
      toast(
        result.resolved > 0
          ? `Cleared ${result.resolved} incident(s)`
          : 'No incidents to clear',
        result.resolved > 0 ? 'success' : 'info',
      );
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not clear incidents', 'error');
    } finally {
      setBusy(false);
    }
  }

  if (allowed === false) {
    return null;
  }

  if (allowed === null || loading) {
    return (
      <div>
        <PageHeader
          title="Workers"
          description="Local media on disk and production task board"
        />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Workers"
        description="Local hot-tier videos (size + scheduled purge) and production briefs. Dual-store local purge = Drive upload + 12h."
        actions={
          selected.size > 0 ? (
            <Button variant="danger" size="sm" disabled={busy} onClick={() => void onBulkDelete()}>
              Delete local ({selected.size})
            </Button>
          ) : undefined
        }
      />

      {demo && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo data for production tasks — local media list uses the live API when connected.
        </div>
      )}

      <section className="mb-10">
        <div className="mb-3 flex items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900">Local media</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Videos still on disk. Upcoming delete applies when dual-stored with Drive (upload + 12h). Local-only has no auto-delete.
            </p>
          </div>
          <span className="nums text-xs text-zinc-400">{localAssets.length} file(s)</span>
        </div>

        {localAssets.length === 0 ? (
          <EmptyState
            title="No local video files"
            hint="Rendered or uploaded videos still on the hot tier will appear here until purged or deleted."
          />
        ) : (
          <Table>
            <THead>
              <TR>
                <TH className="w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    aria-label="Select all"
                    className="rounded border-zinc-300"
                  />
                </TH>
                <TH>Title</TH>
                <TH>Account</TH>
                <TH>Kind</TH>
                <TH numeric>Size</TH>
                <TH>Upcoming delete</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {localAssets.map((a) => {
                const overdue =
                  a.localDeleteAt != null && Date.parse(a.localDeleteAt) <= Date.now();
                return (
                  <TR key={a.id}>
                    <TD>
                      <input
                        type="checkbox"
                        checked={selected.has(a.id)}
                        onChange={() => toggleOne(a.id)}
                        aria-label={`Select ${a.title}`}
                        className="rounded border-zinc-300"
                      />
                    </TD>
                    <TD>
                      <p className="font-medium text-zinc-900">{a.title}</p>
                      {a.fileMissing && (
                        <p className="text-[11px] text-amber-600">Path on record, file missing on disk</p>
                      )}
                      {a.storageState === 'BOTH' && (
                        <p className="text-[11px] text-zinc-400">Dual-store (local + Drive)</p>
                      )}
                      {a.storageState === 'LOCAL' && (
                        <p className="text-[11px] text-zinc-400">Local only</p>
                      )}
                    </TD>
                    <TD>{a.accountName ?? '—'}</TD>
                    <TD className="text-xs uppercase tracking-wide text-zinc-500">{a.kind}</TD>
                    <TD numeric>{formatBytes(a.bytes)}</TD>
                    <TD>
                      {a.localDeleteAt ? (
                        <span
                          title={absoluteTime(a.localDeleteAt)}
                          className={cn(
                            'text-xs',
                            overdue ? 'font-medium text-amber-700' : 'text-zinc-600',
                          )}
                        >
                          {overdue ? 'due now' : relativeTime(a.localDeleteAt)}
                          <span className="mt-0.5 block text-[11px] text-zinc-400">
                            {absoluteTime(a.localDeleteAt)}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-400" title="No Drive upload — no automatic local purge">
                          No auto-delete
                        </span>
                      )}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={busy || !a.canDeleteLocal}
                          onClick={() => void onDeleteLocal(a)}
                          title={
                            a.canDeleteLocal
                              ? 'Delete local file (keep Drive)'
                              : 'Requires a Drive copy'
                          }
                          className="rounded px-2 py-0.5 text-[11px] font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Delete local
                        </button>
                        <button
                          type="button"
                          disabled={busy || a.relatedIncidentIds.length === 0}
                          onClick={() => void onClearIncidents(a)}
                          className="rounded px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Clear incident
                          {a.relatedIncidentIds.length > 0
                            ? ` (${a.relatedIncidentIds.length})`
                            : ''}
                        </button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-zinc-900">Production board</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Assigned production briefs — separate from system/queue workers and Settings → Users roles.
          </p>
        </div>

        {tasks.length === 0 ? (
          <EmptyState
            title="No tasks yet"
            hint="Approved ideas become production briefs and can be assigned to Reviewers on your team."
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {COLUMNS.map((col) => {
              const items = tasks.filter((t) => t.status === col.key);
              return (
                <div key={col.key} className="rounded-lg bg-zinc-100/70 p-2">
                  <p className="flex items-center justify-between px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    {col.label}
                    <span className="nums rounded-full bg-zinc-200 px-1.5 text-[10px]">{items.length}</span>
                  </p>
                  <div className="space-y-2">
                    {items.map((t) => {
                      const overdue = t.dueAt && Date.parse(t.dueAt) < Date.now() && t.status !== 'DONE';
                      return (
                        <Card key={t.id} className="p-3">
                          <p className="text-[13px] font-medium leading-snug text-zinc-900">{t.title}</p>
                          <p className="mt-1 text-xs text-zinc-500">{accountName(t.accountId)}</p>
                          <div className="mt-2 flex items-center justify-between">
                            <span className="flex items-center gap-1.5 text-xs text-zinc-600">
                              <Avatar name={t.assignee} size="xs" />
                              {t.assignee}
                            </span>
                            <TaskStatusBadge status={t.status} />
                          </div>
                          {t.dueAt && (
                            <p
                              title={absoluteTime(t.dueAt)}
                              className={cn('mt-2 text-[11px]', overdue ? 'font-medium text-red-600' : 'text-zinc-400')}
                            >
                              due {relativeTime(t.dueAt)}
                              {overdue && ' — overdue'}
                            </p>
                          )}
                          {t.status === 'ASSIGNED' && (
                            <button onClick={() => handleStart(t.id)} className="mt-2 rounded px-2 py-0.5 text-[11px] font-medium text-indigo-700 hover:bg-indigo-50">
                              Start
                            </button>
                          )}
                          {t.status === 'UPLOADED' && (
                            <div className="mt-2 flex gap-1">
                              <button onClick={() => handleAccept(t.id)} className="rounded px-2 py-0.5 text-[11px] font-medium text-green-700 hover:bg-green-50">
                                Accept
                              </button>
                              <button onClick={() => handleRevision(t.id)} className="rounded px-2 py-0.5 text-[11px] font-medium text-amber-700 hover:bg-amber-50">
                                Revision
                              </button>
                            </div>
                          )}
                          {t.revisionNotes.length > 0 && (
                            <p className="mt-1 text-[11px] text-amber-600">
                              {t.revisionNotes.length} revision note(s)
                            </p>
                          )}
                        </Card>
                      );
                    })}
                    {items.length === 0 && <p className="px-1 py-3 text-center text-xs text-zinc-400">—</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
