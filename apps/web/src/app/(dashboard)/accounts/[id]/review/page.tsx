'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ReviewList } from '@/components/review-list';
import { getReviewView, decideReview } from '@/lib/api-data';
import type { ReviewItem, ReviewStatus } from '@/lib/domain-types';

export default function AccountReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { items: list, demo: isDemo } = await getReviewView(id);
      setItems(list);
      setDemo(isDemo);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDecide = demo
    ? undefined
    : async (item: ReviewItem, status: ReviewStatus) => {
        await decideReview(item.id, status);
        await load();
      };

  if (loading) return <p className="p-4 text-sm text-zinc-500">Loading review queue…</p>;

  return (
    <ReviewList
      items={items}
      onDecide={onDecide}
      emptyHint="Approved sources and worker uploads for this account will queue here for your review."
    />
  );
}
