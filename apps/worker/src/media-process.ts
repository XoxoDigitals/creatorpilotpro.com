/**
 * MEDIA processor (docs/04 §2–3). Turn a downloaded source video into a
 * reviewable ContentItem: trim the lead-in + normalize to mp4 (when ffmpeg is
 * available), register the media as assets, and create the REPURPOSED ContentItem
 * in REVIEW_PENDING. If ffmpeg is absent we degrade gracefully — the raw download
 * (already an mp4 from yt-dlp) becomes the FINAL asset and an incident notes that
 * normalization was skipped, so the item still reaches human review.
 */
import { stat } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type PgBoss from 'pg-boss';
import { hotTierPath, md5File, TieredStorage } from '@scp/storage';
import { renderSettingsFromVoiceSettings, resolveTrimStartMs } from '@scp/shared';
import { Ffmpeg } from './media/ffmpeg.js';
import { getPrisma, raiseIncident, sourceHotPath } from './ingestion-support.js';
import { getStorageRoot } from './config.js';
import { archiveAssetToDriveIfConfigured } from './gdrive-archive.js';

const storage = new TieredStorage();

// `boss` is accepted for signature parity with the other processors; MEDIA is the
// last ingestion stage and enqueues nothing further (the item now awaits review).
export async function runMedia(sourceVideoId: string, _boss: PgBoss): Promise<void> {
  const prisma = getPrisma();
  const video = await prisma.sourceVideo.findUnique({
    where: { id: sourceVideoId },
    include: { watchedSource: true },
  });
  if (!video || video.downloadStatus !== 'DONE') return; // not ready / wrong state.

  // Idempotency: a ContentItem already produced for this source means we're done.
  const existing = await prisma.contentItem.findFirst({
    where: { sourceVideoId: video.id, deletedAt: null },
    select: { id: true },
  });
  if (existing) return;

  const root = getStorageRoot();
  const rawPath = sourceHotPath(root, video.id, 'original.mp4');

  // The raw download must still be on disk.
  let rawBytes: number;
  try {
    rawBytes = (await stat(rawPath)).size;
  } catch {
    await prisma.sourceVideo.update({ where: { id: video.id }, data: { downloadStatus: 'FAILED' } });
    await raiseIncident(prisma, {
      kind: 'STORAGE',
      severity: 'HIGH',
      accountId: video.watchedSource?.targetAccountId ?? null,
      title: `Downloaded media missing for ${video.title ?? video.sourceUrl}`,
      detail: { sourceVideoId: video.id, expectedPath: rawPath },
    });
    return;
  }

  const item = await prisma.contentItem.create({
    data: {
      type: 'REPURPOSED',
      sourceVideoId: video.id,
      title: video.title?.trim() || 'Untitled source video',
      status: 'REVIEW_PENDING',
    },
    select: { id: true },
  });

  // Always register the raw download as the ORIGINAL asset for provenance.
  await prisma.asset.create({
    data: {
      contentItemId: item.id,
      kind: 'ORIGINAL',
      localPath: rawPath,
      md5: video.md5 ?? null,
      bytes: BigInt(rawBytes),
      durationSec: video.durationSec ?? null,
      storageState: 'LOCAL',
    },
  });

  const ffmpeg = new Ffmpeg();
  let accountTrimMs: number | null = null;
  const accountId = video.watchedSource?.targetAccountId ?? null;
  if (accountId) {
    const profile = await prisma.channelProfile.findUnique({
      where: { accountId },
      select: { voiceSettings: true },
    });
    accountTrimMs = renderSettingsFromVoiceSettings(profile?.voiceSettings).trimStartMs;
  }
  const trimStartMs = resolveTrimStartMs({
    accountTrimMs,
    sourceTrimMs: video.watchedSource?.trimStartMs ?? null,
  });

  if (await ffmpeg.available()) {
    const finalPath = hotTierPath(root, item.id, 'FINAL', 'final.mp4');
    await mkdir(dirname(finalPath), { recursive: true });
    await ffmpeg.trimNormalize(rawPath, finalPath, { trimStartMs });

    const { md5, bytes } = await md5File(finalPath);
    // Certify the file we just wrote before registering it (verifies size + md5).
    await storage.putLocal({ destPath: finalPath, md5, bytes });
    const finalAsset = await prisma.asset.create({
      data: {
        contentItemId: item.id,
        kind: 'FINAL',
        localPath: finalPath,
        md5,
        bytes: BigInt(bytes),
        durationSec: video.durationSec ?? null,
        storageState: 'LOCAL',
      },
    });
    await archiveAssetToDriveIfConfigured(finalAsset.id);
  } else {
    // Degraded path: no ffmpeg → the raw mp4 doubles as the FINAL asset.
    const finalAsset = await prisma.asset.create({
      data: {
        contentItemId: item.id,
        kind: 'FINAL',
        localPath: rawPath,
        md5: video.md5 ?? null,
        bytes: BigInt(rawBytes),
        durationSec: video.durationSec ?? null,
        storageState: 'LOCAL',
      },
    });
    await archiveAssetToDriveIfConfigured(finalAsset.id);
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      severity: 'LOW',
      contentItemId: item.id,
      title: `Media normalization skipped for “${video.title ?? video.sourceUrl}” — ffmpeg not installed`,
      detail: {
        sourceVideoId: video.id,
        hint: 'Install ffmpeg on the worker host so clips are trimmed/normalized before review.',
      },
    });
  }

  console.log(`[worker:media] source ${video.id} → content item ${item.id} (REVIEW_PENDING)`);
}
