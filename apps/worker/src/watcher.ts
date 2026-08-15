/**
 * WATCHER processor + dispatcher (docs/04 §1, §5). The dispatcher (run from a
 * per-minute interval in index.ts, mirroring the publish dispatcher) enqueues a
 * watch job for each ACTIVE source whose check interval has elapsed. The processor
 * lists new videos via the source adapter, upserts source_videos by
 * (watchedSourceId, sourcePlatformId) as PENDING. The download drip dispatcher
 * enqueues DOWNLOAD when the account's ready buffer has room. Repeated listing
 * failures auto-pause the source to ERROR + raise an incident (docs/04 §5).
 */
import type PgBoss from 'pg-boss';
import { QUEUE } from '@scp/shared';
import {
  buildSourceAdapter,
  getPrisma,
  raiseIncident,
  toAdapterSource,
  type WatchedSourceRow,
} from './ingestion-support.js';
import type { CompetitorPollJob, WatchJob } from './ingestion-jobs.js';

/** Consecutive listing failures before a source auto-pauses to ERROR (docs/04 §5). */
export const WATCHER_FAILURE_THRESHOLD = 3;

/**
 * Enqueue a watch job for every ACTIVE source that is due (never checked, or last
 * checked at least checkIntervalMin ago). singletonKey = source id so a source is
 * never polled concurrently. Returns the number dispatched.
 */
export async function dispatchDueSources(boss: PgBoss): Promise<number> {
  const prisma = getPrisma();
  const now = Date.now();
  const active = await prisma.watchedSource.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { id: true, checkIntervalMin: true, lastCheckedAt: true },
    take: 500,
  });

  let dispatched = 0;
  for (const s of active) {
    const dueAt = s.lastCheckedAt ? s.lastCheckedAt.getTime() + s.checkIntervalMin * 60_000 : 0;
    if (now < dueAt) continue;
    const data: WatchJob = { kind: 'watch', watchedSourceId: s.id };
    await boss.send(QUEUE.WATCHER, data, { singletonKey: s.id });
    dispatched += 1;
  }
  return dispatched;
}

/** List new videos for one source and leave them PENDING for the download drip. */
export async function runWatch(watchedSourceId: string, _boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const source = await prisma.watchedSource.findFirst({
    where: { id: watchedSourceId, deletedAt: null },
  });
  if (!source || source.status !== 'ACTIVE') return; // paused/errored/deleted between dispatch and run.

  const row: WatchedSourceRow = {
    id: source.id,
    type: source.type as WatchedSourceRow['type'],
    url: source.url,
    label: source.label,
    trimStartMs: source.trimStartMs,
  };
  const adapter = buildSourceAdapter(row.type);

  let refs;
  try {
    refs = await adapter.listNewVideos(toAdapterSource(row));
  } catch (err) {
    const failures = source.consecutiveFailures + 1;
    const note = err instanceof Error ? err.message : String(err);
    if (failures >= WATCHER_FAILURE_THRESHOLD) {
      await prisma.watchedSource.update({
        where: { id: source.id },
        data: { status: 'ERROR', consecutiveFailures: failures, errorNote: note, lastCheckedAt: new Date() },
      });
      await raiseIncident(prisma, {
        kind: 'SYSTEM',
        severity: 'MEDIUM',
        accountId: source.targetAccountId,
        title: `Watched source paused after ${failures} failures: ${row.label ?? row.url}`,
        detail: { watchedSourceId: source.id, error: note.slice(0, 500) },
      });
    } else {
      await prisma.watchedSource.update({
        where: { id: source.id },
        data: { consecutiveFailures: failures, errorNote: note, lastCheckedAt: new Date() },
      });
    }
    return;
  }

  // Upsert each discovered ref; leave new rows PENDING for the download drip
  // dispatcher (posts/day buffer) — do not enqueue all DOWNLOAD jobs at once.
  let discovered = 0;
  for (const ref of refs) {
    const existing = await prisma.sourceVideo.findUnique({
      where: {
        watchedSourceId_sourcePlatformId: {
          watchedSourceId: source.id,
          sourcePlatformId: ref.sourcePlatformId,
        },
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.sourceVideo.create({
      data: {
        watchedSourceId: source.id,
        sourceUrl: ref.sourceUrl,
        sourcePlatformId: ref.sourcePlatformId,
        uploaderName: ref.uploaderName ?? null,
        title: ref.title ?? null,
        durationSec: ref.durationSec ?? null,
        publishedAt: ref.publishedAt ?? null,
        downloadStatus: 'PENDING',
      },
      select: { id: true },
    });
    discovered += 1;
  }

  await prisma.watchedSource.update({
    where: { id: source.id },
    data: { consecutiveFailures: 0, errorNote: null, lastCheckedAt: new Date() },
  });

  if (discovered > 0) {
    console.log(
      `[worker:watcher] source ${source.id} — discovered ${discovered} new video(s) (PENDING; download drip will enqueue)`,
    );
  }
}

/**
 * Enqueue a competitor_poll job for every ACTIVE competitor channel that is due.
 * Mirrors dispatchDueSources above. Returns the number dispatched.
 */
export async function dispatchDueCompetitors(boss: PgBoss): Promise<number> {
  const prisma = getPrisma();
  const now = Date.now();
  const active = await prisma.competitorChannel.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { id: true, checkIntervalMin: true, lastCheckedAt: true },
    take: 500,
  });

  let dispatched = 0;
  for (const ch of active) {
    const dueAt = ch.lastCheckedAt ? ch.lastCheckedAt.getTime() + ch.checkIntervalMin * 60_000 : 0;
    if (now < dueAt) continue;
    const data: CompetitorPollJob = { kind: 'competitor_poll', competitorChannelId: ch.id };
    await boss.send(QUEUE.WATCHER, data, { singletonKey: `comp-${ch.id}` });
    dispatched += 1;
  }
  return dispatched;
}
