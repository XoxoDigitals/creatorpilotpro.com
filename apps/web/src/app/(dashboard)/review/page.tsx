'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { Avatar } from '@/components/ui/avatar';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { EmptyState } from '@/components/ui/empty-state';
import { ReviewList } from '@/components/review-list';
import { getAccounts, getReviewItems } from '@/lib/mock-data';

export default function GlobalReviewPage() {
  const accounts = getAccounts();
  const all = getReviewItems();
  const byAccount = accounts
    .map((a) => ({ account: a, items: all.filter((r) => r.accountId === a.id) }))
    .filter((g) => g.items.length > 0);

  return (
    <div>
      <PageHeader
        title="Review Queue"
        description="Everything waiting for approval, grouped by account — nothing moves forward without you"
      />

      {byAccount.length === 0 ? (
        <EmptyState
          title="All caught up"
          hint="Ingested videos, worker uploads, ideas, and metadata land here when they need a human decision."
        />
      ) : (
        <div className="space-y-8">
          {byAccount.map(({ account, items }) => (
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
                  {items.filter((i) => i.status === 'PENDING').length} pending
                </span>
              </Link>
              <ReviewList
                items={items}
                emptyHint="Nothing pending for this account."
              />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
