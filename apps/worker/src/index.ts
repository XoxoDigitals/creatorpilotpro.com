/**
 * Worker bootstrap (docs/02 §5 — pg-boss over Postgres, no Redis).
 * Creates a PgBoss instance from DATABASE_URL at RUNTIME only (nothing here runs
 * at build time), registers the 9 queues with no-op processors, and shuts down
 * gracefully on SIGINT/SIGTERM.
 */
import os from 'node:os';
import PgBoss from 'pg-boss';
import { ALL_QUEUES, QUEUE_CONCURRENCY, type QueueName } from '@scp/shared';
import { getDatabaseUrl } from './config.js';
import { processors } from './processors.js';

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
  // eslint-disable-next-line no-console
  console.log('[worker] pg-boss started');

  for (const queue of ALL_QUEUES) {
    // Queues must exist before work() in pg-boss v10.
    await boss.createQueue(queue);
    const batchSize = resolveConcurrency(queue);
    await boss.work(queue, { batchSize }, processors[queue]);
    // eslint-disable-next-line no-console
    console.log(`[worker] registered queue "${queue}" (batchSize=${batchSize})`);
  }

  // eslint-disable-next-line no-console
  console.log(`[worker] startup complete — ${ALL_QUEUES.length} queues registered`);

  const shutdown = async (signal: string): Promise<void> => {
    // eslint-disable-next-line no-console
    console.log(`[worker] ${signal} received — shutting down gracefully...`);
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
