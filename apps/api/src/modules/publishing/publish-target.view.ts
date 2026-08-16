import type { Asset, PublishTarget, SocialAccount } from '@scp/db';
import { assetHasMedia } from '@scp/storage';

/**
 * Public view of a publish target (docs/03 Domain 4). Aligns to the web
 * `domain-types.ts` Post contract (the calendar/schedule read side).
 */
export interface PublishTargetView {
  id: string;
  contentItemId: string;
  accountId: string;
  /** Connected page / channel display name. */
  accountName: string | null;
  platform: SocialAccount['platform'];
  title: string;
  /** Resolved caption/description (override → content metadata). */
  description: string | null;
  /** Hashtags / tags (override → content metadata). */
  tags: string[];
  status: PublishTarget['status'];
  scheduleMode: PublishTarget['scheduleMode'];
  scheduledAt: string | null;
  publishedAt: string | null;
  platformPostId: string | null;
  lastError: unknown;
  /** Latest synced view count when available. */
  views: number | null;
  /** True when a FINAL or ORIGINAL video asset exists (local and/or Drive). */
  hasVideo: boolean;
  /** True when a THUMBNAIL asset exists (local and/or Drive). */
  hasThumbnail: boolean;
  createdAt: string;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function asStringList(v: unknown): string[] {
  if (typeof v === 'string' && v.trim()) {
    // Single hashtag blob: "#a #b, c"
    return v
      .split(/[\s,]+/)
      .map((s) => s.replace(/^#/, '').trim())
      .filter((s) => s.length > 0);
  }
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === 'string' ? x.trim() : ''))
    .filter((s) => s.length > 0);
}

/** Parse `currentStep.metadata` whether stored as object or JSON string. */
export function parseStepMetadata(currentStep: unknown): Record<string, unknown> {
  const step = asRecord(currentStep);
  const raw = step.metadata;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* ignore malformed */
    }
  }
  return {};
}

function firstNonEmptyString(...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

/**
 * Resolve publish copy at read time:
 *   override (real) → AI currentStep.metadata → content.title
 * An override title that merely echoes content.title is treated as a
 * pre-metadata seed so later AI titles still win after refresh.
 */
export function resolveTargetCopy(
  metadataOverride: unknown,
  currentStep: unknown,
  contentTitle: string,
): { title: string; description: string | null; tags: string[] } {
  const override =
    typeof metadataOverride === 'string' && metadataOverride.trim().startsWith('{')
      ? (() => {
          try {
            const parsed = JSON.parse(metadataOverride) as unknown;
            return asRecord(parsed);
          } catch {
            return {};
          }
        })()
      : asRecord(metadataOverride);
  const meta = parseStepMetadata(currentStep);

  const overrideTitle = firstNonEmptyString(override.title);
  const metaTitle = firstNonEmptyString(meta.title, meta.videoTitle, meta.publishTitle);
  const title =
    (overrideTitle && overrideTitle !== contentTitle ? overrideTitle : '') ||
    metaTitle ||
    overrideTitle ||
    contentTitle;

  const overrideDescription = firstNonEmptyString(override.description, override.caption);
  const metaDescription = firstNonEmptyString(
    meta.description,
    meta.videoDescription,
    meta.publishDescription,
    meta.caption,
  );
  const description = overrideDescription || metaDescription || null;

  const overrideTags = asStringList(override.tags).length
    ? asStringList(override.tags)
    : asStringList(override.hashtags);
  const metaTags = asStringList(meta.tags).length
    ? asStringList(meta.tags)
    : asStringList(meta.hashtags).length
      ? asStringList(meta.hashtags)
      : asStringList(meta.keywords).length
        ? asStringList(meta.keywords)
        : asStringList(meta.publishTags);
  const tags = overrideTags.length > 0 ? overrideTags : metaTags;

  return { title, description, tags };
}

export function toPublishTargetView(
  t: PublishTarget & {
    account?: Pick<SocialAccount, 'platform' | 'name'> | null;
    contentItem?: {
      title: string;
      currentStep?: unknown;
      assets?: Pick<Asset, 'kind' | 'localPath' | 'driveFileId'>[];
    } | null;
    metricSnapshots?: Array<{ views: number }>;
  },
): PublishTargetView {
  const assets = t.contentItem?.assets ?? [];
  const copy = resolveTargetCopy(
    t.metadataOverride,
    t.contentItem?.currentStep,
    t.contentItem?.title ?? '',
  );
  const latestViews = t.metricSnapshots?.[0]?.views;
  return {
    id: t.id,
    contentItemId: t.contentItemId,
    accountId: t.accountId,
    accountName: t.account?.name?.trim() || null,
    platform: t.account?.platform ?? 'YOUTUBE',
    title: copy.title,
    description: copy.description,
    tags: copy.tags,
    status: t.status,
    scheduleMode: t.scheduleMode,
    scheduledAt: t.scheduledAt ? t.scheduledAt.toISOString() : null,
    publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
    platformPostId: t.platformPostId,
    lastError: t.lastError ?? null,
    views: typeof latestViews === 'number' ? latestViews : null,
    hasVideo: assets.some(
      (a) => (a.kind === 'FINAL' || a.kind === 'ORIGINAL') && assetHasMedia(a),
    ),
    hasThumbnail: assets.some((a) => a.kind === 'THUMBNAIL' && assetHasMedia(a)),
    createdAt: t.createdAt.toISOString(),
  };
}
