import type { Incident, SocialAccount } from '@scp/db';

/** Public view of an incident (docs/03 Domain 7). Maps to the web Incident contract. */
export interface IncidentView {
  id: string;
  kind: Incident['kind'];
  severity: Incident['severity'];
  status: Incident['status'];
  accountId: string | null;
  accountName: string | null;
  contentItemId: string | null;
  publishTargetId: string | null;
  title: string;
  detail: unknown;
  /** True when POST /incidents/:id/retry can re-enqueue related work. */
  retryable: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

type Detail = Record<string, unknown>;

function asDetail(raw: unknown): Detail {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Detail) : {};
}

/** Whether the incident carries enough context to re-queue related work. */
export function isIncidentRetryable(
  i: Pick<Incident, 'title' | 'detail' | 'publishTargetId' | 'contentItemId' | 'accountId'>,
): boolean {
  if (i.publishTargetId) return true;
  if (i.contentItemId) return true;

  const detail = asDetail(i.detail);
  if (typeof detail.ideaId === 'string' && detail.ideaId.length > 0) return true;
  if (typeof detail.watchedSourceId === 'string' && detail.watchedSourceId.length > 0) return true;
  if (typeof detail.seriesId === 'string' && detail.seriesId.length > 0) return true;
  if (typeof detail.episodeId === 'string' && detail.episodeId.length > 0) return true;

  const accountId =
    i.accountId ??
    (typeof detail.accountId === 'string' && detail.accountId.length > 0
      ? detail.accountId
      : undefined);
  if (accountId && /idea generation/i.test(i.title)) return true;

  return false;
}

export function toIncidentView(
  i: Incident & { account?: Pick<SocialAccount, 'name'> | null },
): IncidentView {
  return {
    id: i.id,
    kind: i.kind,
    severity: i.severity,
    status: i.status,
    accountId: i.accountId,
    accountName: i.account?.name ?? null,
    contentItemId: i.contentItemId,
    publishTargetId: i.publishTargetId,
    title: i.title,
    detail: i.detail,
    retryable: isIncidentRetryable(i),
    createdAt: i.createdAt.toISOString(),
    resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
  };
}
