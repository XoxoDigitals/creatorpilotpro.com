import type { Job } from 'pg-boss';
import { QUEUE, type QueueName } from '@scp/shared';
import { refreshExpiringGoogleTokens } from './maintenance.js';

/** pg-boss batch handler shape: receives an array of jobs per fetch. */
export type Processor = (jobs: Job[]) => Promise<void>;

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
 * Processor registry — one no-op per queue (docs/02 §5).
 * Real processors will live under src/processors/{ingest,media,ai,publish,analytics,maintenance}.
 */
export const processors: Record<QueueName, Processor> = {
  [QUEUE.WATCHER]: noop(QUEUE.WATCHER),
  [QUEUE.DOWNLOAD]: noop(QUEUE.DOWNLOAD),
  [QUEUE.MEDIA]: noop(QUEUE.MEDIA),
  [QUEUE.AI]: noop(QUEUE.AI),
  [QUEUE.TTS]: noop(QUEUE.TTS),
  [QUEUE.PUBLISH]: noop(QUEUE.PUBLISH),
  [QUEUE.ANALYTICS]: noop(QUEUE.ANALYTICS),
  [QUEUE.STORAGE]: noop(QUEUE.STORAGE),
  [QUEUE.MAINTENANCE]: maintenanceProcessor,
};
