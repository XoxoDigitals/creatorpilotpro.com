'use client';

import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { TaskStatusBadge } from '@/components/ui/status-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/cn';
import { relativeTime, absoluteTime } from '@/lib/format';
import { getAccounts, getTasks } from '@/lib/mock-data';
import type { TaskStatus } from '@/lib/domain-types';

const COLUMNS: { key: TaskStatus; label: string }[] = [
  { key: 'ASSIGNED', label: 'Assigned' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'SUBMITTED', label: 'Submitted' },
  { key: 'DONE', label: 'Done' },
];

export default function WorkersPage() {
  const tasks = getTasks();
  const accounts = getAccounts();
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

  if (tasks.length === 0) {
    return (
      <div>
        <PageHeader title="Workers" description="Production task board and team productivity" />
        <EmptyState
          title="No tasks yet"
          hint="Approved ideas become production briefs and are auto-assigned to your team (Phase 4)."
        />
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Workers"
        description="Production task board — workers receive their next approved task automatically"
      />

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
