/**
 * Render/merge processor (docs/05, Phase 3.6). After TTS produces a VOICEOVER
 * asset, this processor:
 * 1. When analysis hasDialogue: Demucs no-vocals → residual speech cleanup →
 *    AI dialogue-range hard mute → aggressive ffmpeg strip fallback — never
 *    leave original spoken dialogue audible (prefer muted/quiet ambience over
 *    bleeding dialogue). If AI returns no ranges, full-bed aggressive mute.
 * 2. Enhances the voiceover (highpass → EQ → compressor → loudnorm)
 * 3. Mixes VO over a *controlled* bed (limiter + duck): VO stays intelligible;
 *    dialogue beds use hard duck + very low gain
 * 4. Loudness-normalizes the mix (EBU R128)
 * 5. Muxes into the FINAL asset
 * 6. Enqueues auto-metadata (AI METADATA task)
 *
 * State: TTS_DONE → RENDERED (success) or TTS_DONE → FAILED (error).
 * Then auto-metadata: RENDERED → METADATA_READY via the AI queue.
 */
import { join } from 'node:path';
import { stat, mkdir, unlink } from 'node:fs/promises';
import type PgBoss from 'pg-boss';
import { QUEUE } from '@scp/shared';
import { resolveDemucsBinary } from '@scp/shared/bin';
import {
  Ffmpeg,
  spawnRunner,
  voiceoverBedMixFilter,
  voiceoverDialogueBedMixFilter,
  voiceoverDialogueBedMixFilterWithRanges,
  padMixToVideoDuration,
  muxStopAtPictureArgs,
  VO_ONLY_PAD_TO_VIDEO_FILTER,
  PADDED_MIX_AUDIO_MAP,
  VO_MIX_BED_GAIN,
  VO_MIX_SIDECHAIN,
} from './media/ffmpeg.js';
import { analysisDialogueRanges, analysisIndicatesDialogue } from './media/dialogue-audio.js';
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

  // Find the source video (ORIGINAL preferred for mix, else FINAL) and latest VOICEOVER
  const videoAsset =
    item.assets.find((a) => a.kind === 'ORIGINAL' && a.localPath) ??
    item.assets.find((a) => a.kind === 'FINAL' && a.localPath) ??
    item.assets.find((a) => a.kind === 'FINAL' || a.kind === 'ORIGINAL');
  const voAsset = [...item.assets].reverse().find((a) => a.kind === 'VOICEOVER');

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
    const analysis = (item.currentStep as Record<string, unknown> | null)?.analysis;
    const hasDialogue = analysisIndicatesDialogue(analysis);
    const dialogueRanges = hasDialogue ? analysisDialogueRanges(analysis) : [];
    const videoPath = videoAsset.localPath;
    const voPath = voAsset.localPath;
    const originalHasAudio = await ffmpeg.probeHasAudibleAudio(videoPath);

    // Step 1: When dialogue is present, ALWAYS strip vocals:
    // Demucs no-vocals → residual speech cleanup → AI-range hard mute;
    // else aggressive ffmpeg strip. Never mux original spoken dialogue.
    // Prefer VO-only / faint ambience over bleed.
    // No-dialogue clips keep original ambience via a later duck-mix.
    let bgAudioPath: string | null = null;
    let bedSource: 'demucs' | 'ffmpeg-strip' | null = null;

    if (hasDialogue && originalHasAudio) {
      let rawBedPath: string | null = null;
      const hasDemucs = await demucsAvailable();
      if (hasDemucs) {
        try {
          const sourceAudio = join(renderDir, 'source-audio.wav');
          console.log(`[worker:render] extracting audio + Demucs for ${contentItemId}`);
          await ffmpeg.extractAudioWav(videoPath, sourceAudio);
          rawBedPath = await runDemucs(sourceAudio, renderDir);
          if (rawBedPath) bedSource = 'demucs';
          await unlink(sourceAudio).catch(() => {});
        } catch (demucsErr) {
          console.warn(
            `[worker:render] Demucs path failed for ${contentItemId}:`,
            demucsErr instanceof Error ? demucsErr.message : demucsErr,
          );
          rawBedPath = null;
        }
      }
      if (!rawBedPath) {
        const karaokePath = join(renderDir, 'no-vocals-raw.wav');
        try {
          console.log(`[worker:render] Demucs unavailable — aggressive ffmpeg vocal strip for ${contentItemId}`);
          await ffmpeg.stripVocalsToWav(videoPath, karaokePath);
          rawBedPath = karaokePath;
          bedSource = 'ffmpeg-strip';
        } catch (stripErr) {
          console.warn(
            `[worker:render] ffmpeg vocal strip failed for ${contentItemId}:`,
            stripErr instanceof Error ? stripErr.message : stripErr,
          );
        }
      }

      if (rawBedPath) {
        const cleanedPath = join(renderDir, 'no-vocals.wav');
        try {
          // Always kill residual speech left in Demucs/karaoke stems.
          await ffmpeg.cleanupDialogueBed(rawBedPath, cleanedPath);
          if (rawBedPath !== cleanedPath && rawBedPath.includes('no-vocals-raw')) {
            await unlink(rawBedPath).catch(() => {});
          }

          let bedReadyPath = cleanedPath;
          if (dialogueRanges.length > 0) {
            const mutedPath = join(renderDir, 'no-vocals-muted.wav');
            try {
              await ffmpeg.muteDialogueRanges(cleanedPath, mutedPath, dialogueRanges);
              await unlink(cleanedPath).catch(() => {});
              bedReadyPath = mutedPath;
              console.log(
                `[worker:render] hard-muted ${dialogueRanges.length} AI dialogue range(s) on bed for ${contentItemId}`,
              );
            } catch (muteErr) {
              console.warn(
                `[worker:render] dialogue range mute failed for ${contentItemId} — keeping cleaned bed:`,
                muteErr instanceof Error ? muteErr.message : muteErr,
              );
            }
          } else {
            console.log(
              `[worker:render] hasDialogue but no AI dialogueRanges — full-bed aggressive mute for ${contentItemId}`,
            );
          }

          // Keep only if some ambience remains; near-silence → VO-only (safer).
          const audible = await ffmpeg.probeHasAudibleAudio(bedReadyPath, -55);
          if (audible) {
            bgAudioPath = bedReadyPath;
          } else {
            console.log(
              `[worker:render] cleaned dialogue bed near-silent for ${contentItemId} — VO overlay only`,
            );
            await unlink(bedReadyPath).catch(() => {});
            bgAudioPath = null;
            bedSource = null;
          }
        } catch (cleanErr) {
          console.warn(
            `[worker:render] dialogue bed cleanup failed for ${contentItemId}:`,
            cleanErr instanceof Error ? cleanErr.message : cleanErr,
          );
          // Low confidence: do not fall back to raw bed (may still have dialogue).
          bgAudioPath = null;
          bedSource = null;
          if (rawBedPath.includes('no-vocals-raw')) {
            await unlink(rawBedPath).catch(() => {});
          }
        }
      }

      if (bgAudioPath) {
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

    const hasNaturalSound = !hasDialogue && originalHasAudio;

    // Step 2: Same Edge TTS enhance chain (highpass → EQ → compressor →
    // loudnorm), then mix. VO stays clearly hearable; loud beds are limited
    // and ducked under speech so ambience remains without burying narration.
    // Dialogue beds use hard duck + very low gain so residual speech stays inaudible.
    // When AI ranges exist, mix filter also hard-mutes those windows again.
    const enhancedVoPath = join(renderDir, 'voiceover-enhanced.wav');
    await ffmpeg.enhanceVoiceover(voPath, enhancedVoPath);
    const mergedPath = join(renderDir, 'merged.mp4');
    // Keep picture at source length: pad audio (apad) then stop at video
    // (`-shortest` + `-t`). Bare `-shortest` truncated the video to VO length,
    // so EN/DE of the same source rendered at different durations.
    const pictureSec = await ffmpeg.probeDurationSec(videoPath);
    const voSec = await ffmpeg.probeDurationSec(enhancedVoPath);
    // Mute bed after spoken VO ends (ignore trailing silence pad).
    const voEndSec =
      voSec != null && pictureSec != null
        ? Math.min(voSec, pictureSec)
        : (voSec ?? null);
    const stopAtPicture = muxStopAtPictureArgs(pictureSec);

    try {
      if (bgAudioPath) {
        const mixFilter = padMixToVideoDuration(
          dialogueRanges.length > 0
            ? voiceoverDialogueBedMixFilterWithRanges(dialogueRanges, '2:a', voEndSec)
            : voiceoverDialogueBedMixFilter('2:a', voEndSec),
        );
        await ffmpeg.exec([
          '-i', videoPath,
          '-i', enhancedVoPath,
          '-i', bgAudioPath,
          '-filter_complex',
          mixFilter,
          '-map', '0:v',
          '-map', PADDED_MIX_AUDIO_MAP,
          '-c:v', 'copy',
          '-c:a', 'aac',
          ...stopAtPicture,
          '-movflags', '+faststart',
          '-y', mergedPath,
        ]);
        console.log(
          `[worker:render] mixed enhanced VO over cleaned ${bedSource ?? 'stripped'} bed for ${contentItemId}` +
            (dialogueRanges.length > 0 ? ` (muted ${dialogueRanges.length} dialogue window(s))` : '') +
            (voEndSec != null ? ` (bed mute after ${voEndSec.toFixed(2)}s)` : ''),
        );
      } else if (hasNaturalSound) {
        await ffmpeg.exec([
          '-i', videoPath,
          '-i', enhancedVoPath,
          '-filter_complex',
          padMixToVideoDuration(voiceoverBedMixFilter('0:a', VO_MIX_BED_GAIN, VO_MIX_SIDECHAIN, voEndSec)),
          '-map', '0:v',
          '-map', PADDED_MIX_AUDIO_MAP,
          '-c:v', 'copy',
          '-c:a', 'aac',
          ...stopAtPicture,
          '-movflags', '+faststart',
          '-y', mergedPath,
        ]);
        console.log(
          `[worker:render] mixed enhanced VO over original ambience (no dialogue) for ${contentItemId}` +
            (voEndSec != null ? ` (bed mute after ${voEndSec.toFixed(2)}s)` : ''),
        );
      } else {
        // Dialogue present but strip failed, or silent original: mute original, VO only
        await ffmpeg.exec([
          '-i', videoPath,
          '-i', enhancedVoPath,
          '-filter_complex',
          VO_ONLY_PAD_TO_VIDEO_FILTER,
          '-map', '0:v',
          '-map', PADDED_MIX_AUDIO_MAP,
          '-c:v', 'copy',
          '-c:a', 'aac',
          ...stopAtPicture,
          '-movflags', '+faststart',
          '-y', mergedPath,
        ]);
        if (hasDialogue && !bgAudioPath) {
          await raiseIncident(prisma, {
            kind: 'SYSTEM',
            severity: 'LOW',
            contentItemId,
            title: 'Render: vocal strip failed — original dialogue muted, VO overlay only',
          });
        }
      }
    } finally {
      await unlink(enhancedVoPath).catch(() => {});
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
