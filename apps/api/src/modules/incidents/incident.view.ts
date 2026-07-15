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
  createdAt: string;
  resolvedAt: string | null;
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
    createdAt: i.createdAt.toISOString(),
    resolvedAt: i.resolvedAt ? i.resolvedAt.toISOString() : null,
  };
}
