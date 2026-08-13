/**
 * Analytics sync job contracts (docs/07, Phase 5). Four job types ride the
 * ANALYTICS queue: account metrics sync, post metrics sync, internal AI usage
 * rollup, and weekly worker productivity rollup.
 */

export interface AccountSyncJob {
  kind: 'account_sync';
  accountId: string;
}

export interface PostSyncJob {
  kind: 'post_sync';
  publishTargetId: string;
}

export interface InternalRollupJob {
  kind: 'internal_rollup';
}

export interface WorkerRollupJob {
  kind: 'worker_rollup';
}

/** Phase 7 #11: mine post metrics to compute per-account best posting hour. */
export interface BestTimeLearnJob {
  kind: 'best_time_learn';
}

export type AnalyticsJob = AccountSyncJob | PostSyncJob | InternalRollupJob | WorkerRollupJob | BestTimeLearnJob;

export function isAccountSyncJob(data: unknown): data is AccountSyncJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'account_sync' &&
    typeof (data as AccountSyncJob).accountId === 'string'
  );
}

export function isPostSyncJob(data: unknown): data is PostSyncJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'post_sync' &&
    typeof (data as PostSyncJob).publishTargetId === 'string'
  );
}

export function isInternalRollupJob(data: unknown): data is InternalRollupJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'internal_rollup'
  );
}

export function isWorkerRollupJob(data: unknown): data is WorkerRollupJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'worker_rollup'
  );
}

export function isBestTimeLearnJob(data: unknown): data is BestTimeLearnJob {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { kind?: unknown }).kind === 'best_time_learn'
  );
}
