import type { Asset, ContentItem } from '@scp/db';
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
  submittedAt: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  durationSec: number | null;
}

export function toReviewItemView(
  c: ContentItem & { assets?: Asset[]; publishTargets?: { accountId: string }[] },
): ReviewItemView {
  const statusMap: Record<string, ReviewItemView['status']> = {
    REVIEW_PENDING: 'PENDING',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
  };
  const duration = (c.assets ?? []).find((a) => a.durationSec != null)?.durationSec ?? null;
  return {
    id: c.id,
    accountId: c.publishTargets?.[0]?.accountId ?? null,
    kind: c.type === 'REPURPOSED' ? 'INGESTED_VIDEO' : 'PRODUCED_VIDEO',
    title: c.title,
    submittedAt: c.createdAt.toISOString(),
    status: statusMap[c.status] ?? 'PENDING',
    durationSec: duration,
  };
}
