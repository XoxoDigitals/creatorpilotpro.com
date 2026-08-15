/**
 * Download drip dispatcher — pace SourceVideo downloads by channel posts/day.
 *
 * Bulk import / watcher leave rows as PENDING; this tick enqueues DOWNLOAD jobs
 * so we do not pull 40 clips at once. Inventory target ≈ 2 days of posts; when
 * under that buffer we release about 1 day of downloads.
 */
import type PgBoss from 'pg-boss';
import {
  QUEUE,
  DOWNLOAD_READY_BUFFER_DAYS,
  DOWNLOAD_DRIP_DAYS,
  resolvePostsPerDay,
  downloadSlotsAvailable,
} from '@scp/shared';
import { getPrisma } from './publish-support.js';
import type { DownloadJob } from './ingestion-jobs.js';

export {
  DOWNLOAD_READY_BUFFER_DAYS,
  DOWNLOAD_DRIP_DAYS,
  resolvePostsPerDay,
  downloadSlotsAvailable,
};

export async function countAccountDownloadInventory(accountId: string): Promise<{
  ready: number;
  inFlight: number;
}> {
  const prisma = getPrisma();
  const sourceScope = {
    watchedSource: { targetAccountId: accountId, deletedAt: null },
  } as const;

  const [inFlight, doneWaiting, inPipeline] = await Promise.all([
    prisma.sourceVideo.count({
      where: { downloadStatus: 'DOWNLOADING', ...sourceScope },
    }),
    prisma.sourceVideo.count({
      where: {
        downloadStatus: 'DONE',
        ...sourceScope,
        contentItems: { none: { deletedAt: null } },
      },
    }),
    prisma.contentItem.count({
      where: {
        deletedAt: null,
        status: { notIn: ['PUBLISHED', 'REJECTED'] },
        sourceVideo: sourceScope,
      },
    }),
  ]);

  return { ready: doneWaiting + inPipeline, inFlight };
}

/**
 * Enqueue DOWNLOAD jobs for PENDING source videos, paced per target account.
 * Returns total jobs enqueued this tick.
 */
export async function dispatchPendingDownloads(boss: PgBoss): Promise<number> {
  const prisma = getPrisma();

  const pending = await prisma.sourceVideo.findMany({
    where: {
      downloadStatus: 'PENDING',
      watchedSource: { deletedAt: null },
    },
    select: {
      id: true,
      createdAt: true,
      watchedSource: { select: { targetAccountId: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: 500,
  });
  if (pending.length === 0) return 0;

  const unboundIds: string[] = [];
  const byAccount = new Map<string, string[]>();
  for (const v of pending) {
    const accountId = v.watchedSource?.targetAccountId ?? null;
    if (!accountId) {
      unboundIds.push(v.id);
      continue;
    }
    const list = byAccount.get(accountId) ?? [];
    list.push(v.id);
    byAccount.set(accountId, list);
  }

  let enqueued = 0;

  // No channel → no posts/day; download immediately (oldest first, small cap).
  for (const id of unboundIds.slice(0, 5)) {
    const job: DownloadJob = { kind: 'download', sourceVideoId: id };
    const jobId = await boss.send(QUEUE.DOWNLOAD, job, { singletonKey: id });
    if (jobId) enqueued += 1;
  }

  for (const [accountId, videoIds] of byAccount) {
    const profile = await prisma.channelProfile.findUnique({
      where: { accountId },
      select: { schedulingPrefs: true },
    });
    const postsPerDay = resolvePostsPerDay(profile?.schedulingPrefs);
    const { ready, inFlight } = await countAccountDownloadInventory(accountId);
    const toTake = downloadSlotsAvailable({ postsPerDay, ready, inFlight });
    if (toTake <= 0) continue;

    const batch = videoIds.slice(0, toTake);
    for (const id of batch) {
      const job: DownloadJob = { kind: 'download', sourceVideoId: id };
      const jobId = await boss.send(QUEUE.DOWNLOAD, job, { singletonKey: id });
      if (jobId) enqueued += 1;
    }
  }

  return enqueued;
}
