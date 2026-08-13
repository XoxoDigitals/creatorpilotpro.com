/**
 * Render/merge processor (docs/05, Phase 3.6). After TTS produces a VOICEOVER
 * asset, this processor:
 * 1. Attempts Demucs vocal separation (graceful: if not installed, keeps original
 *    audio muted + VO overlay only)
 * 2. Overlays the voiceover on the video
 * 3. Loudness-normalizes (EBU R128)
 * 4. Muxes into the FINAL asset
 * 5. Enqueues auto-metadata (AI METADATA task)
 *
 * State: TTS_DONE → RENDERED (success) or TTS_DONE → FAILED (error).
 * Then auto-metadata: RENDERED → METADATA_READY via the AI queue.
 */
import { join } from 'node:path';
import { stat, mkdir, unlink } from 'node:fs/promises';
import type PgBoss from 'pg-boss';
import { QUEUE } from '@scp/shared';
import { resolveDemucsBinary } from '@scp/shared/bin';
import { Ffmpeg } from './media/ffmpeg.js';
import { spawnRunner } from './media/ffmpeg.js';
import type { AiJob } from './ai-jobs.js';
import { getPrisma, raiseIncident } from './publish-support.js';
import { archiveAssetToDriveIfConfigured } from './gdrive-archive.js';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '';

function demucsBin(): string {
  return resolveDemucsBinary();
}

// ── Demucs check ────────────────────────────────────────────────────────────

async function demucsAvailable(): Promise<boolean> {
  try {
    const res = await spawnRunner(demucsBin(), ['--help']);
    return res.code === 0;
  } catch {
    return false;
  }
}

async function runDemucs(inputPath: string, outputDir: string): Promise<string | null> {
  try {
    const res = await spawnRunner(demucsBin(), [
      '-n', 'htdemucs',
      '--two-stems', 'vocals',
      '-o', outputDir,
      inputPath,
    ]);
    if (res.code !== 0) return null;
    // Demucs outputs to {outputDir}/htdemucs/{filename_stem}/no_vocals.wav
    const stem = inputPath.replace(/\\/g, '/').split('/').pop()?.replace(/\.[^.]+$/, '') ?? 'input';
    return join(outputDir, 'htdemucs', stem, 'no_vocals.wav');
  } catch {
    return null;
  }
}

// ── Main render processor ───────────────────────────────────────────────────

