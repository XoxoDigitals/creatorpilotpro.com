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
 * Review queue rows with approve/reject actions. When `onDecide` is provided the
 * decision is persisted via the real API (content approve/reject); otherwise it
 * falls back to local-state only (demo mode / mock contract). Ingested videos are
 * gated: they cannot be approved until a rights note is recorded (docs/04 §3), set
 * inline via `onSetRights` (or local-only in demo).
 */
export function ReviewList({
  items,
  emptyHint,
  onDecide,
  onSetRights,
}: {
  items: ReviewItem[];
  emptyHint: string;
  onDecide?: (item: ReviewItem, status: ReviewStatus) => Promise<void>;
  onSetRights?: (item: ReviewItem, rightsNote: string) => Promise<void>;
}) {
  const toast = useToast();
  const [decisions, setDecisions] = useState<Record<string, ReviewStatus>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  // Local overrides for rights notes set during this session.
  const [rightsById, setRightsById] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const effectiveRights = (item: ReviewItem): string | null =>
    rightsById[item.id] ?? item.rightsNote;

  const decide = async (item: ReviewItem, status: ReviewStatus) => {
    if (status === 'APPROVED' && item.kind === 'INGESTED_VIDEO' && !effectiveRights(item)) {
      toast('Add a rights note before approving this ingested video.', 'error');
      return;
    }
    if (!onDecide) {
      setDecisions((d) => ({ ...d, [item.id]: status }));
      toast(
        `${status === 'APPROVED' ? 'Approved' : 'Rejected'}: ${item.title} (demo — connect a real account to persist)`,
        status === 'APPROVED' ? 'success' : 'info',
      );
      return;
    }
    setBusy((b) => ({ ...b, [item.id]: true }));
    try {
      await onDecide(item, status);
      setDecisions((d) => ({ ...d, [item.id]: status }));
      toast(`${status === 'APPROVED' ? 'Approved' : 'Rejected'}: ${item.title}`, status === 'APPROVED' ? 'success' : 'info');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save decision', 'error');
    } finally {
      setBusy((b) => ({ ...b, [item.id]: false }));
    }
  };

  const saveRights = async (item: ReviewItem) => {
    const note = draft.trim();
    if (!note) return toast('Enter a rights note.', 'error');
    setBusy((b) => ({ ...b, [item.id]: true }));
    try {
      if (onSetRights) await onSetRights(item, note);
      setRightsById((r) => ({ ...r, [item.id]: note }));
      setEditing(null);
      setDraft('');
      toast('Rights note saved', 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save rights note', 'error');
    } finally {
      setBusy((b) => ({ ...b, [item.id]: false }));
    }
  };

  if (items.length === 0) {
    return <EmptyState title="Review queue is empty" hint={emptyHint} />;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const status = decisions[item.id] ?? item.status;
        const kind = KIND[item.kind];
        const rights = effectiveRights(item);
        const gated = item.kind === 'INGESTED_VIDEO' && !rights;
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
                {rights ? (
                  <>
                    <span className="text-zinc-300">·</span>
                    <span className="text-green-600">rights: {rights}</span>
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

              {editing === item.id && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="e.g. Licensed via SourcePack A / owner-confirmed"
                    className="min-w-[240px] flex-1 rounded-md border border-zinc-300 px-2.5 py-1.5 text-xs outline-none focus:border-indigo-500"
                  />
                  <Button size="sm" variant="primary" disabled={busy[item.id]} onClick={() => void saveRights(item)}>
                    Save
                  </Button>
                  <Button size="sm" disabled={busy[item.id]} onClick={() => { setEditing(null); setDraft(''); }}>
                    Cancel
                  </Button>
                </div>
              )}
            </div>
            {status === 'PENDING' && (
              <div className="flex shrink-0 gap-2">
                {gated && editing !== item.id && (
                  <Button
                    size="sm"
                    disabled={busy[item.id]}
                    onClick={() => { setEditing(item.id); setDraft(''); }}
                  >
                    Add rights note
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy[item.id]}
                  onClick={() => void decide(item, 'REJECTED')}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={busy[item.id] || gated}
                  title={gated ? 'Add a rights note before approving' : undefined}
                  onClick={() => void decide(item, 'APPROVED')}
                >
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
