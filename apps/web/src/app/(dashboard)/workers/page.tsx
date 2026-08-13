'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { TaskStatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { relativeTime, absoluteTime } from '@/lib/format';
import { getTasksView, startTask, requestRevision, acceptTask, getAccountsView } from '@/lib/api-data';
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
 * Production task board for assigned WorkerTask rows (Owner/Admin).
 * Not pg-boss system workers, and not a fourth user role — assignees are Reviewers.
 */
export default function WorkersPage() {
  const toast = useToast();
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [tasks, setTasks] = useState<WorkerTask[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
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
      const [result, accts] = await Promise.all([getTasksView(), getAccountsView()]);
      setTasks(result.tasks);
      setAccounts(accts.accounts);
      setDemo(result.demo || accts.demo);
    } catch {
      toast('Failed to load tasks', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

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

  if (allowed === false) {
    return null;
  }

  if (allowed === null || loading) {
    return (
      <div>
        <PageHeader
          title="Production board"
          description="Assigned production briefs and uploads — not a user role, and not background job workers"
        />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div>
        <PageHeader
          title="Production board"
          description="Assigned production briefs and uploads — not a user role, and not background job workers"
        />
        <EmptyState
          title="No tasks yet"
          hint="Approved ideas become production briefs and can be assigned to Reviewers on your team. This page is a task board, not a list of users by role."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Production board"
        description="Kanban of production tasks assigned to Reviewers. Separate from system/queue workers and from Settings → Users roles."
      />
      {demo && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo data — connect a real account to manage real production tasks.
        </div>
      )}

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
    </div>
  );
}
