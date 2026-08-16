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
  removePublishTarget,
  retryPublishTarget,
  updatePublishTargetSchedule,
  type PostMetrics,
  type PublishTargetDetail,
} from '@/lib/api-data';
import { MediaEmbed } from '@/components/media-embed';
import { absoluteTime, compactNumber, relativeTime } from '@/lib/format';
import { analyticsConfigFor, type PostDrawerKpiId } from '@/lib/analytics-metrics';
import type { Platform } from '@/lib/domain-types';
import { ApiError } from '@/lib/api';

function postModalMetricCard(
  id: PostDrawerKpiId,
  latest: NonNullable<PostMetrics['snapshots'][number]>,
  uniqueLabel: string,
): { label: string; value: string } | null {
  switch (id) {
    case 'views':
      return { label: 'Views', value: compactNumber(latest.views) };
    case 'uniqueViewers':
      return { label: uniqueLabel, value: compactNumber(latest.uniqueViewers) };
    case 'impressions':
      return { label: 'Impressions', value: compactNumber(latest.impressions) };
    case 'ctr':
      return { label: 'CTR', value: `${latest.ctr.toFixed(1)}%` };
    case 'watchTime':
      return { label: 'Watch time', value: `${compactNumber(latest.watchTimeMin)} min` };
    case 'avgViewDuration':
      return { label: 'Avg view duration', value: `${latest.averageViewDurationSec}s` };
    case 'retention':
      return { label: 'Retention', value: `${latest.retentionRate.toFixed(0)}%` };
    case 'likes':
      return { label: 'Likes', value: compactNumber(latest.likes) };
    case 'comments':
      return { label: 'Comments', value: compactNumber(latest.comments) };
    case 'shares':
      return { label: 'Shares', value: compactNumber(latest.shares) };
    case 'engagement':
      return {
        label: 'Engagement',
        value: compactNumber(latest.likes + latest.comments + latest.shares + latest.saves),
      };
    default:
      return null;
  }
}

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

