import type { Job } from 'pg-boss';
import { QUEUE, type QueueName } from '@scp/shared';

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
  [QUEUE.MAINTENANCE]: noop(QUEUE.MAINTENANCE),
};
