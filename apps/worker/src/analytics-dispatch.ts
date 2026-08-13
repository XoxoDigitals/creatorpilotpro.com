/**
 * Analytics dispatchers (docs/07, Phase 5). Two dispatchers:
 * - Nightly (2 AM): sync all accounts + recent posts + AI rollup + worker rollup
 * - Hot (every 6h): re-sync posts published in the last 7 days
 */
import type PgBoss from 'pg-boss';
import { QUEUE } from '@scp/shared';
import { getPrisma } from './publish-support.js';
import type { AccountSyncJob, PostSyncJob, InternalRollupJob, WorkerRollupJob, BestTimeLearnJob } from './analytics-jobs.js';

export async function dispatchNightlySync(boss: PgBoss): Promise<number> {
  const prisma = getPrisma();
  let dispatched = 0;

  const accounts = await prisma.socialAccount.findMany({
    where: { connectionStatus: 'HEALTHY', deletedAt: null, paused: false },
    select: { id: true },
    take: 1000,
  });

  for (const a of accounts) {
    const data: AccountSyncJob = { kind: 'account_sync', accountId: a.id };
    await boss.send(QUEUE.ANALYTICS, data, { singletonKey: `acct-sync-${a.id}` });
    dispatched += 1;
  }

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);

  const targets = await prisma.publishTarget.findMany({
    where: { status: 'PUBLISHED', publishedAt: { gte: thirtyDaysAgo } },
    select: { id: true },
    take: 5000,
  });

  for (const t of targets) {
    const data: PostSyncJob = { kind: 'post_sync', publishTargetId: t.id };
    await boss.send(QUEUE.ANALYTICS, data, { singletonKey: `post-sync-${t.id}` });
    dispatched += 1;
  }

  const rollup: InternalRollupJob = { kind: 'internal_rollup' };
  await boss.send(QUEUE.ANALYTICS, rollup, { singletonKey: 'internal-rollup' });
  dispatched += 1;

  const dayOfWeek = new Date().getUTCDay();
  if (dayOfWeek === 1) {
    const workerRollup: WorkerRollupJob = { kind: 'worker_rollup' };
    await boss.send(QUEUE.ANALYTICS, workerRollup, { singletonKey: 'worker-rollup' });
    dispatched += 1;

    // Best-time-to-post learner runs weekly on Mondays too.
    const learn: BestTimeLearnJob = { kind: 'best_time_learn' };
    await boss.send(QUEUE.ANALYTICS, learn, { singletonKey: 'best-time-learn' });
    dispatched += 1;
  }

  return dispatched;
}

export async function dispatchHotSync(boss: PgBoss): Promise<number> {
  const prisma = getPrisma();
  let dispatched = 0;

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 7);

  const targets = await prisma.publishTarget.findMany({
    where: { status: 'PUBLISHED', publishedAt: { gte: sevenDaysAgo } },
    select: { id: true },
    take: 2000,
  });

  for (const t of targets) {
    const data: PostSyncJob = { kind: 'post_sync', publishTargetId: t.id };
    await boss.send(QUEUE.ANALYTICS, data, { singletonKey: `post-hot-${t.id}` });
    dispatched += 1;
  }

  return dispatched;
}
