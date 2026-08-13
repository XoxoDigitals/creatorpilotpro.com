/**
 * Worker health check (docs/08 §1). Tiny http server exposing:
 *   GET /health  → 200 { ok, db, queues } | 503 on failure
 * pm2/Caddy/uptime monitors poll this; if it 503s or times out, the process
 * is unhealthy and should be restarted.
 */
import http from 'node:http';
import type PgBoss from 'pg-boss';
import { getPrisma } from './publish-support.js';
import { ALL_QUEUES } from '@scp/shared';

const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 4100);

export function startHealthServer(boss: PgBoss): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url !== '/health') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }

    try {
      const prisma = getPrisma();
      await prisma.$queryRaw`SELECT 1`;

      const queues: Record<string, { size: number }> = {};
      for (const q of ALL_QUEUES) {
        try {
          const size = await boss.getQueueSize(q);
          queues[q] = { size };
        } catch {
          queues[q] = { size: -1 };
        }
      }

      res.setHeader('content-type', 'application/json');
      res.statusCode = 200;
      res.end(JSON.stringify({ ok: true, db: 'ok', queues }));
    } catch (err) {
      res.setHeader('content-type', 'application/json');
      res.statusCode = 503;
      res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    }
  });

  server.listen(HEALTH_PORT, '0.0.0.0', () => {
    console.log(`[worker:health] listening on http://0.0.0.0:${HEALTH_PORT}/health`);
  });

  return server;
}
