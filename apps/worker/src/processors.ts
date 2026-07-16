import type PgBoss from 'pg-boss';
import type { Job } from 'pg-boss';
import { QUEUE, type QueueName } from '@scp/shared';
import { refreshExpiringGoogleTokens } from './maintenance.js';
import { runPublish } from './publish.js';
import { runVerify } from './verify.js';
import { isPublishJob, isVerifyJob } from './publish-jobs.js';
import { runWatch } from './watcher.js';
import { runDownload } from './download.js';
import { runMedia } from './media-process.js';
import { isWatchJob, isDownloadJob, isMediaJob } from './ingestion-jobs.js';

/** pg-boss batch handler shape: receives an array of jobs per fetch. */
export type Processor = (jobs: Job[]) => Promise<void>;

/**
 * The PgBoss instance, set once at startup (index.ts) before work() is called.
 * The publish processor needs it to enqueue follow-up verify jobs.
 */
let boss: PgBoss | undefined;
export function setBoss(instance: PgBoss): void {
  boss = instance;
}

/** Build a no-op processor that just logs receipt. */
function noop(queue: QueueName): Processor {
  return async (jobs: Job[]) => {
    for (const job of jobs) {
      // eslint-disable-next-line no-console
      console.log(`[worker:${queue}] received job ${job.id} (${job.name}) — no-op stub`);
      // TODO(phase 1+): implement real pipeline steps per docs/02 §5 & docs/04.
    }
  };
}

/** Maintenance queue: token refresh + (future) cleanup jobs (docs/06 §4). */
const maintenanceProcessor: Processor = async (jobs: Job[]) => {
  for (const _job of jobs) {
    try {
      const result = await refreshExpiringGoogleTokens();
      if (result.checked > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[worker:maintenance] google tokens — checked=${result.checked} refreshed=${result.refreshed} broken=${result.broken}`,
        );
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[worker:maintenance] token refresh failed:', err);
    }
  }
};

/**
 * Publish queue: the discriminated publish/verify jobs (docs/06 §4). Each job is
 * handled independently so one failure doesn't sink the batch; a retryable error
 * re-throws for that job only (pg-boss retries per the queue's retry policy).
 */
const publishProcessor: Processor = async (jobs: Job[]) => {
  if (!boss) throw new Error('[worker:publish] boss handle not set — call setBoss() at startup.');
  for (const job of jobs) {
    const data = job.data as unknown;
    if (isPublishJob(data)) {
      const retryCount = (job as { retryCount?: number }).retryCount ?? 0;
      await runPublish(data.publishTargetId, boss, retryCount);
    } else if (isVerifyJob(data)) {
      await runVerify(data);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`[worker:publish] job ${job.id} has an unrecognized payload — skipping`);
    }
  }
};

/**
 * Ingestion queues (docs/04 §1–3): WATCHER → DOWNLOAD → MEDIA. Each carries its
 * own single job kind; every job is handled independently so one failure doesn't
 * sink the batch. WATCHER/DOWNLOAD enqueue the next stage, so they need `boss`.
 */
const watcherProcessor: Processor = async (jobs: Job[]) => {
  if (!boss) throw new Error('[worker:watcher] boss handle not set — call setBoss() at startup.');
  for (const job of jobs) {
    const data = job.data as unknown;
    if (isWatchJob(data)) await runWatch(data.watchedSourceId, boss);
    else console.warn(`[worker:watcher] job ${job.id} has an unrecognized payload — skipping`);
  }
};

const downloadProcessor: Processor = async (jobs: Job[]) => {
  if (!boss) throw new Error('[worker:download] boss handle not set — call setBoss() at startup.');
  for (const job of jobs) {
    const data = job.data as unknown;
    if (isDownloadJob(data)) await runDownload(data.sourceVideoId, boss);
    else console.warn(`[worker:download] job ${job.id} has an unrecognized payload — skipping`);
  }
};

const mediaProcessor: Processor = async (jobs: Job[]) => {
  if (!boss) throw new Error('[worker:media] boss handle not set — call setBoss() at startup.');
  for (const job of jobs) {
    const data = job.data as unknown;
    if (isMediaJob(data)) await runMedia(data.sourceVideoId, boss);
    else console.warn(`[worker:media] job ${job.id} has an unrecognized payload — skipping`);
  }
};

/**
 * Processor registry (docs/02 §5). PUBLISH runs the publish/verify engine and
 * WATCHER/DOWNLOAD/MEDIA run the ingestion pipeline; the remaining pipelines are
 * no-op stubs until their phases land.
 */
export const processors: Record<QueueName, Processor> = {
  [QUEUE.WATCHER]: watcherProcessor,
  [QUEUE.DOWNLOAD]: downloadProcessor,
  [QUEUE.MEDIA]: mediaProcessor,
  [QUEUE.AI]: noop(QUEUE.AI),
  [QUEUE.TTS]: noop(QUEUE.TTS),
  [QUEUE.PUBLISH]: publishProcessor,
  [QUEUE.ANALYTICS]: noop(QUEUE.ANALYTICS),
  [QUEUE.STORAGE]: noop(QUEUE.STORAGE),
  [QUEUE.MAINTENANCE]: maintenanceProcessor,
};
