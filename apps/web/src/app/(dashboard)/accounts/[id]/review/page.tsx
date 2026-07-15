'use client';

import { useParams } from 'next/navigation';
import { ReviewList } from '@/components/review-list';
import { getReviewItems } from '@/lib/mock-data';

export default function AccountReviewPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <ReviewList
      items={getReviewItems(id)}
      emptyHint="Approved sources and worker uploads for this account will queue here for your review."
    />
  );
}
