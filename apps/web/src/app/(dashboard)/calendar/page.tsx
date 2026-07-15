'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/cn';
import { getAccounts, getPosts } from '@/lib/mock-data';
import type { Post } from '@/lib/domain-types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const STATUS_DOT: Record<Post['status'], string> = {
  PUBLISHED: 'bg-green-500',
  SCHEDULED: 'bg-indigo-500',
  IN_REVIEW: 'bg-amber-500',
  DRAFT: 'bg-zinc-400',
  FAILED: 'bg-red-500',
};

export default function CalendarPage() {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const accounts = getAccounts();
  const posts = getPosts().filter((p) => p.scheduledAt || p.publishedAt);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const monthLabel = cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  // Build a Monday-first month grid.
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7; // days from Monday
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => new Date(year, month, i + 1)),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const postsOn = (d: Date) =>
    posts.filter((p) => {
      const t = new Date(p.publishedAt ?? p.scheduledAt!);
      return (
        t.getFullYear() === d.getFullYear() && t.getMonth() === d.getMonth() && t.getDate() === d.getDate()
      );
    });

  const today = new Date();
  const isToday = (d: Date) =>
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();

  return (
    <div>
      <PageHeader
        title="Calendar"
        description="Published and scheduled content across every account"
        actions={
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setCursor(new Date(year, month - 1, 1))}>
              ←
            </Button>
            <span className="min-w-36 text-center text-sm font-medium text-zinc-700">{monthLabel}</span>
            <Button size="sm" onClick={() => setCursor(new Date(year, month + 1, 1))}>
              →
            </Button>
          </div>
        }
      />

      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
        <div className="grid min-w-[840px] grid-cols-7 border-b border-zinc-200 bg-zinc-50 text-center text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid min-w-[840px] grid-cols-7">
          {cells.map((d, i) => (
            <div
              key={i}
              className={cn(
                'min-h-[104px] border-b border-r border-zinc-100 p-1.5',
                d == null && 'bg-zinc-50/60',
                (i + 1) % 7 === 0 && 'border-r-0',
              )}
            >
              {d && (
                <>
                  <span
                    className={cn(
                      'nums inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px]',
                      isToday(d) ? 'bg-indigo-600 font-semibold text-white' : 'text-zinc-500',
                    )}
                  >
                    {d.getDate()}
                  </span>
                  <div className="mt-1 space-y-1">
                    {postsOn(d).map((p) => {
                      const acc = accounts.find((a) => a.id === p.accountId);
                      return (
                        <div
                          key={p.id}
                          title={`${acc?.name}: ${p.title} (${p.status.toLowerCase()})`}
                          className="flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1 py-0.5"
                        >
                          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[p.status])} />
                          <Avatar name={acc?.name ?? '?'} size="xs" />
                          <span className="truncate text-[10px] text-zinc-600">{p.title}</span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-zinc-500">
        {Object.entries({ Published: 'bg-green-500', Scheduled: 'bg-indigo-500', 'In review': 'bg-amber-500', Draft: 'bg-zinc-400', Failed: 'bg-red-500' }).map(
          ([label, dot]) => (
            <span key={label} className="flex items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', dot)} /> {label}
            </span>
          ),
        )}
        <span className="ml-auto text-zinc-400">Drag-to-reschedule arrives with the scheduling engine (Phase 2)</span>
      </div>
    </div>
  );
}
