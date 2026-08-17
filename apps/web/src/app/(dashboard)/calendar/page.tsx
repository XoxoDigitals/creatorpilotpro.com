'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { Label } from '@/components/ui/input';
import { PostDetailModal } from '@/components/post-detail-modal';
import { cn } from '@/lib/cn';
import { getAccountsView, getPostsView } from '@/lib/api-data';
import type { Account, Post, PostStatus } from '@/lib/domain-types';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const ALL_STATUSES: PostStatus[] = ['PUBLISHED', 'SCHEDULED', 'IN_REVIEW', 'DRAFT', 'FAILED'];

const STATUS_LABEL: Record<PostStatus, string> = {
  PUBLISHED: 'Published',
  SCHEDULED: 'Scheduled',
  IN_REVIEW: 'In review',
  DRAFT: 'Draft',
  FAILED: 'Failed',
};

const STATUS_DOT: Record<PostStatus, string> = {
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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTitle, setSelectedTitle] = useState<string | undefined>();
  /** Empty = all accounts. */
  const [accountFilter, setAccountFilter] = useState<string[]>([]);
  /** Empty = all statuses. */
  const [statusFilter, setStatusFilter] = useState<PostStatus[]>([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void (async () => {
      const [{ accounts: accs }, { posts: ps }] = await Promise.all([
        getAccountsView(),
        getPostsView(),
      ]);
      setAccounts(accs);
      setPosts(ps.filter((p) => p.scheduledAt || p.publishedAt));
    })();
  }, []);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!accountMenuRef.current?.contains(e.target as Node)) setAccountMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAccountMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [accountMenuOpen]);

  const filteredPosts = useMemo(() => {
    return posts.filter((p) => {
      if (accountFilter.length > 0 && !accountFilter.includes(p.accountId)) return false;
      if (statusFilter.length > 0 && !statusFilter.includes(p.status)) return false;
      return true;
    });
  }, [posts, accountFilter, statusFilter]);

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
    filteredPosts.filter((p) => {
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

  const filtersActive = accountFilter.length > 0 || statusFilter.length > 0;
  const accountButtonLabel =
    accountFilter.length === 0
      ? 'All accounts'
      : accountFilter.length === 1
        ? (accounts.find((a) => a.id === accountFilter[0])?.name ?? '1 account')
        : `${accountFilter.length} accounts`;

  function toggleStatus(status: PostStatus) {
    setStatusFilter((prev) => {
      // Empty means "all"; first click starts from full set minus the toggled one.
      const current = prev.length === 0 ? [...ALL_STATUSES] : prev;
      const next = current.includes(status)
        ? current.filter((s) => s !== status)
        : [...current, status];
      if (next.length === 0 || next.length === ALL_STATUSES.length) return [];
      return next;
    });
  }

  function statusSelected(status: PostStatus) {
    return statusFilter.length === 0 || statusFilter.includes(status);
  }

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

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="relative" ref={accountMenuRef}>
          <Label>Account</Label>
          <button
            type="button"
            onClick={() => setAccountMenuOpen((o) => !o)}
            className={cn(
              'flex h-9 min-w-[11rem] items-center justify-between gap-2 rounded-md border border-zinc-300 bg-white px-3 text-left text-sm text-zinc-900',
              'focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/30',
            )}
            aria-expanded={accountMenuOpen}
            aria-haspopup="listbox"
          >
            <span className="truncate">{accountButtonLabel}</span>
            <span className="text-zinc-400">▾</span>
          </button>
          {accountMenuOpen && (
            <div
              role="listbox"
              aria-multiselectable
              className="absolute left-0 z-20 mt-1 max-h-64 w-64 overflow-y-auto rounded-md border border-zinc-200 bg-white py-1 shadow-lg"
            >
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50">
                <input
                  type="checkbox"
                  className="rounded border-zinc-300"
                  checked={accountFilter.length === 0}
                  onChange={() => setAccountFilter([])}
                />
                All accounts
              </label>
              <div className="my-1 border-t border-zinc-100" />
              {accounts.length === 0 ? (
                <p className="px-3 py-2 text-xs text-zinc-500">No accounts connected</p>
              ) : (
                accounts.map((a) => {
                  const checked =
                    accountFilter.length === 0 || accountFilter.includes(a.id);
                  return (
                    <label
                      key={a.id}
                      className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-zinc-300"
                        checked={checked}
                        onChange={() => {
                          if (accountFilter.length === 0) {
                            // Leaving "all": keep every account except the one unchecked.
                            setAccountFilter(accounts.map((x) => x.id).filter((id) => id !== a.id));
                            return;
                          }
                          const next = accountFilter.includes(a.id)
                            ? accountFilter.filter((id) => id !== a.id)
                            : [...accountFilter, a.id];
                          setAccountFilter(next.length === accounts.length ? [] : next);
                        }}
                      />
                      <Avatar name={a.name} size="xs" />
                      <span className="truncate">{a.name}</span>
                    </label>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div>
          <Label>Status</Label>
          <div className="flex flex-wrap gap-1.5">
            {ALL_STATUSES.map((s) => {
              const on = statusSelected(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleStatus(s)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                    on
                      ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                      : 'border-zinc-200 bg-white text-zinc-400 hover:border-zinc-300 hover:text-zinc-600',
                  )}
                  aria-pressed={on}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[s], !on && 'opacity-40')} />
                  {STATUS_LABEL[s]}
                </button>
              );
            })}
          </div>
        </div>

        {filtersActive && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAccountFilter([]);
              setStatusFilter([]);
            }}
          >
            Clear
          </Button>
        )}

        <p className="ml-auto pb-1 text-[11px] text-zinc-500">
          {filteredPosts.length} of {posts.length}
        </p>
      </div>

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
                        <button
                          type="button"
                          key={p.id}
                          title={`${acc?.name}: ${p.title} (${p.status.toLowerCase()})`}
                          onClick={() => {
                            setSelectedId(p.id);
                            setSelectedTitle(p.title);
                          }}
                          className="flex w-full items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-1 py-0.5 text-left transition-colors hover:border-indigo-300 hover:bg-indigo-50"
                        >
                          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[p.status])} />
                          <Avatar name={acc?.name ?? '?'} size="xs" />
                          <span className="truncate text-[10px] font-medium text-zinc-700 underline-offset-2 hover:underline">
                            {p.title}
                          </span>
                        </button>
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
        {ALL_STATUSES.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={cn('h-2 w-2 rounded-full', STATUS_DOT[s])} /> {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="ml-auto text-zinc-400">Drag-to-reschedule arrives with the scheduling engine (Phase 2)</span>
      </div>

      <PostDetailModal
        open={selectedId != null}
        onClose={() => setSelectedId(null)}
        publishTargetId={selectedId}
        seedTitle={selectedTitle}
      />
    </div>
  );
}