/** Format an ISO instant for `<input type="datetime-local">` in local browser time. */
function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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
  const [retrying, setRetrying] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState('');
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [alsoDeletePlatform, setAlsoDeletePlatform] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!open || !publishTargetId) {
      setDetail(null);
      setMetrics(null);
      setThumbBroken(false);
      setVideoEmbedUrl(null);
      setThumbEmbedUrl(null);
      setScheduleDraft('');
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
    setScheduleDraft('');

    void (async () => {
      try {
        const t = await getPublishTargetDetail(publishTargetId);
        if (cancelled) return;
        setDetail(t);
        setScheduleDraft(toDatetimeLocalValue(t.scheduledAt));
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

  const canEditSchedule =
    detail != null &&
    (detail.status === 'SCHEDULED' ||
      detail.status === 'PENDING' ||
      detail.status === 'DRAFT' ||
      detail.status === 'FAILED');
  const canPublishNow =
    detail != null &&
    (detail.status === 'SCHEDULED' ||
      detail.status === 'PENDING' ||
      detail.status === 'FAILED' ||
      detail.status === 'DRAFT');
  const canRetry = detail != null && (detail.status === 'DRAFT' || detail.status === 'FAILED');

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="full"
      title={title}
      description={
        detail
          ? `${detail.accountName?.trim() || detail.platform} · ${STATUS_LABEL[detail.status]}`
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
                <span className="min-w-0 truncate text-sm font-medium text-zinc-900">
                  {detail.accountName?.trim() || 'Connected account'}
                </span>
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

              {canEditSchedule && (
                <div className="mt-3 space-y-2">
                  <label className="block text-xs font-medium text-zinc-600" htmlFor="post-schedule-at">
                    Change schedule time
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      id="post-schedule-at"
                      type="datetime-local"
                      value={scheduleDraft}
                      onChange={(e) => setScheduleDraft(e.target.value)}
                      className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900"
                    />
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={savingSchedule || !scheduleDraft}
                      onClick={() => {
                        void (async () => {
                          setSavingSchedule(true);
                          try {
                            const iso = new Date(scheduleDraft).toISOString();
                            await updatePublishTargetSchedule(detail.id, iso);
                            toast('Schedule updated', 'success');
                            const next = await getPublishTargetDetail(detail.id);
                            setDetail(next);
                            setScheduleDraft(toDatetimeLocalValue(next.scheduledAt));
                            onChanged?.();
                          } catch (err) {
                            toast(
                              err instanceof ApiError ? err.message : 'Could not update schedule',
                              'error',
                            );
                          } finally {
                            setSavingSchedule(false);
                          }
                        })();
                      }}
                    >
                      {savingSchedule ? 'Saving…' : 'Save time'}
                    </Button>
                  </div>
                </div>
              )}

              {(canPublishNow || canRetry) && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {canRetry && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={retrying || publishingNow || deleting}
                      onClick={() => {
                        void (async () => {
                          setRetrying(true);
                          try {
                            await retryPublishTarget(detail.id);
                            toast('Retry queued', 'success');
                            const next = await getPublishTargetDetail(detail.id);
                            setDetail(next);
                            setScheduleDraft(toDatetimeLocalValue(next.scheduledAt));
                            onChanged?.();
                          } catch (err) {
                            toast(
                              err instanceof ApiError ? err.message : 'Could not retry publish',
                              'error',
                            );
                          } finally {
                            setRetrying(false);
                          }
                        })();
                      }}
                    >
                      {retrying ? 'Retrying…' : 'Retry'}
                    </Button>
                  )}
                  {canPublishNow && (
                    <Button
                      size="sm"
                      variant="primary"
                      disabled={publishingNow || retrying || deleting}
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
                            setScheduleDraft(toDatetimeLocalValue(next.scheduledAt));
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
                  )}
                </div>
              )}

              {detail.status !== 'PUBLISHING' && (
                <div className="mt-4 space-y-2 border-t border-zinc-200 pt-3">
                  {detail.status === 'PUBLISHED' && detail.platformPostId && detail.platform === 'FACEBOOK' && (
                    <label className="flex items-center gap-2 text-xs text-zinc-600">
                      <input
                        type="checkbox"
                        checked={alsoDeletePlatform}
                        onChange={(e) => setAlsoDeletePlatform(e.target.checked)}
                      />
                      Also delete from Facebook
                    </label>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={deleting}
                    onClick={() => {
                      const fromFb =
                        alsoDeletePlatform &&
                        detail.status === 'PUBLISHED' &&
                        !!detail.platformPostId &&
                        detail.platform === 'FACEBOOK';
                      const ok = window.confirm(
                        fromFb
                          ? 'Delete this video from CreatorPilot and from Facebook?'
                          : 'Delete this video from CreatorPilot? This cannot be undone.',
                      );
                      if (!ok) return;
                      void (async () => {
                        setDeleting(true);
                        try {
                          await removePublishTarget(detail.id, {
                            deleteFromSystem: true,
                            deleteFromPlatform: fromFb,
                          });
                          toast(
                            fromFb ? 'Deleted from CreatorPilot and Facebook' : 'Deleted from CreatorPilot',
                            'success',
                          );
                          onChanged?.();
                          onClose();
                        } catch (err) {
                          toast(
                            err instanceof ApiError ? err.message : 'Could not delete video',
                            'error',
                          );
                        } finally {
                          setDeleting(false);
                        }
                      })();
                    }}
                  >
                    {deleting ? 'Deleting…' : 'Delete video'}
                  </Button>
                </div>
              )}
            </section>

            <section>
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">Analytics</h3>
              {metricsLoading ? (
                <Skeleton className="h-28 w-full rounded-lg" />
              ) : latest ? (
                (() => {
                  const cfg = analyticsConfigFor(detail.platform);
                  const cards = cfg.postDrawerKpis
                    .map((id) => postModalMetricCard(id, latest, cfg.uniqueViewersLabel))
                    .filter((c): c is { label: string; value: string } => c != null);
                  return (
                    <div className="grid grid-cols-2 gap-2">
                      {cards.map((card) => (
                        <StatCard key={card.label} label={card.label} value={card.value} />
                      ))}
                    </div>
                  );
                })()
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
