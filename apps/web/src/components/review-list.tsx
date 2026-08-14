'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { ReviewStatusBadge } from '@/components/ui/status-badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { relativeTime, absoluteTime, duration } from '@/lib/format';
import { contentMediaUrl, contentThumbnailUrl, translateTitle } from '@/lib/api-data';
import { MediaEmbed } from '@/components/media-embed';
import type { ReviewItem, ReviewKind, ReviewStatus } from '@/lib/domain-types';

/** A title is treated as needing translation when it contains characters outside
 * the basic Latin + Latin-1 range (CJK, Cyrillic, Arabic, etc.). Cheap and safe. */
function looksNonEnglish(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[^\u0000-\u00ff]/.test(text);
}

const KIND: Record<ReviewKind, { tone: BadgeTone; label: string }> = {
  INGESTED_VIDEO: { tone: 'sky', label: 'Ingested video' },
  PRODUCED_VIDEO: { tone: 'violet', label: 'Produced video' },
  IDEA: { tone: 'indigo', label: 'Idea' },
  METADATA: { tone: 'neutral', label: 'Metadata' },
};

/**
 * Review queue rows with approve/reject actions. When `onDecide` is provided the
 * decision is persisted via the real API (content approve/reject); otherwise it
 * falls back to local-state only (demo mode / mock contract). Approve is one click
 * with no note prompt.
 *
 * Produced / scheduled uploads show thumbnail, description, and schedule slot so
 * the reviewer can vet the final publish package before Approve releases publish.
 */
