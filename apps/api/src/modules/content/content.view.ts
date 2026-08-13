import type { Asset, ContentItem } from '@scp/db';
import { assetHasMedia, drivePreviewEmbedUrl } from '@scp/storage';
import { toAssetView, type AssetView } from '../storage/asset.view';

/** Public view of a content item (docs/03 Domain 4). */
export interface ContentItemView {
  id: string;
  type: ContentItem['type'];
  title: string;
  status: ContentItem['status'];
  statusReason: string | null;
  createdAt: string;
  updatedAt: string;
  assets: AssetView[];
}

export function toContentItemView(
  c: ContentItem & { assets?: Asset[] },
): ContentItemView {
  return {
    id: c.id,
    type: c.type,
    title: c.title,
    status: c.status,
    statusReason: c.statusReason,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    assets: (c.assets ?? []).map(toAssetView),
  };
}

/**
 * Review-queue projection aligned to the web `domain-types.ts` ReviewItem
 * (kind/title/submittedAt/status/durationSec). `accountId` is the first attached
 * target's account, if any (manual uploads may not have targets yet).
 */
export interface ReviewItemView {
  id: string;
  accountId: string | null;
  kind: 'INGESTED_VIDEO' | 'PRODUCED_VIDEO';
  title: string;
  /** Package / publish description when available (brief or metadataOverride). */
  description: string | null;
  /** Publish tags from metadataOverride / AI metadata when available. */
  tags: string[];
  submittedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  durationSec: number | null;
  /** True when a THUMBNAIL asset is stored (local and/or Drive). */
  hasThumbnail: boolean;
  /** Drive preview embed URL for the playable video, when archived to Drive. */
  videoEmbedUrl: string | null;
  /** Drive preview embed URL for the thumbnail, when archived to Drive. */
  thumbnailEmbedUrl: string | null;
  /** Earliest pending/scheduled publish slot, if any. */
  scheduledAt: string | null;
  /** Ingested items carry their source video (for the rights-note gate, docs/04 §3). */
  sourceVideoId: string | null;
  sourceUrl: string | null;
  rightsNote: string | null;
}

/**
 * AI-pipeline projection — items that have cleared Review and are moving through
 * the AI/TTS/render chain. Exposes `currentStep.analysis` / `currentStep.script`
 * so the AI tab can surface the script for its second (human) approval gate, and
 * structured publish metadata + media flags for the Metadata-ready preview.
 */
export interface AiPipelineItemView {
  id: string;
  accountId: string | null;
  /** SocialAccount.platform for the linked account (YouTube / TikTok / Facebook). */
  platform: string | null;
  title: string;
  status: ContentItem['status'];
  statusReason: string | null;
  updatedAt: string;
  analysis: string | null;
  script: string | null;
  /** Raw JSON string of currentStep.metadata (legacy / debugging). */
  metadata: string | null;
  /** Parsed publish title from AI metadata (null until METADATA_READY). */
  publishTitle: string | null;
  publishDescription: string | null;
  publishTags: string[];
  /** True when a FINAL (or ORIGINAL fallback) video asset exists for preview. */
  hasFinalVideo: boolean;
  hasThumbnail: boolean;
  videoEmbedUrl: string | null;
  thumbnailEmbedUrl: string | null;
}

function parsePublishMetadata(raw: unknown): {
  title: string | null;
  description: string | null;
  tags: string[];
} {
  let meta: Record<string, unknown> | null = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    meta = raw as Record<string, unknown>;
  } else if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        meta = parsed as Record<string, unknown>;
      }
    } catch {
      meta = null;
    }
  }
  if (!meta) return { title: null, description: null, tags: [] };
  const title =
    typeof meta.title === 'string' && meta.title.trim() ? meta.title.trim() : null;
  const description =
    typeof meta.description === 'string' && meta.description.trim()
      ? meta.description.trim()
      : null;
  const tags = Array.isArray(meta.tags)
    ? (meta.tags as unknown[]).filter(
        (t): t is string => typeof t === 'string' && t.trim().length > 0,
      )
    : [];
  return { title, description, tags };
}

function pickEmbedUrl(
  assets: Pick<Asset, 'kind' | 'localPath' | 'driveFileId'>[],
  kinds: Asset['kind'][],
): string | null {
  for (const kind of kinds) {
    const asset = assets.find((a) => a.kind === kind && a.driveFileId);
    if (asset?.driveFileId) return drivePreviewEmbedUrl(asset.driveFileId);
  }
  return null;
}

export function toAiPipelineItemView(
  c: ContentItem & {
    assets?: Pick<Asset, 'kind' | 'localPath' | 'driveFileId'>[];
    publishTargets?: { accountId: string; account?: { platform: string } | null }[];
    idea?: { accountId?: string; account?: { platform: string } | null } | null;
    sourceVideo?: {
      watchedSource?: {
        targetAccountId: string | null;
        targetAccount?: { platform: string } | null;
      } | null;
    } | null;
  },
): AiPipelineItemView {
  const step = (c.currentStep ?? {}) as Record<string, unknown>;
  const asText = (v: unknown): string | null =>
    v == null ? null : typeof v === 'string' ? v : JSON.stringify(v);
  const publish = parsePublishMetadata(step.metadata);
  const accountId =
    c.publishTargets?.[0]?.accountId ??
    c.sourceVideo?.watchedSource?.targetAccountId ??
    c.idea?.accountId ??
    null;
  const platform =
    c.publishTargets?.[0]?.account?.platform ??
    c.sourceVideo?.watchedSource?.targetAccount?.platform ??
    c.idea?.account?.platform ??
    null;
  const assets = c.assets ?? [];
  return {
    id: c.id,
    accountId,
    platform,
    title: c.title,
    status: c.status,
    statusReason: c.statusReason,
    updatedAt: c.updatedAt.toISOString(),
    analysis: asText(step.analysis),
    script: asText(step.script),
    metadata: asText(step.metadata),
    publishTitle: publish.title,
    publishDescription: publish.description,
    publishTags: publish.tags,
    hasFinalVideo: assets.some(
      (a) => (a.kind === 'FINAL' || a.kind === 'ORIGINAL') && assetHasMedia(a),
    ),
    hasThumbnail: assets.some((a) => a.kind === 'THUMBNAIL' && assetHasMedia(a)),
    videoEmbedUrl: pickEmbedUrl(assets, ['FINAL', 'ORIGINAL']),
    thumbnailEmbedUrl: pickEmbedUrl(assets, ['THUMBNAIL']),
  };
}