export async function runRender(contentItemId: string, boss: PgBoss): Promise<void> {
  const prisma = getPrisma();

  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { assets: true },
  });
  if (!item) {
    console.warn(`[worker:render] content item ${contentItemId} not found — skipping`);
    return;
  }

  if (item.status !== 'TTS_DONE') {
    console.log(`[worker:render] item ${contentItemId} is ${item.status}, not TTS_DONE — skipping`);
    return;
  }

  if (!STORAGE_ROOT) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: 'FAILED' } });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      contentItemId,
      title: 'Render failed: STORAGE_ROOT not configured',
    });
    return;
  }

  // Find the source video (ORIGINAL or existing FINAL) and VOICEOVER assets
  const videoAsset = item.assets.find((a) => a.kind === 'FINAL' || a.kind === 'ORIGINAL');
  const voAsset = item.assets.find((a) => a.kind === 'VOICEOVER');

  if (!videoAsset?.localPath) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: 'FAILED' } });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      contentItemId,
      title: 'Render failed: no video asset found',
    });
    return;
  }

  if (!voAsset?.localPath) {
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: 'FAILED' } });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      contentItemId,
      title: 'Render failed: no voiceover asset found',
    });
    return;
  }

  const renderDir = join(STORAGE_ROOT, 'content', contentItemId, 'render');
  await mkdir(renderDir, { recursive: true });

  const ffmpeg = new Ffmpeg();
  const ffmpegAvail = await ffmpeg.available();

  if (!ffmpegAvail) {
    // Without ffmpeg, we can't merge — mark the existing FINAL as is + incident
    await prisma.contentItem.update({ where: { id: contentItemId }, data: { status: 'RENDERED' } });
    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      severity: 'LOW',
      contentItemId,
      title: 'Render: ffmpeg absent — voiceover not merged, using original video as FINAL',
    });
    // Still enqueue metadata
    await boss.send(QUEUE.AI, { kind: 'metadata', contentItemId } as AiJob, {
      singletonKey: `metadata-${contentItemId}`,
    });
    return;
  }

  try {
    // Step 1: Try Demucs vocal separation (graceful degradation)
    let bgAudioPath: string | null = null;
    const hasDemucs = await demucsAvailable();

    if (hasDemucs) {
      console.log(`[worker:render] running Demucs separation for ${contentItemId}`);
      bgAudioPath = await runDemucs(videoAsset.localPath, renderDir);
      if (bgAudioPath) {
        // Save BG_AUDIO asset
        const bgStats = await stat(bgAudioPath);
        await prisma.asset.create({
          data: {
            contentItemId,
            kind: 'BG_AUDIO',
            storageState: 'LOCAL',
            localPath: bgAudioPath,
            bytes: BigInt(bgStats.size),
          },
        });
      }
    }

    // Step 2: Merge video + voiceover (+ background audio if Demucs succeeded)
    const mergedPath = join(renderDir, 'merged.mp4');

    if (bgAudioPath) {
      // Mix VO + BG audio, overlay on muted video
      await ffmpeg.exec([
        '-i', videoAsset.localPath,
        '-i', voAsset.localPath,
        '-i', bgAudioPath,
        '-filter_complex',
        '[1:a]volume=1.0[vo];[2:a]volume=0.3[bg];[vo][bg]amix=inputs=2:duration=first[mixed]',
        '-map', '0:v',
        '-map', '[mixed]',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-y', mergedPath,
      ]);
    } else {
      // No Demucs: mute original audio, overlay VO only
      await ffmpeg.exec([
        '-i', videoAsset.localPath,
        '-i', voAsset.localPath,
        '-map', '0:v',
        '-map', '1:a',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        '-y', mergedPath,
      ]);
      if (!hasDemucs) {
        await raiseIncident(prisma, {
          kind: 'SYSTEM',
          severity: 'LOW',
          contentItemId,
          title: 'Render: Demucs not installed — original audio muted, VO overlay only',
        });
      }
    }

    // Step 3: Loudness normalization (EBU R128)
    const finalPath = join(renderDir, 'final.mp4');
    await ffmpeg.exec([
      '-i', mergedPath,
      '-c:v', 'copy',
      '-af', 'loudnorm=I=-16:LRA=11:TP=-1.5',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      '-y', finalPath,
    ]);

    // Clean up intermediate
    await unlink(mergedPath).catch(() => {});

    // Step 4: Create/update FINAL asset
    const finalStats = await stat(finalPath);
    const existingFinal = item.assets.find((a) => a.kind === 'FINAL');
    if (existingFinal) {
      await prisma.asset.update({
        where: { id: existingFinal.id },
        data: {
          localPath: finalPath,
          bytes: BigInt(finalStats.size),
          storageState: 'LOCAL',
        },
      });
      // Prefer Drive as system of record when STORAGE_BACKEND=gdrive.
      await archiveAssetToDriveIfConfigured(existingFinal.id);
    } else {
      const created = await prisma.asset.create({
        data: {
          contentItemId,
          kind: 'FINAL',
          storageState: 'LOCAL',
          localPath: finalPath,
          bytes: BigInt(finalStats.size),
        },
      });
      await archiveAssetToDriveIfConfigured(created.id);
    }

    // Step 5: Transition to RENDERED
    await prisma.contentItem.update({
      where: { id: contentItemId },
      data: { status: 'RENDERED' },
    });

    // Step 6: Auto-metadata via AI queue
    await boss.send(QUEUE.AI, { kind: 'metadata', contentItemId } as AiJob, {
      singletonKey: `metadata-${contentItemId}`,
    });

    // Step 7: Auto-subtitles (docs/10 backlog #9). Fire-and-forget on the
    // MEDIA queue so it doesn't block metadata. Whisper is optional — if not
    // installed the processor logs and returns without failing.
    await boss.send(QUEUE.MEDIA, { kind: 'subtitles', contentItemId }, {
      singletonKey: `subtitles-${contentItemId}`,
    });

    console.log(`[worker:render] render done for ${contentItemId} — enqueued metadata`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error(`[worker:render] render failed for ${contentItemId}:`, errMsg);

    await prisma.contentItem.update({
      where: { id: contentItemId }, data: { status: 'FAILED' } });

    await raiseIncident(prisma, {
      kind: 'SYSTEM',
      contentItemId,
      title: `Render failed: ${errMsg.slice(0, 200)}`,
      detail: { error: errMsg },
    });
  }
}
