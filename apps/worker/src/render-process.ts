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
import { join, dirname } from 'node:path';
import { stat, mkdir, unlink, access, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import type PgBoss from 'pg-boss';
import {
  QUEUE,
  parseVoiceSettings,
  renderSettingsFromVoiceSettings,
  buildFinalVideoFilterFallbacks,
  finalVideoEffectsEnabled,
  resolveHookOverlayText,
  normalizeCaptionTemplateId,
  normalizeOverlayYPercent,
  normalizeCaptionColorMode,
  normalizeColorFilterPreset,
  isOverlayOffId,
  type RenderSettings,
} from '@scp/shared';
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
  VO_MIX_DIALOGUE_BED_GAIN,
  VO_MIX_SIDECHAIN,
  bedGainForPercent,
  dialogueOverlayEnableExpr,
} from './media/ffmpeg.js';
import { loadSrtCues, writeOverlayAssFile } from './media/overlay-ass.js';
import { analysisDialogueRanges, analysisIndicatesDialogue } from './media/dialogue-audio.js';
import { prepareReactionAvatarNobg, REACTION_AVATAR_REMBG_MAX_SEC } from './media/rembg-avatar.js';
import {
  reactionAvatarSourceTrimSec,
  resolveReactionAvatarSpeakingRanges,
} from './media/reaction-avatar-timing.js';
import type { AiJob } from './ai-jobs.js';
import { getPrisma, raiseIncident } from './publish-support.js';
import { archiveAssetToDriveIfConfigured } from './gdrive-archive.js';

const STORAGE_ROOT = process.env.STORAGE_ROOT ?? '';

function demucsBin(): string {
  return resolveDemucsBinary();
}

async function resolveBackgroundBedPercent(contentItemId: string): Promise<number> {
  const prisma = getPrisma();
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    select: {
      currentStep: true,
      idea: { select: { accountId: true } },
      sourceVideo: {
        select: { watchedSource: { select: { targetAccountId: true } } },
      },
    },
  });
  const step = (item?.currentStep ?? {}) as Record<string, unknown>;
  if (typeof step.backgroundBedPercent === 'number' && Number.isFinite(step.backgroundBedPercent)) {
    return Math.max(1, Math.min(100, Math.round(step.backgroundBedPercent)));
  }
  const accountId =
    item?.idea?.accountId ?? item?.sourceVideo?.watchedSource?.targetAccountId ?? null;
  if (!accountId) return parseVoiceSettings(null).backgroundBedPercent ?? 100;
  const profile = await prisma.channelProfile.findUnique({
    where: { accountId },
    select: { voiceSettings: true, language: true },
  });
  return (
    parseVoiceSettings(profile?.voiceSettings, profile?.language).backgroundBedPercent ?? 100
  );
}

