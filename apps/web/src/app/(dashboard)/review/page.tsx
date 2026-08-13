'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Avatar } from '@/components/ui/avatar';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ReviewList } from '@/components/review-list';
import { getAccountsView, getReviewView, decideReview, setSourceRights } from '@/lib/api-data';
import type { Account, ReviewItem, ReviewStatus } from '@/lib/domain-types';

export default function GlobalReviewPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [accts, review] = await Promise.all([getAccountsView(), getReviewView()]);
      setAccounts(accts.accounts);
      setItems(review.items);
      setDemo(accts.demo || review.demo);
    } catch {
      // keep empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const onDecide = demo
    ? undefined
    : async (item: ReviewItem, status: ReviewStatus) => {
        await decideReview(item.id, status);
        await load();
      };

  const onSetRights = demo
    ? undefined
    : async (item: ReviewItem, rightsNote: string) => {
        if (!item.sourceVideoId) throw new Error('This item has no source video to attach a rights note to.');
        await setSourceRights(item.sourceVideoId, rightsNote);
        await load();
      };

  if (loading) {
    return (
      <div>
        <PageHeader title="Review Queue" description="Everything waiting for approval" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const byAccount = accounts
    .map((a) => ({ account: a, items: items.filter((r) => r.accountId === a.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <PageHeader
        title="Review Queue"
        description="Everything waiting for approval, grouped by account — nothing publishes without you"
      />

      {demo && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo data — connect a real account to see live review items.
        </div>
      )}

      {byAccount.length === 0 ? (
        <EmptyState
          title="All caught up"
          hint="Ingested videos, finished uploads, and scheduled packages land here when they need a human decision."
        />
      ) : (
        <div className="space-y-8">
          {byAccount.map(({ account, items: acctItems }) => (
            <section key={account.id}>
              <Link
                href={`/accounts/${account.id}/review` as Route}
                className="mb-2 flex items-center gap-2 text-sm font-semibold text-zinc-900 hover:text-indigo-600"
              >
                <span className="relative">
                  <Avatar name={account.name} size="sm" />
                  <span className="absolute -bottom-0.5 -right-0.5 rounded-full bg-white p-0.5">
                    <PlatformIcon platform={account.platform} size={10} />
                  </span>
                </span>
                {account.name}
                <span className="nums rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                  {acctItems.filter((i) => i.status === 'PENDING').length} pending
                </span>
              </Link>
              <ReviewList
                items={acctItems}
                onDecide={onDecide}
                onSetRights={onSetRights}
                emptyHint="Nothing pending for this account."
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