function pickDescription(
  c: ContentItem & {
    publishTargets?: { metadataOverride?: unknown; scheduledAt?: Date | null }[];
    idea?: { brief?: { videoDescription: string } | null } | null;
  },
): string | null {
  for (const t of c.publishTargets ?? []) {
    const override = (t.metadataOverride ?? {}) as Record<string, unknown>;
    if (typeof override.description === 'string' && override.description.trim()) {
      return override.description.trim();
    }
  }
  const briefDesc = c.idea?.brief?.videoDescription?.trim();
  if (briefDesc) return briefDesc;
  const step = (c.currentStep ?? {}) as Record<string, unknown>;
  const meta = step.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const d = (meta as Record<string, unknown>).description;
    if (typeof d === 'string' && d.trim()) return d.trim();
  }
  return null;
}

function pickTitle(
  c: ContentItem & {
    publishTargets?: { metadataOverride?: unknown }[];
  },
): string {
  for (const t of c.publishTargets ?? []) {
    const override = (t.metadataOverride ?? {}) as Record<string, unknown>;
    if (typeof override.title === 'string' && override.title.trim()) {
      return override.title.trim();
    }
  }
  const step = (c.currentStep ?? {}) as Record<string, unknown>;
  const meta = step.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const title = (meta as Record<string, unknown>).title;
    if (typeof title === 'string' && title.trim()) return title.trim();
  }
  return c.title;
}

function pickTags(
  c: ContentItem & {
    publishTargets?: { metadataOverride?: unknown }[];
  },
): string[] {
  for (const t of c.publishTargets ?? []) {
    const override = (t.metadataOverride ?? {}) as Record<string, unknown>;
    if (Array.isArray(override.tags)) {
      const tags = override.tags.filter(
        (x): x is string => typeof x === 'string' && x.trim().length > 0,
      );
      if (tags.length > 0) return tags;
    }
  }
  const step = (c.currentStep ?? {}) as Record<string, unknown>;
  const meta = step.metadata;
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const raw = (meta as Record<string, unknown>).tags;
    if (Array.isArray(raw)) {
      return raw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
    }
  }
  return [];
}

export function toReviewItemView(
  c: ContentItem & {
    assets?: Asset[];
    publishTargets?: {
      accountId: string;
      scheduledAt?: Date | null;
      metadataOverride?: unknown;
    }[];
    idea?: { accountId?: string; brief?: { videoDescription: string } | null } | null;
    sourceVideo?: {
      id: string;
      sourceUrl: string;
      rightsNote: string | null;
      watchedSource?: { targetAccountId: string | null } | null;
    } | null;
  },
): ReviewItemView {
  const statusMap: Record<string, ReviewItemView['status']> = {
    REVIEW_PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
  };
  const duration = (c.assets ?? []).find((a) => a.durationSec != null)?.durationSec ?? null;
  const assets = c.assets ?? [];
  const hasThumbnail = assets.some((a) => a.kind === 'THUMBNAIL' && assetHasMedia(a));
  const scheduledDates = (c.publishTargets ?? [])
    .map((t) => t.scheduledAt)
    .filter((d): d is Date => d instanceof Date);
  const scheduledAt =
    scheduledDates.length > 0
      ? new Date(Math.min(...scheduledDates.map((d) => d.getTime()))).toISOString()
      : null;
  return {
    id: c.id,
    // Prefer publish-target account, then linked idea, then watched-source account.
    accountId:
      c.publishTargets?.[0]?.accountId ??
      c.idea?.accountId ??
      c.sourceVideo?.watchedSource?.targetAccountId ??
      null,
    kind:
      c.type === 'REPURPOSED' && (c.publishTargets?.length ?? 0) === 0
        ? 'INGESTED_VIDEO'
        : 'PRODUCED_VIDEO',
    title: pickTitle(c),
    description: pickDescription(c),
    tags: pickTags(c),
    submittedAt: c.createdAt.toISOString(),
    status: statusMap[c.status] ?? 'PENDING',
    durationSec: duration,
    hasThumbnail,
    videoEmbedUrl: pickEmbedUrl(assets, ['FINAL', 'ORIGINAL']),
    thumbnailEmbedUrl: pickEmbedUrl(assets, ['THUMBNAIL']),
    scheduledAt,
    sourceVideoId: c.sourceVideo?.id ?? null,
    sourceUrl: c.sourceVideo?.sourceUrl ?? null,
    rightsNote: c.sourceVideo?.rightsNote ?? null,
  };
}