async function resolveAccountRenderSettings(contentItemId: string): Promise<RenderSettings> {
  const prisma = getPrisma();
  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    select: {
      idea: { select: { accountId: true } },
      sourceVideo: {
        select: { watchedSource: { select: { targetAccountId: true } } },
      },
      publishTargets: {
        select: { accountId: true },
        take: 5,
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  const accountId =
    item?.idea?.accountId ??
    item?.sourceVideo?.watchedSource?.targetAccountId ??
    item?.publishTargets.find((t) => t.accountId)?.accountId ??
    null;
  if (!accountId) {
    console.warn(
      `[worker:render] no account linked for ${contentItemId} — using default render settings`,
    );
    return renderSettingsFromVoiceSettings(null);
  }
  const profile = await prisma.channelProfile.findUnique({
    where: { accountId },
    select: { voiceSettings: true },
  });
  return renderSettingsFromVoiceSettings(profile?.voiceSettings);
}

/** Prefer FFMPEG_FONTFILE, then common OS fonts (drawtext needs an explicit file on Linux). */
function resolveDrawtextFontFile(): string | null {
  const fromEnv = process.env.FFMPEG_FONTFILE?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf',
    '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
    'C:\\Windows\\Fonts\\arialbd.ttf',
    'C:\\Windows\\Fonts\\arial.ttf',
    'C:\\Windows\\Fonts\\segoeui.ttf',
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function resolveSubtitlePath(
  assets: Array<{ kind: string; localPath: string | null }>,
  voPath: string,
): Promise<string | null> {
  const sub = [...assets].reverse().find((a) => a.kind === 'SUBTITLE' && a.localPath);
  if (sub?.localPath) {
    try {
      await access(sub.localPath);
      return sub.localPath;
    } catch {
      /* missing */
    }
  }
  const besideVo = join(dirname(voPath), 'voiceover.srt');
  try {
    await access(besideVo);
    return besideVo;
  } catch {
    return null;
  }
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

    // Step 2: Enhance VO, then mix bed at the same loudness target as VO.
    // backgroundBedPercent (1–100) is the only bed-level control — 100% ≈ VO.
    // Light sidechain duck keeps speech clear without crushing the bed.
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
      const bedPercent = await resolveBackgroundBedPercent(contentItemId);
      const naturalBedGain = bedGainForPercent(VO_MIX_BED_GAIN, bedPercent);
      const dialogueBedGain = bedGainForPercent(VO_MIX_DIALOGUE_BED_GAIN, bedPercent);
      if (bgAudioPath) {
        const mixFilter = padMixToVideoDuration(
          dialogueRanges.length > 0
            ? voiceoverDialogueBedMixFilterWithRanges(
                dialogueRanges,
                '2:a',
                voEndSec,
                dialogueBedGain,
              )
            : voiceoverDialogueBedMixFilter('2:a', voEndSec, dialogueBedGain),
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
            ` (bed ${bedPercent}%)` +
            (dialogueRanges.length > 0 ? ` (muted ${dialogueRanges.length} dialogue window(s))` : ''),
        );
      } else if (hasNaturalSound) {
        await ffmpeg.exec([
          '-i', videoPath,
          '-i', enhancedVoPath,
          '-filter_complex',
          padMixToVideoDuration(
            voiceoverBedMixFilter('0:a', naturalBedGain, VO_MIX_SIDECHAIN, voEndSec),
          ),
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
            ` (bed ${bedPercent}%)`,
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
    const loudnormPath = join(renderDir, 'loudnorm.mp4');
    await ffmpeg.exec([
      '-i', mergedPath,
      '-c:v', 'copy',
      '-af', 'loudnorm=I=-16:LRA=11:TP=-1.5',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      '-y', loudnormPath,
    ]);
    await unlink(mergedPath).catch(() => {});

    // Step 3b: Trim lead-in + optional flip / color / hook / burned captions.
    // Prefer a single ASS overlay (ffmpeg `ass=`) — more reliable than drawtext.
    const renderSettings = await resolveAccountRenderSettings(contentItemId);
    const step = (item.currentStep ?? {}) as Record<string, unknown>;
    const selectedTemplateRaw =
      typeof step.selectedCaptionTemplateId === 'string'
        ? step.selectedCaptionTemplateId
        : null;
    const captionsOff = isOverlayOffId(selectedTemplateRaw);
    // Per-video template pick at script approval enables burn for that item.
    const captionTemplateId = captionsOff
      ? normalizeCaptionTemplateId(renderSettings.burnCaptions.preset)
      : normalizeCaptionTemplateId(
          selectedTemplateRaw ?? renderSettings.burnCaptions.preset,
        );
    const burnCaptions =
      !captionsOff &&
      (renderSettings.burnCaptions.enabled || !!selectedTemplateRaw?.trim());
    const captionPosition = String(
      normalizeOverlayYPercent(
        typeof step.selectedCaptionPosition === 'string'
          ? step.selectedCaptionPosition
          : renderSettings.burnCaptions.position,
        'center',
      ),
    );
    const captionColorMode = normalizeCaptionColorMode(
      typeof step.selectedCaptionColorMode === 'string'
        ? step.selectedCaptionColorMode
        : renderSettings.burnCaptions.colorMode,
    );
    const hookPosition = String(
      normalizeOverlayYPercent(
        typeof step.selectedHookPosition === 'string'
          ? step.selectedHookPosition
          : renderSettings.hookText.position,
        'top',
      ),
    );
    const hookOff =
      isOverlayOffId(step.selectedHookTextId) ||
      (typeof step.selectedHookText === 'string' &&
        !step.selectedHookText.trim() &&
        isOverlayOffId(step.selectedHookTextId));
    const selectedColorFilter =
      typeof step.selectedColorFilter === 'string' && step.selectedColorFilter.trim()
        ? normalizeColorFilterPreset(step.selectedColorFilter)
        : null;
    const effectiveSettings: RenderSettings = {
      ...renderSettings,
      burnCaptions: {
        ...renderSettings.burnCaptions,
        enabled: burnCaptions,
        preset: captionTemplateId,
        position: captionPosition as RenderSettings['burnCaptions']['position'],
        colorMode: captionColorMode,
      },
      hookText: {
        ...renderSettings.hookText,
        // Prefer burning hook whenever account enabled OR a hook was selected,
        // unless the owner explicitly chose None.
        enabled:
          !hookOff &&
          (renderSettings.hookText.enabled ||
            !!(typeof step.selectedHookText === 'string' && step.selectedHookText.trim())),
        position: hookPosition as RenderSettings['hookText']['position'],
      },
      colorFilter:
        selectedColorFilter && selectedColorFilter !== 'none'
          ? { enabled: true, preset: selectedColorFilter }
          : selectedColorFilter === 'none'
            ? { enabled: false, preset: 'none' }
            : renderSettings.colorFilter,
    };

    const subtitlePath = await resolveSubtitlePath(item.assets, voPath);
    const hookOverlayText = hookOff
      ? null
      : resolveHookOverlayText(
          effectiveSettings.hookText,
          item.title,
          typeof step.selectedHookText === 'string' ? step.selectedHookText : null,
        );

    let assPath: string | null = null;
    if (
      (effectiveSettings.burnCaptions.enabled && subtitlePath) ||
      (effectiveSettings.hookText.enabled && hookOverlayText)
    ) {
      try {
        const cues =
          effectiveSettings.burnCaptions.enabled && subtitlePath
            ? await loadSrtCues(subtitlePath)
            : [];
        const outAss = join(renderDir, 'overlay.ass');
        await writeOverlayAssFile(outAss, {
          templateId: captionTemplateId,
          cues: effectiveSettings.burnCaptions.enabled ? cues : [],
          hookText: effectiveSettings.hookText.enabled ? hookOverlayText : null,
          captionPosition,
          hookPosition,
          colorMode: captionColorMode,
        });
        assPath = outAss;
        console.log(
          `[worker:render] wrote overlay ASS for ${contentItemId}` +
            ` (cues=${cues.length}, hook=${hookOverlayText ? 'yes' : 'no'}, template=${captionTemplateId})`,
        );
      } catch (err) {
        console.warn(
          `[worker:render] ASS overlay build failed for ${contentItemId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const finalPath = join(renderDir, 'final.mp4');
    const needsEffectsPass = finalVideoEffectsEnabled(
      effectiveSettings,
      subtitlePath,
      hookOverlayText,
      assPath,
    );
    console.log(
      `[worker:render] effects for ${contentItemId}: trim=${effectiveSettings.trimStartMs}ms` +
        ` flip=${effectiveSettings.flipHorizontal.enabled}` +
        ` color=${effectiveSettings.colorFilter.enabled ? effectiveSettings.colorFilter.preset : 'off'}` +
        ` hook=${hookOverlayText ? JSON.stringify(hookOverlayText) : 'off'}` +
        ` captions=${effectiveSettings.burnCaptions.enabled ? (subtitlePath ? 'yes' : 'no-srt') : 'off'}` +
        ` ass=${assPath ? 'yes' : 'no'}`,
    );

    if (needsEffectsPass) {
      const candidates = buildFinalVideoFilterFallbacks({
        settings: effectiveSettings,
        assPath,
        // Legacy fallbacks if ASS missing:
        subtitlePath: assPath ? null : subtitlePath,
        hookOverlayText: assPath ? null : hookOverlayText,
        fontFile: resolveDrawtextFontFile(),
      });
      let applied = false;
      let lastErr: unknown;
      for (const vf of candidates) {
        try {
          await unlink(finalPath).catch(() => {});
          await ffmpeg.applyFinalVideoEffects(loudnormPath, finalPath, vf, {
            trimStartMs: effectiveSettings.trimStartMs,
          });
          applied = true;
          console.log(
            `[worker:render] applied final video effects for ${contentItemId}` +
              (effectiveSettings.trimStartMs > 0
                ? ` [trim:${effectiveSettings.trimStartMs}ms]`
                : '') +
              (effectiveSettings.flipHorizontal.enabled ? ' [flip]' : '') +
              (effectiveSettings.colorFilter.enabled
                ? ` [color:${effectiveSettings.colorFilter.preset}]`
                : '') +
              (vf.includes('ass=') ? ' [ass]' : '') +
              (vf.includes('drawtext=') && hookOverlayText ? ` [hook:${hookOverlayText}]` : '') +
              (vf.includes('subtitles=') ? ' [captions]' : '') +
              (!vf ? ' [trim-only]' : ''),
          );
          break;
        } catch (err) {
          lastErr = err;
          console.warn(
            `[worker:render] effects attempt failed (vf=${vf || '(none)'}):`,
            err instanceof Error ? err.message : err,
          );
        }
      }
      if (!applied) {
        console.warn(
          `[worker:render] all final effects failed — using loudnorm output:`,
          lastErr,
        );
        await unlink(finalPath).catch(() => {});
        await rename(loudnormPath, finalPath);
      } else {
        await unlink(loudnormPath).catch(() => {});
      }
    } else {
      await rename(loudnormPath, finalPath);
    }

    // Step 3c: Reaction avatar PiP (corner face) — after trim/captions so it sits on top.
    // Prefer lip-sync talking-head clip when uploaded; else silent image/clip.
    // showDuring=dialogue (default): PiP only while speaking; reaction source trimmed to
    // sum(speaking) so unused clip tail is not burned. Fallbacks: SRT cues → VO → lead-in.
    const avatar = effectiveSettings.reactionAvatar;
    const preferredRel =
      avatar.enabled && avatar.lipSyncAssetPath?.trim()
        ? avatar.lipSyncAssetPath.trim()
        : avatar.enabled && avatar.assetPath?.trim()
          ? avatar.assetPath.trim()
          : null;
    if (preferredRel && STORAGE_ROOT) {
      const avatarAbs = join(STORAGE_ROOT, preferredRel.replace(/^[/\\]+/, ''));
      try {
        await access(avatarAbs);
        const width = (await ffmpeg.probeVideoWidth(finalPath)) ?? 1080;
        const sizePx = Math.round((width * (avatar.sizePercent ?? 22)) / 100);
        const showDuring = avatar.showDuring ?? 'dialogue';

        let subtitleCuesForAvatar: { startMs: number; endMs: number }[] = [];
        if (showDuring === 'dialogue' && subtitlePath) {
          try {
            subtitleCuesForAvatar = await loadSrtCues(subtitlePath);
          } catch {
            subtitleCuesForAvatar = [];
          }
        }
        const finalPictureSec = (await ffmpeg.probeDurationSec(finalPath)) ?? pictureSec;
        const speaking = resolveReactionAvatarSpeakingRanges({
          showDuring,
          dialogueRanges,
          subtitleCues: subtitleCuesForAvatar,
          voEndSec,
          pictureSec: finalPictureSec,
        });
        const enableExpr =
          showDuring === 'dialogue' ? dialogueOverlayEnableExpr(speaking.ranges) : null;

        const clipDur = await ffmpeg.probeDurationSec(avatarAbs);
        const trimSec = reactionAvatarSourceTrimSec({
          speakingRanges: speaking.ranges,
          clipDurationSec: clipDur,
          maxSec:
            showDuring === 'always'
              ? finalPictureSec ?? REACTION_AVATAR_REMBG_MAX_SEC
              : undefined,
        });
        const nobgMaxSec = Math.min(REACTION_AVATAR_REMBG_MAX_SEC, trimSec);

        const nobg = await prepareReactionAvatarNobg(avatarAbs, {
          ffmpeg,
          mode: avatar.removeBg ?? 'auto',
          chromakeyColor: avatar.chromakeyColor,
          chromakeySimilarity: avatar.chromakeySimilarity,
          chromakeyBlend: avatar.chromakeyBlend,
          maxSec: nobgMaxSec,
          workDir: renderDir,
        });
        if (!nobg.removedBg && nobg.reason) {
          console.warn(
            `[worker:render] reaction avatar remove-bg skipped for ${contentItemId}: ${nobg.reason}`,
          );
        }
        const overlayAbs = nobg.path;
        const isVideo = /\.(mp4|webm|mov|m4v)$/i.test(overlayAbs);
        const pipOut = join(renderDir, 'final-with-avatar.mp4');
        await unlink(pipOut).catch(() => {});
        await ffmpeg.applyReactionAvatarOverlay(finalPath, overlayAbs, pipOut, {
          shape: avatar.shape ?? 'circle',
          corner: avatar.corner ?? 'br',
          sizePx,
          enableExpr,
          isVideo,
          trimSec: isVideo ? trimSec : null,
          workDir: renderDir,
        });
        await unlink(finalPath).catch(() => {});
        await rename(pipOut, finalPath);
        console.log(
          `[worker:render] reaction avatar applied for ${contentItemId}` +
            ` [${avatar.lipSyncAssetPath?.trim() ? 'lip-sync' : 'silent'}/${avatar.shape}/${avatar.corner}/${sizePx}px` +
            (enableExpr
              ? `, dialogue-only(${speaking.source}, ${speaking.ranges.length} win, trim=${trimSec}s)`
              : `, always(trim=${trimSec}s)`) +
            (nobg.removedBg ? `, nobg=${nobg.method ?? 'yes'}` : '') +
            ']',
        );
      } catch (err) {
        console.warn(
          `[worker:render] reaction avatar skipped for ${contentItemId}:`,
          err instanceof Error ? err.message : err,
        );
      }
    } else if (avatar.enabled && !avatar.assetPath?.trim()) {
      console.warn(
        `[worker:render] reaction avatar enabled but no asset uploaded for ${contentItemId}`,
      );
    }

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
