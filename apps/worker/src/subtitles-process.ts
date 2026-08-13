/**
 * Auto-subtitles (docs/10 backlog #9). After render completes, transcribe the
 * VOICEOVER asset with whisper (or faster-whisper) and store an SRT sidecar as
 * a SUBTITLE asset. Graceful degradation: if the whisper CLI is not installed,
 * skip with a warning — subtitles are a boost, not a requirement.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, stat, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resolveWhisperBinary } from '@scp/shared/bin';
import { getPrisma } from './publish-support.js';

const exec = promisify(execFile);

const WHISPER_MODEL = process.env.WHISPER_MODEL ?? 'base';

function whisperBin(): string {
  return resolveWhisperBinary();
}

async function hasWhisper(): Promise<boolean> {
  try {
    await exec(whisperBin(), ['--help'], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

export async function runSubtitles(contentItemId: string): Promise<void> {
  const prisma = getPrisma();

  const item = await prisma.contentItem.findUnique({
    where: { id: contentItemId },
    include: { assets: true },
  });
  if (!item) return;

  const voAsset = item.assets.find((a) => a.kind === 'VOICEOVER');
  if (!voAsset?.localPath) {
    console.log(`[worker:subtitles] ${contentItemId} has no VOICEOVER asset — skipping`);
    return;
  }

  const existing = item.assets.find((a) => a.kind === 'SUBTITLE');
  if (existing) {
    console.log(`[worker:subtitles] ${contentItemId} already has SUBTITLE asset — skipping`);
    return;
  }

  if (!(await hasWhisper())) {
    console.log(`[worker:subtitles] whisper CLI not installed — skipping (install faster-whisper or whisper.cpp)`);
    return;
  }

  try {
    await access(voAsset.localPath);
  } catch {
    console.warn(`[worker:subtitles] VOICEOVER asset path missing: ${voAsset.localPath}`);
    return;
  }

  const outDir = join(dirname(voAsset.localPath), 'subtitles');
  await mkdir(outDir, { recursive: true });

  try {
    await exec(
      whisperBin(),
      [
        voAsset.localPath,
        '--model', WHISPER_MODEL,
        '--output_format', 'srt',
        '--output_dir', outDir,
      ],
      { timeout: 15 * 60 * 1000 },
    );

    const base = voAsset.localPath.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, '') ?? 'voiceover';
    const srtPath = join(outDir, `${base}.srt`);
    const s = await stat(srtPath);

    await prisma.asset.create({
      data: {
        contentItemId,
        kind: 'SUBTITLE',
        storageState: 'LOCAL',
        localPath: srtPath,
        bytes: BigInt(s.size),
      },
    });

    console.log(`[worker:subtitles] ${contentItemId} — created SUBTITLE asset (${s.size} bytes)`);
  } catch (err) {
    console.warn(`[worker:subtitles] failed for ${contentItemId}:`, err instanceof Error ? err.message : err);
    // Non-fatal: subtitles are a nice-to-have, don't fail the pipeline.
  }
}
