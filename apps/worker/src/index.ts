/**
 * Worker bootstrap (docs/02 §5 — pg-boss over Postgres, no Redis).
 * Creates a PgBoss instance from DATABASE_URL at RUNTIME only (nothing here runs
 * at build time), registers the 9 queues with no-op processors, and shuts down
 * gracefully on SIGINT/SIGTERM.
 */
import os from 'node:os';
import PgBoss from 'pg-boss';
import { ALL_QUEUES, QUEUE, QUEUE_CONCURRENCY, type QueueName } from '@scp/shared';
import { getDatabaseUrl } from './config.js';
import { processors, setBoss } from './processors.js';
import { PUBLISH_RETRY_LIMIT } from './publish.js';
import { dispatchDueTargets } from './dispatcher.js';
import { dispatchDueSources } from './watcher.js';

const DISPATCH_INTERVAL_MS = 60_000;
const WATCHER_DISPATCH_INTERVAL_MS = 60_000;

function resolveConcurrency(queue: QueueName): number {
  const c = QUEUE_CONCURRENCY[queue];
  if (c === 'cpu') {
    // media queue: CPU cores − 2, minimum 1 (docs/02 §5)
    return Math.max(1, os.cpus().length - 2);
  }
  return c;
}

async function main(): Promise<void> {
  const boss = new PgBoss({
    connectionString: getDatabaseUrl(),
    // pg-boss creates its own schema (pgboss) and maintenance jobs.
    schema: 'pgboss',
  });

  boss.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[worker] pg-boss error:', err);
  });

  await boss.start();
  setBoss(boss);
  // eslint-disable-next-line no-console
  console.log('[worker] pg-boss started');

  for (const queue of ALL_QUEUES) {
    // Queues must exist before work() in pg-boss v10. The publish queue carries a
    // retry policy so retryable publish errors back off automatically (docs/06 §4).
    if (queue === QUEUE.PUBLISH) {
      await boss.createQueue(queue, {
        name: queue,
        retryLimit: PUBLISH_RETRY_LIMIT,
        retryBackoff: true,
      });
    } else {
      await boss.createQueue(queue);
    }
    const batchSize = resolveConcurrency(queue);
    await boss.work(queue, { batchSize }, processors[queue]);
    // eslint-disable-next-line no-console
    console.log(`[worker] registered queue "${queue}" (batchSize=${batchSize})`);
  }

  // Recurring maintenance: refresh Google tokens near expiry every 5 minutes
  // (docs/06 §4). singletonKey via the queue prevents overlapping runs.
  await boss.schedule(QUEUE.MAINTENANCE, '*/5 * * * *');
  // eslint-disable-next-line no-console
  console.log('[worker] scheduled maintenance cron (*/5 * * * *)');

  // Scheduling dispatcher (docs/06 §3 Layer 2): every minute, enqueue publish
  // jobs for targets whose scheduledAt has arrived. Runs in-process (it must
  // SEND jobs, not just handle them) with an overlap guard.
  let dispatching = false;
  const dispatchTimer = setInterval(() => {
    if (dispatching) return;
    dispatching = true;
    void dispatchDueTargets(boss)
      .then((n) => {
        if (n > 0) {
          // eslint-disable-next-line no-console
          console.log(`[worker:dispatch] enqueued ${n} due publish target(s)`);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[worker:dispatch] failed:', err);
      })
      .finally(() => {
        dispatching = false;
      });
  }, DISPATCH_INTERVAL_MS);
  // eslint-disable-next-line no-console
  console.log(`[worker] scheduling dispatcher started (every ${DISPATCH_INTERVAL_MS / 1000}s)`);

  // Watcher dispatcher (docs/04 §1): every minute, enqueue a WATCHER job for each
  // ACTIVE source whose check interval has elapsed. Mirrors the publish dispatcher
  // (must SEND jobs) with its own overlap guard.
  let watching = false;
  const watcherTimer = setInterval(() => {
    if (watching) return;
    watching = true;
    void dispatchDueSources(boss)
      .then((n) => {
        if (n > 0) {
          // eslint-disable-next-line no-console
          console.log(`[worker:watcher] enqueued ${n} due source poll(s)`);
        }
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[worker:watcher] dispatch failed:', err);
      })
      .finally(() => {
        watching = false;
      });
  }, WATCHER_DISPATCH_INTERVAL_MS);
  // eslint-disable-next-line no-console
  console.log(`[worker:watcher] source dispatcher started (every ${WATCHER_DISPATCH_INTERVAL_MS / 1000}s)`);

  // eslint-disable-next-line no-console
  console.log(`[worker] startup complete — ${ALL_QUEUES.length} queues registered`);

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`[worker] ${signal} received — shutting down gracefully...`);
    clearInterval(dispatchTimer);
    clearInterval(watcherTimer);
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
      // eslint-disable-next-line no-console
      console.log('[worker] pg-boss stopped cleanly');
      process.exit(0);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[worker] error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal startup error:', err);
  process.exit(1);
});
