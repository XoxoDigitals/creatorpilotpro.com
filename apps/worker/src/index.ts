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
import { dispatchDueSources, dispatchDueCompetitors } from './watcher.js';
import { dispatchHotSync } from './analytics-dispatch.js';
import { startHealthServer } from './health.js';

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
    console.error('[worker] pg-boss error:', err);
  });

  await boss.start();
  setBoss(boss);
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
    } else if (queue === QUEUE.AI || queue === QUEUE.TTS) {
      // AI / TTS jobs face rate limits + Gemini 503 "high demand" spikes that
      // clear within minutes. Let pg-boss auto-requeue with exponential backoff
      // instead of leaving the item stuck in FAILED after a single blip.
      // TTS expire is tighter so a worker hot-reload / crash does not leave an
      // ACTIVE idea_tts singleton blocking the UI for the default ~15–60m window.
      await boss.createQueue(queue, {
        name: queue,
        retryLimit: 5,
        retryBackoff: true,
        ...(queue === QUEUE.TTS ? { expireInSeconds: 12 * 60 } : {}),
      });
    } else {
      await boss.createQueue(queue);
    }
    const batchSize = resolveConcurrency(queue);
    await boss.work(queue, { batchSize }, processors[queue]);
    console.log(`[worker] registered queue "${queue}" (batchSize=${batchSize})`);
  }

  // Recurring maintenance: refresh Google tokens near expiry every 5 minutes
  // (docs/06 §4). singletonKey via the queue prevents overlapping runs.
  await boss.schedule(QUEUE.MAINTENANCE, '*/5 * * * *');
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
          console.log(`[worker:dispatch] enqueued ${n} due publish target(s)`);
        }
      })
      .catch((err) => {
        console.error('[worker:dispatch] failed:', err);
      })
      .finally(() => {
        dispatching = false;
      });
  }, DISPATCH_INTERVAL_MS);
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
          console.log(`[worker:watcher] enqueued ${n} due source poll(s)`);
        }
      })
      .catch((err) => {
        console.error('[worker:watcher] dispatch failed:', err);
      })
      .finally(() => {
        watching = false;
      });
  }, WATCHER_DISPATCH_INTERVAL_MS);
  console.log(`[worker:watcher] source dispatcher started (every ${WATCHER_DISPATCH_INTERVAL_MS / 1000}s)`);

  // Competitor dispatcher (Phase 4, FR-D1): every minute, enqueue a poll for each
  // ACTIVE competitor channel whose check interval has elapsed.
  let pollingCompetitors = false;
  const competitorTimer = setInterval(() => {
    if (pollingCompetitors) return;
    pollingCompetitors = true;
    void dispatchDueCompetitors(boss)
      .then((n) => {
        if (n > 0) {
          console.log(`[worker:competitor] enqueued ${n} due competitor poll(s)`);
        }
      })
      .catch((err) => {
        console.error('[worker:competitor] dispatch failed:', err);
      })
      .finally(() => {
        pollingCompetitors = false;
      });
  }, WATCHER_DISPATCH_INTERVAL_MS);
  console.log(`[worker:competitor] competitor dispatcher started (every ${WATCHER_DISPATCH_INTERVAL_MS / 1000}s)`);

  // Analytics nightly cron (docs/07): sync all accounts + recent posts + rollups at 2 AM.
  await boss.schedule(QUEUE.ANALYTICS, '0 2 * * *', { kind: 'nightly_trigger' } as object);
  console.log('[worker:analytics] scheduled nightly sync cron (0 2 * * *)');

  // Analytics hot sync (every 6 hours): re-sync posts published in the last 7 days.
  const HOT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;
  let syncingHot = false;
  const hotSyncTimer = setInterval(() => {
    if (syncingHot) return;
    syncingHot = true;
    void dispatchHotSync(boss)
      .then((n) => {
        if (n > 0) {
          console.log(`[worker:analytics] hot-sync enqueued ${n} post sync(s)`);
        }
      })
      .catch((err) => {
        console.error('[worker:analytics] hot-sync dispatch failed:', err);
      })
      .finally(() => {
        syncingHot = false;
      });
  }, HOT_SYNC_INTERVAL_MS);
  console.log(`[worker:analytics] hot-sync dispatcher started (every ${HOT_SYNC_INTERVAL_MS / 3_600_000}h)`);

  // Worker health check server (docs/08 §1) for pm2/uptime monitors.
  const healthServer = startHealthServer(boss);

  // Edge Neural TTS diagnostic — clear startup signal for local Windows setup.
  try {
    const { diagnoseEdgeTts } = await import('@scp/ai-providers');
    const diag = await diagnoseEdgeTts();
    if (diag.ok) {
      console.log(
        `[worker:tts] Edge Neural TTS ready via ${diag.binary.source}: ${diag.binary.detail}${
          diag.versionHint ? ` (${diag.versionHint})` : ''
        }`,
      );
    } else {
      console.warn(
        `[worker:tts] Edge Neural TTS unavailable — ${diag.binary.detail}. Install with \`pip install edge-tts\` or set EDGE_TTS_BIN. Fallback chain: Kokoro → Gemini → OpenAI.`,
      );
    }
  } catch (err) {
    console.warn(
      `[worker:tts] Edge TTS diagnostics failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  console.log(`[worker] startup complete — ${ALL_QUEUES.length} queues registered`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} received — shutting down gracefully...`);
    clearInterval(dispatchTimer);
    clearInterval(watcherTimer);
    clearInterval(competitorTimer);
    clearInterval(hotSyncTimer);
    healthServer.close();
    try {
      await boss.stop({ graceful: true, timeout: 30_000 });
      console.log('[worker] pg-boss stopped cleanly');
      process.exit(0);
    } catch (err) {
      console.error('[worker] error during shutdown:', err);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[worker] fatal startup error:', err);
  process.exit(1);
});
