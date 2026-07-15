import type { PublishTarget, SocialAccount } from '@scp/db';

/**
 * Public view of a publish target (docs/03 Domain 4). Aligns to the web
 * `domain-types.ts` Post contract (the calendar/schedule read side).
 */
export interface PublishTargetView {
  id: string;
  contentItemId: string;
  accountId: string;
  platform: SocialAccount['platform'];
  title: string;
  status: PublishTarget['status'];
  scheduleMode: PublishTarget['scheduleMode'];
  scheduledAt: string | null;
  publishedAt: string | null;
  platformPostId: string | null;
  lastError: unknown;
  createdAt: string;
}

export function toPublishTargetView(
  t: PublishTarget & {
    account?: Pick<SocialAccount, 'platform'> | null;
    contentItem?: { title: string } | null;
  },
): PublishTargetView {
  return {
    id: t.id,
    contentItemId: t.contentItemId,
    accountId: t.accountId,
    platform: t.account?.platform ?? 'YOUTUBE',
    title: t.contentItem?.title ?? '',
    status: t.status,
    scheduleMode: t.scheduleMode,
    scheduledAt: t.scheduledAt ? t.scheduledAt.toISOString() : null,
    publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
    platformPostId: t.platformPostId,
    lastError: t.lastError ?? null,
    createdAt: t.createdAt.toISOString(),
  };
}
