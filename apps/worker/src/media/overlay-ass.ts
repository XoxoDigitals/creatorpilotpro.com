/**
 * Build a single ASS file for ffmpeg `ass=` burn-in: top hook + timed captions.
 * More reliable across Linux workers than drawtext + subtitles force_style.
 */
import { readFile, writeFile } from 'node:fs/promises';
import {
  captionAssStyleFields,
  hookAssStyleFields,
  normalizeCaptionTemplateId,
  normalizeOverlayPosition,
  normalizeCaptionColorMode,
  formatImpactAssText,
  buildKaraokeAssCueEvents,
  captionTemplateMeta,
  type CaptionTemplateId,
  type CaptionColorMode,
  type OverlayPosition,
} from '@scp/shared';

export type AssCue = { startMs: number; endMs: number; text: string };

function pad2(n: number): string {
  return String(Math.max(0, Math.floor(n))).padStart(2, '0');
}

/** ASS timestamp H:MM:SS.cs (centiseconds). */
export function msToAssTime(ms: number): string {
  const totalCs = Math.max(0, Math.round(ms / 10));
  const cs = totalCs % 100;
  const totalSec = Math.floor(totalCs / 100);
  const s = totalSec % 60;
  const totalMin = Math.floor(totalSec / 60);
  const m = totalMin % 60;
  const h = Math.floor(totalMin / 60);
  return `${h}:${pad2(m)}:${pad2(s)}.${pad2(cs)}`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, '\\N');
}

function styleLine(
  name: string,
  opts: {
    fontSize: number;
    primary: string;
    outline: string;
    borderStyle: number;
    outlineWidth: number;
    alignment: number;
    marginV: number;
    italic?: boolean;
    shadow?: number;
  },
): string {
  const italic = opts.italic ? -1 : 0;
  const shadow = opts.shadow ?? 0;
  return (
    `Style: ${name},Arial,${opts.fontSize},${opts.primary},` +
    `&H000000FF,${opts.outline},&H80000000,` +
    `-1,${italic},0,0,100,100,0,0,${opts.borderStyle},${opts.outlineWidth},${shadow},` +
    `${opts.alignment},48,48,${opts.marginV},1`
  );
}

/** Parse a minimal SRT into cues (good enough for burn-in). */
export function parseSrtCues(srt: string): AssCue[] {
  const blocks = srt.replace(/^\uFEFF/, '').trim().split(/\r?\n\s*\r?\n/);
  const cues: AssCue[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;
    const timeLine = lines.find((l) => l.includes('-->')) ?? lines[1]!;
    const m = timeLine.match(
      /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/,
    );
    if (!m) continue;
    const toMs = (h: string, mi: string, s: string, frac: string) => {
      const ms = Number((frac + '000').slice(0, 3));
      return ((Number(h) * 60 + Number(mi)) * 60 + Number(s)) * 1000 + ms;
    };
    const startMs = toMs(m[1]!, m[2]!, m[3]!, m[4]!);
    const endMs = toMs(m[5]!, m[6]!, m[7]!, m[8]!);
    const textLines = lines.slice(lines.indexOf(timeLine) + 1);
    const text = textLines.join('\n').trim();
    if (!text || endMs <= startMs) continue;
    cues.push({ startMs, endMs, text });
  }
  return cues;
}

export async function loadSrtCues(srtPath: string): Promise<AssCue[]> {
  const raw = await readFile(srtPath, 'utf8');
  return parseSrtCues(raw);
}

export function buildOverlayAssContent(opts: {
  templateId: CaptionTemplateId | string;
  cues: AssCue[];
  hookText?: string | null;
  /** Hook visible for this many ms (default ~full short). */
  hookEndMs?: number;
  captionPosition?: OverlayPosition | string | null;
  hookPosition?: OverlayPosition | string | null;
  colorMode?: CaptionColorMode | string | null;
  playResX?: number;
  playResY?: number;
}): string {
  const templateId = normalizeCaptionTemplateId(opts.templateId);
  const colorMode = normalizeCaptionColorMode(opts.colorMode);
  const captionPos = normalizeOverlayPosition(opts.captionPosition, 'center');
  const hookPos = normalizeOverlayPosition(opts.hookPosition, 'top');
  const caption = captionAssStyleFields(templateId, captionPos, colorMode);
  const hook = hookAssStyleFields(hookPos);
  const playResX = opts.playResX ?? 1080;
  const playResY = opts.playResY ?? 1920;
  const lastCueEnd = opts.cues.reduce((m, c) => Math.max(m, c.endMs), 0);
  const hookEnd = Math.max(opts.hookEndMs ?? 8_000, lastCueEnd || 8_000);
  const isKaraoke = captionTemplateMeta(templateId).highlightMode === 'karaoke_word';

  const lines: string[] = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    `PlayResX: ${playResX}`,
    `PlayResY: ${playResY}`,
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    styleLine(caption.name, caption),
    styleLine(hook.name, hook),
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ];

  const hookText = (opts.hookText ?? '').trim();
  if (hookText) {
    const hookAss = escapeAssText(hookText.toUpperCase()).replace(/\n+/g, '\\N');
    lines.push(
      `Dialogue: 0,${msToAssTime(0)},${msToAssTime(hookEnd)},${hook.name},,0,0,0,,${hookAss}`,
    );
  }

  for (const cue of opts.cues) {
    if (isKaraoke) {
      const frames = buildKaraokeAssCueEvents(cue, templateId, colorMode);
      for (const frame of frames) {
        lines.push(
          `Dialogue: 0,${msToAssTime(frame.startMs)},${msToAssTime(frame.endMs)},${caption.name},,0,0,0,,${frame.text}`,
        );
      }
      continue;
    }
    const text = formatImpactAssText(cue.text, templateId, colorMode);
    if (!text) continue;
    lines.push(
      `Dialogue: 0,${msToAssTime(cue.startMs)},${msToAssTime(cue.endMs)},${caption.name},,0,0,0,,${text}`,
    );
  }

  return lines.join('\n') + '\n';
}

export async function writeOverlayAssFile(
  destPath: string,
  opts: {
    templateId: CaptionTemplateId | string;
    cues: AssCue[];
    hookText?: string | null;
    hookEndMs?: number;
    captionPosition?: OverlayPosition | string | null;
    hookPosition?: OverlayPosition | string | null;
    colorMode?: CaptionColorMode | string | null;
  },
): Promise<string> {
  const body = buildOverlayAssContent(opts);
  await writeFile(destPath, body, 'utf8');
  return destPath;
}