export function ReviewList({
  items,
  emptyHint,
  onDecide,
  onDelete,
}: {
  items: ReviewItem[];
  emptyHint: string;
  onDecide?: (item: ReviewItem, status: ReviewStatus) => Promise<void>;
  onDelete?: (item: ReviewItem) => Promise<void>;
}) {
  const toast = useToast();
  const [decisions, setDecisions] = useState<Record<string, ReviewStatus>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [titleOverrides, setTitleOverrides] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState<Record<string, boolean>>({});
  const attemptedRef = useRef<Set<string>>(new Set());

  const effectiveTitle = (item: ReviewItem): string => titleOverrides[item.id] ?? item.title;

  async function runTranslate(item: ReviewItem, silent: boolean) {
    if (translating[item.id]) return;
    setTranslating((t) => ({ ...t, [item.id]: true }));
    try {
      const r = await translateTitle(item.id);
      if (r.title && r.title !== r.originalTitle) {
        setTitleOverrides((o) => ({ ...o, [item.id]: r.title }));
        if (!silent) toast('Title translated to English.', 'success');
      } else if (!silent) {
        toast('Title is already English (or translation unavailable).', 'info');
      }
    } catch (err) {
      if (!silent) toast(err instanceof Error ? err.message : 'Translate failed', 'error');
    } finally {
      setTranslating((t) => ({ ...t, [item.id]: false }));
    }
  }

  useEffect(() => {
    for (const item of items) {
      if (attemptedRef.current.has(item.id)) continue;
      if (!looksNonEnglish(item.title)) continue;
      attemptedRef.current.add(item.id);
      void runTranslate(item, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  const decide = async (item: ReviewItem, status: ReviewStatus) => {
    if (!onDecide) {
      setDecisions((d) => ({ ...d, [item.id]: status }));
      toast(
        `${status === 'APPROVED' ? 'Approved' : 'Rejected'}: ${effectiveTitle(item)} (demo - connect a real account to persist)`,
        status === 'APPROVED' ? 'success' : 'info',
      );
      return;
    }
    setBusy((b) => ({ ...b, [item.id]: true }));
    try {
      await onDecide(item, status);
      setDecisions((d) => ({ ...d, [item.id]: status }));
      toast(
        `${status === 'APPROVED' ? 'Approved' : 'Rejected'}: ${effectiveTitle(item)}`,
        status === 'APPROVED' ? 'success' : 'info',
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save decision', 'error');
    } finally {
      setBusy((b) => ({ ...b, [item.id]: false }));
    }
  };

  const remove = async (item: ReviewItem) => {
    if (!onDelete) return;
    setBusy((b) => ({ ...b, [item.id]: true }));
    try {
      await onDelete(item);
      toast(`Deleted: ${effectiveTitle(item)}`, 'success');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not delete', 'error');
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
        const title = effectiveTitle(item);
        const isVideo = item.kind === 'INGESTED_VIDEO' || item.kind === 'PRODUCED_VIDEO';
        const isPlaying = playing === item.id;
        const canPlay = isVideo;
        return (
          <li
            key={item.id}
            className="flex flex-wrap items-start gap-3 rounded-lg border border-zinc-200 bg-white px-4 py-3 shadow-sm"
          >
            {isVideo && (
              <button
                type="button"
                onClick={() => setPlaying(isPlaying ? null : item.id)}
                className="group relative flex h-16 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md bg-zinc-900 text-[10px] font-medium text-zinc-300 hover:bg-zinc-800"
                title={isPlaying ? 'Hide player' : 'Play video'}
              >
                {item.hasThumbnail ? (
                  item.thumbnailEmbedUrl ? (
                    <iframe
                      title=""
                      src={item.thumbnailEmbedUrl}
                      className="pointer-events-none absolute inset-0 h-full w-full scale-150 border-0 opacity-90"
                      tabIndex={-1}
                    />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={contentThumbnailUrl(item.id)}
                      alt=""
                      className="absolute inset-0 h-full w-full object-cover opacity-90 group-hover:opacity-70"
                    />
                  )
                ) : null}
                <span className="relative z-10 flex items-center gap-1 rounded bg-black/55 px-1.5 py-0.5 text-white">
                  {isPlaying ? 'Hide' : (
                    <>
                      <span aria-hidden>Play</span>
                      <span>{duration(item.durationSec)}</span>
                    </>
                  )}
                </span>
              </button>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-medium text-zinc-900" title={item.title}>
                  {title}
                </p>
                <Badge tone={kind.tone}>{kind.label}</Badge>
                {status !== 'PENDING' && <ReviewStatusBadge status={status} />}
                {titleOverrides[item.id] && (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
                    translated
                  </span>
                )}
                {canPlay && (
                  <button
                    type="button"
                    onClick={() => void runTranslate(item, false)}
                    disabled={translating[item.id]}
                    className="text-[11px] text-indigo-600 hover:underline disabled:text-zinc-400"
                  >
                    {translating[item.id] ? 'Translating...' : 'Translate title'}
                  </button>
                )}
              </div>
              {titleOverrides[item.id] && (
                <p className="mt-0.5 text-[11px] italic text-zinc-500" title={item.title}>
                  original: {item.title}
                </p>
              )}
              {item.description && (
                <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-zinc-600">
                  {item.description}
                </p>
              )}
              {item.tags && item.tags.length > 0 && (
                <p className="mt-1 line-clamp-2 text-[11px] text-zinc-500">
                  {item.tags.join(' · ')}
                </p>
              )}
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                <span title={absoluteTime(item.submittedAt)}>
                  submitted {relativeTime(item.submittedAt)}
                </span>
                {item.scheduledAt && (
                  <>
                    <span className="text-zinc-300">|</span>
                    <span title={absoluteTime(item.scheduledAt)}>
                      scheduled {absoluteTime(item.scheduledAt)}
                    </span>
                  </>
                )}
                {item.sourceUrl && (
                  <>
                    <span className="text-zinc-300">|</span>
                    <a
                      className="text-indigo-600 hover:underline"
                      href={item.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      source
                    </a>
                  </>
                )}
                {item.rightsNote && (
                  <>
                    <span className="text-zinc-300">|</span>
                    <span className="text-green-600">rights: {item.rightsNote}</span>
                  </>
                )}
              </p>

              {isPlaying && (
                <MediaEmbed
                  kind="video"
                  embedUrl={item.videoEmbedUrl}
                  streamUrl={contentMediaUrl(item.id)}
                  className="mt-3 aspect-video w-full max-w-md rounded-md border border-zinc-200 bg-black shadow-sm"
                />
              )}
            </div>
            {status === 'PENDING' && (
              <div className="flex shrink-0 items-center gap-2 pt-1">
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
                  disabled={busy[item.id]}
                  onClick={() => void decide(item, 'APPROVED')}
                >
                  Approve
                </Button>
                {onDelete && (
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={busy[item.id]}
                    onClick={() => void remove(item)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            )}
            {status !== 'PENDING' && onDelete && (
              <div className="flex shrink-0 items-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy[item.id]}
                  onClick={() => void remove(item)}
                >
                  Delete
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
