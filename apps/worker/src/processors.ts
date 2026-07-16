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
import { runAi } from './ai-process.js';
import { runTts } from './tts-process.js';
import { runRender } from './render-process.js';
import { isAiJob, isTtsJob, isRenderJob } from './ai-jobs.js';

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

/** AI queue (docs/05, Phase 3.4): analyze, narration, metadata jobs. */
const aiProcessor: Processor = async (jobs: Job[]) => {
  if (!boss) throw new Error('[worker:ai] boss handle not set — call setBoss() at startup.');
  for (const job of jobs) {
    const data = job.data as unknown;
    if (isAiJob(data)) await runAi(data, boss);
    else console.warn(`[worker:ai] job ${job.id} has an unrecognized payload — skipping`);
  }
};

/** TTS queue (docs/05 §6, Phase 3.5): synthesize voiceover from approved script. */
const ttsProcessor: Processor = async (jobs: Job[]) => {
  if (!boss) throw new Error('[worker:tts] boss handle not set — call setBoss() at startup.');
  for (const job of jobs) {
    const data = job.data as unknown;
    if (isTtsJob(data)) await runTts(data.contentItemId, boss);
    else console.warn(`[worker:tts] job ${job.id} has an unrecognized payload — skipping`);
  }
};

/** Storage queue: render jobs ride here (Phase 3.6). */
const storageProcessor: Processor = async (jobs: Job[]) => {
  if (!boss) throw new Error('[worker:storage] boss handle not set — call setBoss() at startup.');
  for (const job of jobs) {
    const data = job.data as unknown;
    if (isRenderJob(data)) await runRender(data.contentItemId, boss);
    else {
      // eslint-disable-next-line no-console
      console.log(`[worker:storage] received job ${job.id} (${job.name}) — no-op stub`);
    }
  }
};

/**
 * Processor registry (docs/02 §5). Full pipeline: WATCHER→DOWNLOAD→MEDIA
 * (ingestion), AI (analyze→narration→metadata), TTS (voiceover synth),
 * STORAGE (render/merge), PUBLISH (publish/verify).
 */
export const processors: Record<QueueName, Processor> = {
  [QUEUE.WATCHER]: watcherProcessor,
  [QUEUE.DOWNLOAD]: downloadProcessor,
  [QUEUE.MEDIA]: mediaProcessor,
  [QUEUE.AI]: aiProcessor,
  [QUEUE.TTS]: ttsProcessor,
  [QUEUE.PUBLISH]: publishProcessor,
  [QUEUE.ANALYTICS]: noop(QUEUE.ANALYTICS),
  [QUEUE.STORAGE]: storageProcessor,
  [QUEUE.MAINTENANCE]: maintenanceProcessor,
};
