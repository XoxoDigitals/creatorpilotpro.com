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
import { isWatchJob, isDownloadJob, isMediaJob, isSubtitlesJob, isCompetitorPollJob } from './ingestion-jobs.js';
import { runSubtitles } from './subtitles-process.js';
import { runAi } from './ai-process.js';
import { runTts, runIdeaTts } from './tts-process.js';
import { runRender } from './render-process.js';
import {
  isAiJob, isTtsJob, isRenderJob,
  isIdeaGenerationJob, isBriefGenerationJob, isDramaBibleJob, isDramaEpisodeJob,
  isAbSuggestionsJob, isIdeaTtsJob, isIdeaTranscriptJob, isIdeaVisualsJob,
  isCompetitorPerformanceJob,
} from './ai-jobs.js';
import { runCompetitorPoll } from './competitor-process.js';
import {
  runIdeaGeneration, runBriefGeneration, runDramaBible, runDramaEpisode, runAbSuggestions,
  runCompetitorPerformanceAnalysis, runIdeaTranscript, runIdeaVisuals,
} from './ai-phase4.js';
import {
  isAccountSyncJob, isPostSyncJob, isInternalRollupJob, isWorkerRollupJob, isBestTimeLearnJob,
} from './analytics-jobs.js';
import {
  runAccountSync, runPostSync, runInternalRollup, runWorkerRollup, runBestTimeLearner,
} from './analytics-sync.js';
import { dispatchNightlySync } from './analytics-dispatch.js';

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

/** Maintenance queue: token refresh + (future) cleanup jobs (docs/06 §4). */
const maintenanceProcessor: Processor = async (jobs: Job[]) => {
  for (const _job of jobs) {
    try {
      const result = await refreshExpiringGoogleTokens();
      if (result.checked > 0) {
        console.log(
          `[worker:maintenance] google tokens — checked=${result.checked} refreshed=${result.refreshed} broken=${result.broken}`,
        );
      }
    } catch (err) {
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
    else if (isCompetitorPollJob(data)) await runCompetitorPoll(data.competitorChannelId, boss);
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
    else if (isSubtitlesJob(data)) await runSubtitles(data.contentItemId);
    else console.warn(`[worker:media] job ${job.id} has an unrecognized payload — skipping`);
  }
};

/** AI queue (docs/05, Phase 3.4): analyze, narration, metadata jobs. */
const aiProcessor: Processor = async (jobs: Job[]) => {
  if (!boss) throw new Error('[worker:ai] boss handle not set — call setBoss() at startup.');
  for (const job of jobs) {
    const data = job.data as unknown;
    if (isAiJob(data)) await runAi(data, boss);
    else if (isIdeaGenerationJob(data)) {
      await runIdeaGeneration(
        data.accountId,
        boss,
        data.count ?? 50,
        data.generationRunId,
        data.topicSeed,
      );
    }
    else if (isBriefGenerationJob(data)) await runBriefGeneration(data.ideaId, boss);
    else if (isIdeaTranscriptJob(data)) await runIdeaTranscript(data.ideaId, boss);
    else if (isIdeaVisualsJob(data)) await runIdeaVisuals(data.ideaId, boss);
    else if (isDramaBibleJob(data)) await runDramaBible(data.seriesId, boss);
    else if (isDramaEpisodeJob(data)) await runDramaEpisode(data.episodeId, boss);
    else if (isAbSuggestionsJob(data)) await runAbSuggestions(data.contentItemId, boss);
    else if (isCompetitorPerformanceJob(data)) {
      await runCompetitorPerformanceAnalysis(data.competitorChannelId, boss, data.force === true);
    }
    else console.warn(`[worker:ai] job ${job.id} has an unrecognized payload — skipping`);
  }
};

/** TTS queue (docs/05 §6, Phase 3.5): synthesize voiceover from approved script. */
const ttsProcessor: Processor = async (jobs: Job[]) => {
  if (!boss) throw new Error('[worker:tts] boss handle not set — call setBoss() at startup.');
  for (const job of jobs) {
    const data = job.data as unknown;
    if (isTtsJob(data)) await runTts(data.contentItemId, boss);
    else if (isIdeaTtsJob(data)) await runIdeaTts(data.ideaId, boss);
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
      console.log(`[worker:storage] received job ${job.id} (${job.name}) — no-op stub`);
    }
  }
};

/** Analytics queue (docs/07, Phase 5): account/post sync, AI rollup, worker rollup. */
const analyticsProcessor: Processor = async (jobs: Job[]) => {
  if (!boss) throw new Error('[worker:analytics] boss handle not set — call setBoss() at startup.');
  for (const job of jobs) {
    const data = job.data as unknown;
    if (isAccountSyncJob(data)) await runAccountSync(data.accountId, boss);
    else if (isPostSyncJob(data)) await runPostSync(data.publishTargetId, boss);
    else if (isInternalRollupJob(data)) await runInternalRollup(boss);
    else if (isWorkerRollupJob(data)) await runWorkerRollup(boss);
    else if (isBestTimeLearnJob(data)) await runBestTimeLearner(boss);
    else if (typeof data === 'object' && data !== null && (data as { kind?: unknown }).kind === 'nightly_trigger') {
      const n = await dispatchNightlySync(boss);
      console.log(`[worker:analytics] nightly trigger dispatched ${n} sync job(s)`);
    } else console.warn(`[worker:analytics] job ${job.id} has an unrecognized payload — skipping`);
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
  [QUEUE.ANALYTICS]: analyticsProcessor,
  [QUEUE.STORAGE]: storageProcessor,
  [QUEUE.MAINTENANCE]: maintenanceProcessor,
};
