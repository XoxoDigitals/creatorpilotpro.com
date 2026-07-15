/**
 * Scheduling dispatcher (docs/06 §3 Layer 2). Runs every minute: find publish
 * targets whose scheduledAt has arrived and enqueue a publish job for each, with
 * singletonKey = publishTargetId so a target can never be double-dispatched.
 */
import type PgBoss from 'pg-boss';
import { QUEUE } from '@scp/shared';
import { getPrisma } from './publish-support.js';
import type { PublishJob } from './publish-jobs.js';

export async function dispatchDueTargets(boss: PgBoss): Promise<number> {
  const prisma = getPrisma();
  const due = await prisma.publishTarget.findMany({
    where: { status: 'SCHEDULED', scheduledAt: { not: null, lte: new Date() } },
    select: { id: true },
    take: 200,
  });

  let dispatched = 0;
  for (const t of due) {
    const data: PublishJob = { kind: 'publish', publishTargetId: t.id };
    await boss.send(QUEUE.PUBLISH, data, { singletonKey: t.id });
    dispatched += 1;
  }
  return dispatched;
}
