/**
 * DOWNLOAD processor (docs/04 §2). Fetch one discovered source video to the hot
 * tier, hash it (md5 + best-effort perceptual hash), and dedupe **per account**:
 *  - exact md5 match against a DONE video on the same target account
 *    ⇒ SKIPPED_DUPLICATE (no further work);
 *  - perceptual near-duplicate on the same account ⇒ flag nearDuplicateOfId but
 *    still process so a human reviews it behind a "possible duplicate" banner.
 * The same external URL/file may legitimately be imported on different accounts.
 * A successful, non-exact-duplicate download enqueues MEDIA.
 */
import { mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Prisma } from '@prisma/client';
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

/**
 * Scope duplicate lookups to the current SocialAccount. Same file on another
 * channel must still ingest. When the watched source has no target account,
 * fall back to the same watched source only (never global).
 */
function sameAccountDupWhere(
  video: { id: string; watchedSourceId: string | null; watchedSource: { targetAccountId: string | null } | null },
): Prisma.SourceVideoWhereInput {
  const accountId = video.watchedSource?.targetAccountId ?? null;
  if (accountId) {
    return { watchedSource: { targetAccountId: accountId } };
  }
  if (video.watchedSourceId) {
    return { watchedSourceId: video.watchedSourceId };
  }
  // Orphan row with no source binding — only compare against other orphans.
  return { watchedSourceId: null };
}

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
    data: { downloadStatus: 'DOWNLOADING', downloadPercent: 0, downloadEtaSec: null, downloadSpeedBps: null },
  });

  // Resolved inside the try below — getStorageRoot() throws when STORAGE_ROOT is
  // unset, and that must surface as a FAILED video + incident rather than
  // escaping this function and leaving the row stuck at DOWNLOADING forever.
  let destPath = '';

  // Throttle progress writes to at most one every ~1.5s so a chatty yt-dlp
  // stream doesn't hammer the DB. The last tick is always flushed on completion.
  let lastWriteAt = 0;
  let lastPct = -1;
  const persistProgress = (p: { percent: number; etaSec?: number; speedBps?: number }): void => {
    const now = Date.now();
    if (now - lastWriteAt < 1500 && Math.abs(p.percent - lastPct) < 100) return;
    lastWriteAt = now;
    lastPct = p.percent;
    void prisma.sourceVideo
      .update({
        where: { id: video.id },
        data: {
          downloadPercent: p.percent,
          downloadEtaSec: p.etaSec ?? null,
          downloadSpeedBps: p.speedBps ?? null,
        },
      })
      .catch(() => undefined); // best-effort; a dropped tick just means a slightly stale bar.
  };

  try {
    destPath = sourceHotPath(getStorageRoot(), video.id, 'original.mp4');
    await mkdir(dirname(destPath), { recursive: true });

    const type = (video.watchedSource?.type ?? 'GENERIC_URL') as WatchedSourceRow['type'];
    const adapter = buildSourceAdapter(type);
    const result = await adapter.download(
      { sourcePlatformId: video.sourcePlatformId, sourceUrl: video.sourceUrl },
      destPath,
      persistProgress,
    );

    // Perceptual hash is best-effort: undefined when ffmpeg is absent (md5-only dedupe).
    const perceptualHash = await computePerceptualHash(destPath, new Ffmpeg());
    const accountScope = sameAccountDupWhere(video);

    // ── Exact-duplicate check (md5), same account only ───────────────────────
    if (result.md5) {
      const exact = await prisma.sourceVideo.findFirst({
        where: {
          md5: result.md5,
          downloadStatus: 'DONE',
          id: { not: video.id },
          ...accountScope,
        },
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
            downloadPercent: 100,
            downloadEtaSec: null,
            downloadSpeedBps: null,
            nearDuplicateOfId: exact.id,
          },
        });
        console.log(
          `[worker:download] ${video.id} is an exact duplicate of ${exact.id} on the same account — skipped`,
        );
        return;
      }
    }

    // ── Perceptual near-duplicate check (same account) ───────────────────────
    let nearDuplicateOfId: string | null = null;
    if (perceptualHash) {
      const candidates = await prisma.sourceVideo.findMany({
        where: {
          perceptualHash: { not: null },
          downloadStatus: 'DONE',
          id: { not: video.id },
          ...accountScope,
        },
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
        downloadPercent: 100,
        downloadEtaSec: null,
        downloadSpeedBps: null,
        nearDuplicateOfId,
      },
    });

    const job: MediaJob = { kind: 'media', sourceVideoId: video.id };
    await boss.send(QUEUE.MEDIA, job, { singletonKey: video.id });
  } catch (err) {
    // destPath is '' when we failed before resolving it (e.g. STORAGE_ROOT unset).
    if (destPath) await rm(destPath, { force: true }).catch(() => undefined);
    await prisma.sourceVideo.update({
      where: { id: video.id },
      data: { downloadStatus: 'FAILED', downloadEtaSec: null, downloadSpeedBps: null },
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
