/**
 * DOWNLOAD processor (docs/04 §2). Fetch one discovered source video to the hot
 * tier, hash it (md5 + best-effort perceptual hash), and dedupe:
 *  - exact md5 match against a DONE video ⇒ SKIPPED_DUPLICATE (no further work);
 *  - perceptual near-duplicate ⇒ flag nearDuplicateOfId but still process so a
 *    human reviews it behind a "possible duplicate" banner.
 * A successful, non-exact-duplicate download enqueues MEDIA.
 */
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type PgBoss from 'pg-boss';
import { QUEUE } from '@scp/shared';
import { Ffmpeg } from './media/ffmpeg.js';
import { computePerceptualHash, isNearDuplicate } from './media/phash.js';
import {
  buildSourceAdapter,
  getPrisma,
  raiseIncident,
  sourceHotPath,
  type WatchedSourceRow,
} from './ingestion-support.js';
import { getStorageRoot } from './config.js';
import type { MediaJob } from './ingestion-jobs.js';

/** Newest DONE videos scanned for a perceptual near-duplicate match. */
const NEAR_DUP_SCAN_LIMIT = 500;

export async function runDownload(sourceVideoId: string, boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const video = await prisma.sourceVideo.findUnique({
    where: { id: sourceVideoId },
    include: { watchedSource: true },
  });
  if (!video) return; // deleted between enqueue and run.
  if (video.downloadStatus === 'DONE' || video.downloadStatus === 'SKIPPED_DUPLICATE') return; // idempotent.

  await prisma.sourceVideo.update({
    where: { id: video.id },
    data: { downloadStatus: 'DOWNLOADING' },
  });

  const root = getStorageRoot();
  const destPath = sourceHotPath(root, video.id, 'original.mp4');

  try {
    await mkdir(dirname(destPath), { recursive: true });

    const type = (video.watchedSource?.type ?? 'GENERIC_URL') as WatchedSourceRow['type'];
    const adapter = buildSourceAdapter(type);
    const result = await adapter.download(
      { sourcePlatformId: video.sourcePlatformId, sourceUrl: video.sourceUrl },
      destPath,
    );

    // Perceptual hash is best-effort: undefined when ffmpeg is absent (md5-only dedupe).
    const perceptualHash = await computePerceptualHash(destPath, new Ffmpeg());

    // ── Exact-duplicate check (md5) ──────────────────────────────────────────
    if (result.md5) {
      const exact = await prisma.sourceVideo.findFirst({
        where: { md5: result.md5, downloadStatus: 'DONE', id: { not: video.id } },
        select: { id: true },
      });
      if (exact) {
        await rm(destPath, { force: true }); // reclaim the disk; the original stays.
        await prisma.sourceVideo.update({
          where: { id: video.id },
          data: {
            md5: result.md5,
            ...(perceptualHash ? { perceptualHash } : {}),
            downloadStatus: 'SKIPPED_DUPLICATE',
            nearDuplicateOfId: exact.id,
          },
        });
        // eslint-disable-next-line no-console
        console.log(`[worker:download] ${video.id} is an exact duplicate of ${exact.id} — skipped`);
        return;
      }
    }

    // ── Perceptual near-duplicate check ──────────────────────────────────────
    let nearDuplicateOfId: string | null = null;
    if (perceptualHash) {
      const candidates = await prisma.sourceVideo.findMany({
        where: { perceptualHash: { not: null }, downloadStatus: 'DONE', id: { not: video.id } },
        select: { id: true, perceptualHash: true },
        orderBy: { createdAt: 'desc' },
        take: NEAR_DUP_SCAN_LIMIT,
      });
      const match = candidates.find(
        (c) => c.perceptualHash && isNearDuplicate(perceptualHash, c.perceptualHash),
      );
      if (match) nearDuplicateOfId = match.id;
    }

    await prisma.sourceVideo.update({
      where: { id: video.id },
      data: {
        md5: result.md5 || null,
        ...(perceptualHash ? { perceptualHash } : {}),
        ...(result.durationSec != null ? { durationSec: result.durationSec } : {}),
        downloadStatus: 'DONE',
        nearDuplicateOfId,
      },
    });

    const job: MediaJob = { kind: 'media', sourceVideoId: video.id };
    await boss.send(QUEUE.MEDIA, job, { singletonKey: video.id });
  } catch (err) {
    await rm(destPath, { force: true }).catch(() => undefined);
    await prisma.sourceVideo.update({
      where: { id: video.id },
      data: { downloadStatus: 'FAILED' },
    });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      severity: 'MEDIUM',
      accountId: video.watchedSource?.targetAccountId ?? null,
      title: `Download failed for ${video.title ?? video.sourceUrl}`,
      detail: {
        sourceVideoId: video.id,
        sourceUrl: video.sourceUrl,
        error: err instanceof Error ? err.message : String(err),
      },
    });
  }
}
