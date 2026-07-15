'use client';

import { useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ReviewStatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { relativeTime, absoluteTime, duration } from '@/lib/format';
import type { ReviewItem, ReviewKind, ReviewStatus } from '@/lib/domain-types';

const KIND: Record<ReviewKind, { tone: BadgeTone; label: string }> = {
  INGESTED_VIDEO: { tone: 'sky', label: 'Ingested video' },
  PRODUCED_VIDEO: { tone: 'violet', label: 'Produced video' },
  IDEA: { tone: 'indigo', label: 'Idea' },
  METADATA: { tone: 'neutral', label: 'Metadata' },
};

/**
 * Review queue rows with approve/reject actions. Decisions are local-state only
 * until Phase 2 wires the real review endpoints (mock layer contract).
 */
export function ReviewList({ items, emptyHint }: { items: ReviewItem[]; emptyHint: string }) {
  const toast = useToast();
  const [decisions, setDecisions] = useState<Record<string, ReviewStatus>>({});

  const decide = (item: ReviewItem, status: ReviewStatus) => {
    setDecisions((d) => ({ ...d, [item.id]: status }));
    toast(
      `${status === 'APPROVED' ? 'Approved' : 'Rejected'}: ${item.title} (mock — persists in Phase 2)`,
      status === 'APPROVED' ? 'success' : 'info',
    );
  };

  if (items.length === 0) {
    return <EmptyState title="Review queue is empty" hint={emptyHint} />;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const status = decisions[item.id] ?? item.status;
        const kind = KIND[item.kind];
        return (
          <li
            key={item.id}
            className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm"
          >
            {/* Thumb placeholder for video kinds */}
            {(item.kind === 'INGESTED_VIDEO' || item.kind === 'PRODUCED_VIDEO') && (
              <span className="flex h-10 w-16 shrink-0 items-center justify-center rounded-md bg-zinc-900 text-[10px] font-medium text-zinc-400">
                {duration(item.durationSec)}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-zinc-900">{item.title}</p>
                <Badge tone={kind.tone}>{kind.label}</Badge>
                {status !== 'PENDING' && <ReviewStatusBadge status={status} />}
              </div>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span title={absoluteTime(item.submittedAt)}>
                  submitted {relativeTime(item.submittedAt)}
                </span>
                {item.sourceUrl && (
                  <>
                    <span className="text-zinc-300">·</span>
                    <a
                      className="text-indigo-600 hover:underline"
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      source ↗
                    </a>
                  </>
                )}
                {item.rightsNote ? (
                  <>
                    <span className="text-zinc-300">·</span>
                    <span className="text-green-600">rights: {item.rightsNote}</span>
                  </>
                ) : (
                  item.kind === 'INGESTED_VIDEO' && (
                    <>
                      <span className="text-zinc-300">·</span>
                      <span className="text-amber-600">rights note required before approval</span>
                    </>
                  )
                )}
              </p>
            </div>
            {status === 'PENDING' && (
              <div className="flex shrink-0 gap-2">
                <Button size="sm" variant="danger" onClick={() => decide(item, 'REJECTED')}>
                  Reject
                </Button>
                <Button size="sm" variant="primary" onClick={() => decide(item, 'APPROVED')}>
                  Approve
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
