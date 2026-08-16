'use client';

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { useToast } from '@/components/ui/toast';
import {
  contentMediaUrl,
  contentThumbnailUrl,
  getContentMediaInfo,
  getPostMetricsView,
  getPublishTargetDetail,
  publishTargetNow,
  type PostMetrics,
  type PublishTargetDetail,
} from '@/lib/api-data';
import { MediaEmbed } from '@/components/media-embed';
import { absoluteTime, compactNumber, relativeTime } from '@/lib/format';
import type { Platform } from '@/lib/domain-types';
import { ApiError } from '@/lib/api';

const STATUS_TONE: Record<
  PublishTargetDetail['status'],
  'neutral' | 'indigo' | 'amber' | 'green' | 'red'
> = {
  PENDING: 'amber',
  SCHEDULED: 'indigo',
  PUBLISHING: 'amber',
  PUBLISHED: 'green',
  FAILED: 'red',
  DRAFT: 'neutral',
};

const STATUS_LABEL: Record<PublishTargetDetail['status'], string> = {
  PENDING: 'Pending review',
  SCHEDULED: 'Scheduled',
  PUBLISHING: 'Publishing',
  PUBLISHED: 'Published',
  FAILED: 'Failed',
  DRAFT: 'Draft',
};

export function PostDetailModal({
  open,
  onClose,
  publishTargetId,
  /** Optional seed so the header paints before the detail fetch returns. */
  seedTitle,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  publishTargetId: string | null;
  seedTitle?: string;
  onChanged?: () => void;
}) {
  const [detail, setDetail] = useState<PublishTargetDetail | null>(null);
  const [metrics, setMetrics] = useState<PostMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [thumbBroken, setThumbBroken] = useState(false);
  const [videoEmbedUrl, setVideoEmbedUrl] = useState<string | null>(null);
  const [thumbEmbedUrl, setThumbEmbedUrl] = useState<string | null>(null);
  const [publishingNow, setPublishingNow] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open || !publishTargetId) {
      setDetail(null);
      setMetrics(null);
      setThumbBroken(false);
      setVideoEmbedUrl(null);
      setThumbEmbedUrl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setMetricsLoading(true);
    setThumbBroken(false);
    setDetail(null);
    setMetrics(null);
    setVideoEmbedUrl(null);
    setThumbEmbedUrl(null);

    void (async () => {
      try {
        const t = await getPublishTargetDetail(publishTargetId);
        if (cancelled) return;
        setDetail(t);
        if (t.hasVideo) {
          try {
            const info = await getContentMediaInfo(t.contentItemId);
            if (!cancelled && info.mode === 'embed') setVideoEmbedUrl(info.embedUrl);
          } catch {
            /* stream fallback */
          }
        }
        if (t.hasThumbnail) {
          try {
            const info = await getContentMediaInfo(t.contentItemId, 'thumbnail');
            if (!cancelled && info.mode === 'embed') setThumbEmbedUrl(info.embedUrl);
          } catch {
            /* stream fallback */
          }
        }
      } catch {
        if (!cancelled) setDetail(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    void (async () => {
      try {
        const m = await getPostMetricsView(publishTargetId);
        if (!cancelled) setMetrics(m);
      } catch {
        if (!cancelled) setMetrics(null);
      } finally {
        if (!cancelled) setMetricsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, publishTargetId]);

  const title = detail?.title ?? seedTitle ?? 'Post details';
  const latest =
    metrics && metrics.snapshots.length > 0
      ? metrics.snapshots[metrics.snapshots.length - 1]!
      : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      title={title}
      description={
        detail
          ? `${detail.platform} · ${STATUS_LABEL[detail.status]}`
          : loading
            ? 'Loading…'
            : undefined
      }
    >
      {loading && !detail ? (
        <div className="space-y-4">
          <Skeleton className="aspect-video w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      ) : !detail ? (
        <EmptyState
          title="Could not load this post"
          hint="The publish target may have been removed, or the API is unavailable."
        />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-950">
              {detail.hasVideo ? (
                <MediaEmbed
                  key={detail.contentItemId}
                  kind="video"
                  embedUrl={videoEmbedUrl}
                  streamUrl={contentMediaUrl(detail.contentItemId)}
                  poster={
                    !videoEmbedUrl && detail.hasThumbnail && !thumbBroken
                      ? contentThumbnailUrl(detail.contentItemId)
                      : undefined
                  }
                  className="aspect-video w-full border-0 bg-black"
                />
              ) : (
                <div className="flex aspect-video items-center justify-center bg-zinc-100 text-sm text-zinc-500">
                  No final video available yet
                </div>
              )}
            </div>

            {detail.hasThumbnail && !thumbBroken && (
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">
                  Thumbnail
                </p>
                <MediaEmbed
                  kind="image"
                  embedUrl={thumbEmbedUrl}
                  streamUrl={contentThumbnailUrl(detail.contentItemId)}
                  className="max-h-40 rounded-md border border-zinc-200 object-contain"
                  title="Thumbnail"
                />
              </div>
            )}

            <section>
              <h3 className="text-sm font-semibold text-zinc-900">Description</h3>
              {detail.description ? (
                <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-zinc-600">
                  {detail.description}
                </p>
              ) : (
                <p className="mt-1 text-sm text-zinc-400">No description stored for this post.</p>
              )}
            </section>

            <section>
              <h3 className="text-sm font-semibold text-zinc-900">Tags</h3>
              {(detail.tags ?? []).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(detail.tags ?? []).map((tag) => (
                    <Badge key={tag} tone="neutral">
                      {tag.startsWith('#') ? tag : `#${tag}`}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="mt-1 text-sm text-zinc-400">No tags or hashtags.</p>
              )}
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-lg border border-zinc-200 bg-zinc-50/60 p-4">
              <div className="flex items-center gap-2">
                <PlatformIcon platform={detail.platform as Platform} size={16} />
                <Badge tone={STATUS_TONE[detail.status]}>{STATUS_LABEL[detail.status]}</Badge>
              </div>
              <dl className="mt-3 space-y-2 text-sm">
                <MetaRow
                  label="Scheduled"
                  value={
                    detail.scheduledAt
                      ? `${relativeTime(detail.scheduledAt)} · ${absoluteTime(detail.scheduledAt)}`
                      : '—'
                  }
                />
                <MetaRow
                  label="Published"
                  value={
                    detail.publishedAt
                      ? `${relativeTime(detail.publishedAt)} · ${absoluteTime(detail.publishedAt)}`
                      : '—'
                  }
                />
                <MetaRow label="Platform post ID" value={detail.platformPostId ?? '—'} />
                <MetaRow label="Schedule mode" value={detail.scheduleMode.replace(/_/g, ' ')} />
              </dl>
              {detail.lastError != null && (
                <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs text-red-700">
                  {typeof detail.lastError === 'string'
                    ? detail.lastError
                    : JSON.stringify(detail.lastError)}
                </p>
              )}
              {(detail.status === 'SCHEDULED' || detail.status === 'PENDING' || detail.status === 'FAILED') && (
                <div className="mt-3">
                  <Button
                    size="sm"
                    variant="primary"
                    disabled={publishingNow}
                    onClick={() => {
                      void (async () => {
                        setPublishingNow(true);
                        try {
                          await publishTargetNow(detail.id);
                          toast(
                            detail.status === 'PENDING'
                              ? 'Set to publish now after Review Approve'
                              : 'Publishing now',
                            'success',
                          );
                          const next = await getPublishTargetDetail(detail.id);
                          setDetail(next);
                          onChanged?.();
                        } catch (err) {
                          toast(
                            err instanceof ApiError ? err.message : 'Could not publish now',
                            'error',
                          );
                        } finally {
                          setPublishingNow(false);
                        }
                      })();
                    }}
                  >
                    {publishingNow ? 'Starting…' : 'Publish now'}
                  </Button>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Analytics</h3>
              {metricsLoading ? (
                <Skeleton className="h-28 w-full rounded-lg" />
              ) : latest ? (
                <div className="grid grid-cols-2 gap-2">
                  <StatCard label="Views" value={compactNumber(latest.views)} />
                  <StatCard label="Likes" value={compactNumber(latest.likes)} />
                  <StatCard label="Comments" value={compactNumber(latest.comments)} />
                  <StatCard label="Shares" value={compactNumber(latest.shares)} />
                  <StatCard label="Impressions" value={compactNumber(latest.impressions)} />
                  <StatCard label="Retention" value={`${latest.retentionRate.toFixed(0)}%`} />
                </div>
              ) : (
                <EmptyState
                  title="No analytics yet"
                  hint="Metrics appear after the post is published and synced from the platform."
                />
              )}
            </section>
          </div>
        </div>
      )}
    </Modal>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right text-zinc-800">{value}</dd>
    </div>
  );
}
