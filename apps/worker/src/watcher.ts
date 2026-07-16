/**
 * WATCHER processor + dispatcher (docs/04 §1, §5). The dispatcher (run from a
 * per-minute interval in index.ts, mirroring the publish dispatcher) enqueues a
 * watch job for each ACTIVE source whose check interval has elapsed. The processor
 * lists new videos via the source adapter, upserts source_videos by
 * (watchedSourceId, sourcePlatformId), and enqueues DOWNLOAD for genuinely new
 * ones. Repeated listing failures auto-pause the source to ERROR + raise an
 * incident (docs/04 §5).
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
import type { DownloadJob, WatchJob } from './ingestion-jobs.js';

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

/** List new videos for one source, upsert them, and enqueue DOWNLOAD for new ones. */
export async function runWatch(watchedSourceId: string, boss: PgBoss): Promise<void> {
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

  // Upsert each discovered ref; enqueue DOWNLOAD only for newly-created rows.
  let enqueued = 0;
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

    const created = await prisma.sourceVideo.create({
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
    const job: DownloadJob = { kind: 'download', sourceVideoId: created.id };
    await boss.send(QUEUE.DOWNLOAD, job, { singletonKey: created.id });
    enqueued += 1;
  }

  await prisma.watchedSource.update({
    where: { id: source.id },
    data: { consecutiveFailures: 0, errorNote: null, lastCheckedAt: new Date() },
  });

  if (enqueued > 0) {
    // eslint-disable-next-line no-console
    console.log(`[worker:watcher] source ${source.id} — enqueued ${enqueued} new download(s)`);
  }
}
