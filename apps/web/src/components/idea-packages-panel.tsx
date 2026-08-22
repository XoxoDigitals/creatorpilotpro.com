'use client';

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { getIdeaPackage, getIdeasView, getApiAccount, ideaTranscriptUrl, ideaVoiceoverUrl, retryIdeaPackage, regenerateIdeaPackage, deleteIdea } from '@/lib/api-data';
import { IdeaFinalUpload } from '@/components/idea-final-upload';
import { OwnerVoiceUpload } from '@/components/kids-rhyme-panel';
import { Button } from '@/components/ui/button';
import { absoluteTime, relativeTime } from '@/lib/format';
import type {
  CharacterPrompt,
  Idea,
  PackageStage,
  ProductionBrief,
  ProductionScene,
  SpokenNarrationLine,
  TimedTranscriptSegment,
} from '@/lib/domain-types';
import { TTS_EMOTION_LABELS, formatCharacterReference, isKidsRhymePackage, type TtsEmotion } from '@scp/shared';

const STAGE_ORDER: PackageStage[] = ['SCRIPT', 'VOICE', 'TRANSCRIPT', 'VISUALS', 'READY'];

function formatMs(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  const frac = Math.floor((ms % 1000) / 10);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(frac).padStart(2, '0')}`;
}

function stageBadgeTone(status: Idea['packageStatus'], stage: PackageStage | null): 'sky' | 'green' | 'red' | 'amber' {
  if (status === 'FAILED' || stage === 'FAILED') return 'red';
  if (status === 'READY' || status === 'DONE' || stage === 'READY') return 'green';
  if (status === 'GENERATING') return 'sky';
  return 'amber';
}

/**
 * The package is finished when either signal says so: idea.packageStatus is the
 * coarse flag, brief.packageStage is what the worker advances per stage. Either
 * one reaching READY means the owner can produce and upload the video, so the
 * upload section never hides because the two drifted apart.
 */
function packageFinished(idea: Idea, pkg?: ProductionBrief): boolean {
  if (idea.packageStatus === 'READY' || idea.packageStatus === 'DONE') return true;
  if ((pkg?.packageStage ?? idea.packageStage) === 'READY') return true;
  return idea.stage === 'UPLOADED' || idea.stage === 'PUBLISHED';
}

/**
 * "Finished" here means the owner's produced video is in — both assets stored,
 * or the idea already moved past upload. Half-finished uploads stay unfinished
 * because the upload gate (and the next idea) is still blocked on them.
 */
function hasFinishedVideo(idea: Idea): boolean {
  if (idea.hasFinalVideo && idea.hasThumbnail) return true;
  return idea.stage === 'UPLOADED' || idea.stage === 'PUBLISHED';
}

interface PackageTag {
  label: string;
  tone: BadgeTone;
  title?: string;
}

/** Header tags for the delivery side of a package: uploaded → scheduled → published. */
function packageTags(idea: Idea): PackageTag[] {
  const tags: PackageTag[] = [];
  const published =
    idea.stage === 'PUBLISHED' || idea.contentStatus === 'PUBLISHED' || !!idea.publishedAt;
  const scheduled =
    !published &&
    (!!idea.scheduledAt ||
      idea.contentStatus === 'SCHEDULED' ||
      idea.contentStatus === 'PUBLISHING');

  if (hasFinishedVideo(idea)) {
    tags.push({ label: 'Finished video', tone: 'green' });
  }
  if (scheduled) {
    tags.push({
      label: idea.scheduledAt ? `Scheduled ${relativeTime(idea.scheduledAt)}` : 'Scheduled',
      tone: 'indigo',
      title: idea.scheduledAt ? absoluteTime(idea.scheduledAt) : undefined,
    });
  }
  if (published) {
    tags.push({
      label: idea.publishedAt ? `Published ${relativeTime(idea.publishedAt)}` : 'Published',
      tone: 'violet',
      title: idea.publishedAt ? absoluteTime(idea.publishedAt) : undefined,
    });
  }
  return tags;
}

/** Unfinished packages first, then finished ones; newest first inside each group. */
function comparePackages(a: Idea, b: Idea): number {
  const byDelivery = Number(hasFinishedVideo(a)) - Number(hasFinishedVideo(b));
  if (byDelivery !== 0) return byDelivery;
  return Date.parse(b.createdAt) - Date.parse(a.createdAt);
}

function rhymeText(pkg: ProductionBrief): string {
  const script = pkg.narrationScript?.trim();
  if (script) return script;
  if (pkg.narrationLines?.length) {
    return pkg.narrationLines.map((line) => line.text).join('\n').trim();
  }
  return '';
}

function isKidsRhymeIdea(pkg: ProductionBrief | undefined, accountKidsRhyme: boolean): boolean {
  return accountKidsRhyme || pkg?.voiceIdUsed === 'owner:upload';
}

function waitingForOwnerVoice(
  pkg: ProductionBrief | undefined,
  kidsRhyme: boolean,
): boolean {
  if (!kidsRhyme || !pkg) return false;
  if (!rhymeText(pkg)) return false;
  if (pkg.voiceoverReady) return false;
  if (pkg.voiceoverStatus === 'GENERATING') return false;
  if ((pkg.timedTranscript?.length ?? 0) > 0) return false;
  return true;
}

function stageProgressLabel(idea: Idea, pkg?: ProductionBrief, kidsRhyme = false): string {
  if (idea.packageStatus === 'FAILED' || pkg?.packageStage === 'FAILED') {
    return pkg?.packageStageError || idea.packageStageError || 'Package failed';
  }
  if (
    idea.packageStatus === 'READY' ||
    idea.packageStatus === 'DONE' ||
    (pkg?.packageStage ?? idea.packageStage) === 'READY'
  ) {
    return 'Package ready';
  }
  if (waitingForOwnerVoice(pkg, kidsRhyme)) return 'Upload sound';
  if (idea.packageStatus === 'GENERATING') {
    if (kidsRhyme) {
      const stage = pkg?.packageStage ?? idea.packageStage;
      if (stage === 'SCRIPT') return 'Writing rhyme…';
      if (stage === 'VOICE') return 'Upload sound';
      if (stage === 'TRANSCRIPT') return 'Timed transcript…';
      if (stage === 'VISUALS') return 'Visual prompts…';
    }
    return (
      pkg?.packageStageLabel ||
      idea.packageStageLabel ||
      (kidsRhyme ? 'Writing rhyme…' : 'Writing title/script…')
    );
  }
  return idea.packageStatus;
}

function labelFor(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function parseStructuredText(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!/^(```|[[{])/.test(trimmed)) return value;
  const fenced = trimmed.match(/^```(?:json|JSON)?\s*\r?\n([\s\S]*?)(?:\r?\n?```)?\s*$/);
  const body = (fenced?.[1] ?? trimmed).trim();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return value
      .replace(/^```(?:json|JSON)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();
  }
}

function plainText(value: unknown, label?: string): string {
  const clean = parseStructuredText(value);
  if (clean == null || clean === '') return '';
  if (Array.isArray(clean)) {
    return clean
      .map((item, index) => plainText(item, label ? `${label} ${index + 1}` : `Item ${index + 1}`))
      .filter(Boolean)
      .join('\n\n');
  }
  if (typeof clean === 'object') {
    return Object.entries(clean as Record<string, unknown>)
      .map(([key, child]) => plainText(child, labelFor(key)))
      .filter(Boolean)
      .join('\n\n');
  }
  const text = String(clean).trim();
  return label ? `${label}: ${text}` : text;
}

function CopyButton({
  value,
  copyKey,
  copiedKey,
  onCopy,
  label = 'Copy',
}: {
  value: unknown;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, value: unknown) => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onCopy(copyKey, value)}
      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
        copiedKey === copyKey
          ? 'text-emerald-600'
          : 'text-indigo-600 hover:bg-indigo-50'
      }`}
    >
      {copiedKey === copyKey ? 'Copied' : label}
    </button>
  );
}

function ReadableValue({ value }: { value: unknown }) {
  const clean = parseStructuredText(value);
  if (clean == null || clean === '') return <p className="text-zinc-400">—</p>;
  if (Array.isArray(clean)) {
    return (
      <div className="space-y-2">
        {clean.map((item, index) => (
          <div key={index} className="rounded-md border border-zinc-100 bg-white p-2">
            <ReadableValue value={item} />
          </div>
        ))}
      </div>
    );
  }
  if (typeof clean === 'object') {
    return (
      <div className="space-y-2">
        {Object.entries(clean as Record<string, unknown>).map(([key, child]) => (
          <div key={key}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">
              {labelFor(key)}
            </p>
            <ReadableValue value={child} />
          </div>
        ))}
      </div>
    );
  }
  return <p className="whitespace-pre-wrap text-zinc-700">{String(clean)}</p>;
}

function PackageSection({
  title,
  value,
  copyKey,
  copiedKey,
  onCopy,
  copyLabel,
}: {
  title: string;
  value: unknown;
  copyKey: string;
  copiedKey: string | null;
  onCopy: (key: string, value: unknown) => void;
  copyLabel?: string;
}) {
  if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h4>
        <CopyButton
          value={value}
          copyKey={copyKey}
          copiedKey={copiedKey}
          onCopy={onCopy}
          label={copyLabel}
        />
      </div>
      <ReadableValue value={value} />
    </section>
  );
}

function sceneVideoPrompt(
  scene: ProductionScene,
  presentationMode = '',
  characters: CharacterPrompt[] = [],
): string {
  if (presentationMode === 'voiceover' || presentationMode === 'background_audio') {
    return scene.animationPrompt;
  }
  const lines = scene.dialogue
    .map((dialogue) => {
      const speaker = dialogue.speaker || 'Speaker';
      const match = characters.find(
        (character) => (character.name ?? '').toLowerCase() === speaker.toLowerCase(),
      );
      const label = match ? formatCharacterReference(match) : speaker;
      return `Dialogue: ${label}: ${dialogue.line}`;
    })
    .filter(Boolean);
  if (lines.length === 0) return scene.animationPrompt;
  const missing = lines.filter((line) => {
    // Match by spoken text so expanded vs bare speaker labels still count as present.
    const spoken = line.replace(/^Dialogue:\s*.+?:\s*/i, '').trim();
    return spoken ? !scene.animationPrompt.includes(spoken) : !scene.animationPrompt.includes(line);
  });
  return missing.length
    ? `${scene.animationPrompt}${scene.animationPrompt ? '\n\n' : ''}Dialogue:\n${missing.join('\n')}`
    : scene.animationPrompt;
}

function countDialogueWords(scene: ProductionScene): number {
  return scene.dialogue.reduce((sum, line) => {
    const text = (line.line ?? '').trim();
    if (!text) return sum;
    return sum + text.split(/\s+/).filter(Boolean).length;
  }, 0);
}

function sceneDialogueWordSummary(scene: ProductionScene): string | null {
  const words = countDialogueWords(scene);
  if (words <= 0) return null;
  const lines = scene.dialogue.filter((d) => (d.line ?? '').trim()).length;
  return `${words} dialogue word${words === 1 ? '' : 's'} · ${lines} line${lines === 1 ? '' : 's'}`;
}

/**
 * Image prompts must not carry video-only cues; video prompts must not carry
 * image-only negative labels. Cleans already-stored packages for copy/display.
 */
function sanitizeScenePrompt(prompt: string, kind: 'image' | 'video'): string {
  let out = (prompt ?? '').trim();
  if (!out) return out;
  if (kind === 'image') {
    // Lip-sync is a motion cue — keep it on video prompts only.
    out = out.replace(/(?:^|\n)[ \t]*Lip-sync:[^\n]*/gi, '');
    out = out.replace(
      /(?:^|\n)[ \t]*Video\s+negative:\s*[\s\S]*?(?=(?:\n[ \t]*(?:Image\s+negative|Negative):)|\s*$)/gi,
      '',
    );
  } else {
    out = out.replace(
      /(?:^|\n)[ \t]*Image\s+negative:\s*[\s\S]*?(?=(?:\n[ \t]*(?:Video\s+negative|Negative):)|\s*$)/gi,
      '',
    );
  }
  return out.replace(/\n{3,}/g, '\n\n').trim();
}

/** Copy body for one scene: matching prompt only + matching negative (never both). */
function sceneCopyPayload(
  prompt: string,
  scene: ProductionScene,
  kind: 'image' | 'video',
): string {
  const main = sanitizeScenePrompt(prompt, kind);
  const neg =
    kind === 'image'
      ? (scene.negativePrompt ?? '').trim()
      : (scene.animationNegativePrompt ?? '').trim();
  if (!neg || main.includes(neg)) return main;
  const label = kind === 'image' ? 'Image negative' : 'Video negative';
  return `${main}\n\n${label}:\n${neg}`;
}

function sceneTimeLabel(scene: ProductionScene): string {
  if (scene.startMs != null && scene.endMs != null) {
    return `${formatMs(scene.startMs)} – ${formatMs(scene.endMs)}`;
  }
  return scene.durationSec != null ? `${scene.durationSec}s` : '';
}

/** "6 scenes · 00:00.00 – 00:48.00", falling back to a duration total when untimed. */
function sceneRangeSummary(scenes: ProductionScene[]): string {
  const count = `${scenes.length} scene${scenes.length === 1 ? '' : 's'}`;
  const timed = scenes.filter(
    (scene): scene is ProductionScene & { startMs: number; endMs: number } =>
      scene.startMs != null && scene.endMs != null,
  );
  if (timed.length > 0) {
    const start = Math.min(...timed.map((scene) => scene.startMs));
    const end = Math.max(...timed.map((scene) => scene.endMs));
    return `${count} · ${formatMs(start)} – ${formatMs(end)}`;
  }
  const total = scenes.reduce((sum, scene) => sum + (scene.durationSec ?? 0), 0);
  return total > 0 ? `${count} · ${total}s total` : count;
}

/**
 * Collapsible section. The header is a button plus optional sibling actions
 * (copy buttons cannot nest inside the toggle), so the whole row stays usable
 * with a keyboard.
 */
function Accordion({
  id,
  title,
  summary,
  actions,
  variant = 'group',
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  summary?: string;
  actions?: ReactNode;
  variant?: 'group' | 'item';
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const group = variant === 'group';
  return (
    <section
      className={
        group
          ? 'overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50'
          : 'overflow-hidden rounded-md border border-zinc-200 bg-white'
      }
    >
      <div
        className={`flex items-center gap-2 px-3 py-2 ${group ? 'hover:bg-zinc-100' : 'hover:bg-zinc-50'}`}
      >
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
          aria-controls={id}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <Chevron open={open} />
          <span className="min-w-0">
            <span
              className={
                group
                  ? 'block text-xs font-semibold uppercase tracking-wide text-zinc-500'
                  : 'block text-xs font-semibold text-zinc-800'
              }
            >
              {title}
            </span>
            {summary ? (
              <span className="mt-0.5 block truncate text-[11px] text-zinc-500">{summary}</span>
            ) : null}
          </span>
        </button>
        {actions}
      </div>
      {open && (
        <div
          id={id}
          className={`border-t px-3 pb-3 pt-3 ${group ? 'border-zinc-200' : 'border-zinc-100'}`}
        >
          {children}
        </div>
      )}
    </section>
  );
}

function PromptGroup({
  title,
  scenes,
  kind,
  presentationMode,
  characters,
  ideaId,
  copiedKey,
  onCopy,
}: {
  title: string;
  scenes: ProductionScene[];
  kind: 'image' | 'video';
  presentationMode: string;
  characters: CharacterPrompt[];
  ideaId: string;
  copiedKey: string | null;
  onCopy: (key: string, value: unknown) => void;
}) {
  const items = scenes
    .map((scene, index) => {
      const raw =
        kind === 'image'
          ? scene.imagePrompt
          : sceneVideoPrompt(scene, presentationMode, characters);
      return {
        scene,
        index,
        label: `Scene ${scene.sceneIndex || index + 1}`,
        prompt: sanitizeScenePrompt(raw, kind),
        dialogueSummary: kind === 'video' ? sceneDialogueWordSummary(scene) : null,
      };
    })
    .filter((item) => item.prompt);
  if (items.length === 0) return null;
  const totalDialogueWords =
    kind === 'video'
      ? items.reduce((sum, item) => sum + countDialogueWords(item.scene), 0)
      : 0;
  return (
    <Accordion
      id={`${ideaId}-${kind}-prompts`}
      title={title}
      summary={
        kind === 'video' && totalDialogueWords > 0
          ? `${sceneRangeSummary(items.map((item) => item.scene))} · ${totalDialogueWords} dialogue words`
          : sceneRangeSummary(items.map((item) => item.scene))
      }
      actions={
        <CopyButton
          value={items
            .map((item) => `${item.label}\n${sceneCopyPayload(item.prompt, item.scene, kind)}`)
            .join('\n\n')}
          copyKey={`${ideaId}:${kind}:all`}
          copiedKey={copiedKey}
          onCopy={onCopy}
          label={`Copy all ${kind === 'image' ? 'images' : 'videos'}`}
        />
      }
    >
      <div className="space-y-2">
        {items.map((item) => (
          <Accordion
            key={item.index}
            id={`${ideaId}-${kind}-scene-${item.index}`}
            variant="item"
            title={item.label}
            summary={[sceneTimeLabel(item.scene), item.dialogueSummary].filter(Boolean).join(' · ')}
            actions={
              <CopyButton
                value={sceneCopyPayload(item.prompt, item.scene, kind)}
                copyKey={`${ideaId}:${kind}:${item.index}`}
                copiedKey={copiedKey}
                onCopy={onCopy}
              />
            }
          >
            {item.scene.narrationSegment ? (
              <p className="mb-2 text-xs italic text-zinc-500">“{item.scene.narrationSegment}”</p>
            ) : null}
            {kind === 'video' && item.scene.dialogue.length > 0 ? (
              <div className="mb-2 rounded-md border border-zinc-100 bg-zinc-50 px-2.5 py-2">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                  Dialogue word count
                  {item.dialogueSummary ? ` · ${item.dialogueSummary}` : ''}
                </p>
                <ul className="space-y-1 text-xs text-zinc-600">
                  {item.scene.dialogue.map((line, lineIndex) => {
                    const text = (line.line ?? '').trim();
                    if (!text) return null;
                    const words = text.split(/\s+/).filter(Boolean).length;
                    return (
                      <li key={`${item.index}-dlg-${lineIndex}`}>
                        <span className="font-medium text-zinc-700">
                          {line.speaker || 'Speaker'}
                        </span>
                        {` · ${words} word${words === 1 ? '' : 's'} — ${text}`}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
            <p className="whitespace-pre-wrap text-sm text-zinc-700">{item.prompt}</p>
            {(kind === 'image' ? item.scene.negativePrompt : item.scene.animationNegativePrompt || item.scene.negativePrompt) ? (
              <div className="mt-3 rounded-md border border-zinc-100 bg-zinc-50 px-2.5 py-2">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                    {kind === 'image' ? 'Image negative' : 'Video negative'}
                  </p>
                  <CopyButton
                    value={
                      kind === 'image'
                        ? item.scene.negativePrompt
                        : item.scene.animationNegativePrompt || item.scene.negativePrompt
                    }
                    copyKey={`${ideaId}:${kind}:neg:${item.index}`}
                    copiedKey={copiedKey}
                    onCopy={onCopy}
                    label="Copy negative"
                  />
                </div>
                <p className="whitespace-pre-wrap text-xs text-zinc-600">
                  {kind === 'image'
                    ? item.scene.negativePrompt
                    : item.scene.animationNegativePrompt || item.scene.negativePrompt}
                </p>
              </div>
            ) : null}
          </Accordion>
        ))}
      </div>
    </Accordion>
  );
}

function transcriptRangeSummary(segments: TimedTranscriptSegment[]): string {
  const count = `${segments.length} segment${segments.length === 1 ? '' : 's'}`;
  if (segments.length === 0) return count;
  const start = Math.min(...segments.map((seg) => seg.startMs));
  const end = Math.max(...segments.map((seg) => seg.endMs));
  return `${count} · ${formatMs(start)} – ${formatMs(end)}`;
}

function emotionLabel(emotion: string): string {
  const key = emotion.trim().toLowerCase();
  if (key in TTS_EMOTION_LABELS) return TTS_EMOTION_LABELS[key as TtsEmotion];
  return emotion.trim() || 'Neutral';
}

function NarrationLinesSection({
  lines,
  ideaId,
  copiedKey,
  onCopy,
}: {
  lines: SpokenNarrationLine[];
  ideaId: string;
  copiedKey: string | null;
  onCopy: (key: string, value: unknown) => void;
}) {
  const spokenOnly = lines.map((l) => l.text).join('\n');
  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Voiceover narration
        </h4>
        <CopyButton
          value={spokenOnly}
          copyKey={`${ideaId}:narration`}
          copiedKey={copiedKey}
          onCopy={onCopy}
          label="Copy narration"
        />
      </div>
      <ol className="space-y-2">
        {lines.map((line, index) => (
          <li
            key={`${index}:${line.text.slice(0, 24)}`}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
          >
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-indigo-600">
              {emotionLabel(line.emotion)}
            </p>
            <p className="text-zinc-800">{line.text}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TimedTranscriptSection({
  segments,
  ideaId,
  copiedKey,
  onCopy,
}: {
  segments: TimedTranscriptSegment[];
  ideaId: string;
  copiedKey: string | null;
  onCopy: (key: string, value: unknown) => void;
}) {
  if (segments.length === 0) return null;
  const plain = segments
    .map((s) => `[${formatMs(s.startMs)} → ${formatMs(s.endMs)}] ${s.text}`)
    .join('\n');
  return (
    <Accordion
      id={`${ideaId}-transcript`}
      title="Timestamped transcript"
      summary={transcriptRangeSummary(segments)}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <CopyButton
          value={plain}
          copyKey={`${ideaId}:transcript`}
          copiedKey={copiedKey}
          onCopy={onCopy}
          label="Copy transcript"
        />
        <a
          href={ideaTranscriptUrl(ideaId, 'srt')}
          download
          className="rounded px-2 py-0.5 text-[11px] font-medium text-indigo-600 hover:bg-indigo-50"
        >
          Download SRT
        </a>
      </div>
      <ol className="space-y-2">
        {segments.map((seg, index) => (
          <li key={index} className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm">
            <p className="text-[11px] font-medium text-zinc-400">
              {formatMs(seg.startMs)} → {formatMs(seg.endMs)}
            </p>
            <p className="text-zinc-800">{seg.text}</p>
          </li>
        ))}
      </ol>
    </Accordion>
  );
}

function PipelineProgress({
  stage,
  kidsRhyme = false,
}: {
  stage: PackageStage | null | undefined;
  kidsRhyme?: boolean;
}) {
  const current = stage && STAGE_ORDER.includes(stage) ? stage : null;
  const currentIdx = current ? STAGE_ORDER.indexOf(current) : -1;
  return (
    <ol className="mb-3 grid gap-1 sm:grid-cols-4">
      {STAGE_ORDER.filter((s) => s !== 'READY').map((s, idx) => {
        const done = currentIdx > idx || current === 'READY';
        const active = current === s;
        const voiceLabel = kidsRhyme ? 'Upload sound' : 'Generating voice';
        const scriptLabel = kidsRhyme ? 'Writing rhyme' : 'Writing title/script';
        return (
          <li
            key={s}
            className={`rounded-md px-2 py-1.5 text-[11px] ${
              done
                ? 'bg-emerald-50 text-emerald-800'
                : active
                  ? 'bg-sky-50 font-medium text-sky-800'
                  : 'bg-zinc-50 text-zinc-400'
            }`}
          >
            {s === 'SCRIPT'
              ? scriptLabel
              : s === 'VOICE'
                ? voiceLabel
                : s === 'TRANSCRIPT'
                  ? 'Timed transcript'
                  : 'Visual prompts'}
          </li>
        );
      })}
    </ol>
  );
}

function CharacterPromptsSection({
  characters,
  ideaId,
  copiedKey,
  onCopy,
}: {
  characters: CharacterPrompt[];
  ideaId: string;
  copiedKey: string | null;
  onCopy: (key: string, value: unknown) => void;
}) {
  if (characters.length === 0) return null;
  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          Character prompts
        </h4>
        <CopyButton
          value={characters}
          copyKey={`${ideaId}:characters:all`}
          copiedKey={copiedKey}
          onCopy={onCopy}
          label="Copy all characters"
        />
      </div>
      <div className="space-y-3">
        {characters.map((character, index) => (
          <article
            key={`${character.name}:${index}`}
            className="rounded-md border border-zinc-200 bg-white p-3"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <h5 className="text-sm font-semibold text-zinc-900">{character.name}</h5>
              <CopyButton
                value={character}
                copyKey={`${ideaId}:character:${index}`}
                copiedKey={copiedKey}
                onCopy={onCopy}
              />
            </div>
            <ReadableValue
              value={{
                appearance: character.appearance,
                wardrobe: character.wardrobe,
                age: character.age,
                personality: character.personality,
                consistencyDetails: character.consistencyDetails,
              }}
            />
          </article>
        ))}
      </div>
    </section>
  );
}

function PackageDetails({
  idea,
  pkg,
  accountId,
  demo,
  kidsRhyme,
  copiedKey,
  onCopy,
  onUploaded,
  onRetry,
  onRegenerate,
  onDelete,
}: {
  idea: Idea;
  pkg: ProductionBrief | undefined;
  accountId: string;
  demo: boolean;
  kidsRhyme: boolean;
  copiedKey: string | null;
  onCopy: (key: string, value: unknown) => void;
  onUploaded: () => void | Promise<void>;
  onRetry: (idea: Idea) => void | Promise<void>;
  onRegenerate: (idea: Idea, stage: 'script' | 'voiceover' | 'visuals' | 'animations') => void | Promise<void>;
  onDelete: (idea: Idea) => void | Promise<void>;
}) {
  const finished = packageFinished(idea, pkg);
  const generating = idea.packageStatus === 'GENERATING' && !finished;
  const failed = idea.packageStatus === 'FAILED' || pkg?.packageStage === 'FAILED';
  const canRetry = !demo && failed;
  const canRegen = !demo && !generating && (!!pkg || idea.hasBrief);
  const kids = isKidsRhymeIdea(pkg, kidsRhyme);
  const waitingVoice = !demo && waitingForOwnerVoice(pkg, kids);
  const hasScenes = (pkg?.sceneBreakdown?.length ?? 0) > 0;
  const hasTranscript = (pkg?.timedTranscript?.length ?? 0) > 0;
  const pipelineStage = waitingVoice
    ? 'VOICE'
    : (pkg?.packageStage ?? idea.packageStage);
  const rhyme = pkg ? rhymeText(pkg) : '';
  return (
    <>
      {(generating || waitingVoice) && (
        <PipelineProgress stage={pipelineStage} kidsRhyme={kids} />
      )}
      {failed && canRetry && !pkg?.packageStageError ? (
        <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <p>{idea.packageStageError || 'Package failed'}</p>
          <div className="mt-2">
            <Button size="sm" variant="danger" onClick={() => void onRetry(idea)}>
              Retry failed stage
            </Button>
          </div>
        </div>
      ) : null}
      {!pkg ? (
        <div className="space-y-2">
          <p className="text-sm text-zinc-500">
            {generating
              ? kids
                ? 'Writing the rhyme…'
                : 'Research, script, voice, transcript, and visual prompts are being generated…'
              : failed
                ? 'No package details available yet — retry to resume from the failed stage.'
                : 'Package details are loading…'}
          </p>
          {!demo && !generating && (
            <Button size="sm" variant="danger" onClick={() => void onDelete(idea)}>
              Delete
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          {pkg.packageStageError && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              <p>{pkg.packageStageError}</p>
              {canRetry ? (
                <div className="mt-2">
                  <Button size="sm" variant="danger" onClick={() => void onRetry(idea)}>
                    Retry failed stage
                  </Button>
                </div>
              ) : null}
            </div>
          )}
          {canRegen && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void onRegenerate(idea, 'script')}>
                Regenerate script
              </Button>
              {!kids ? (
                <Button
                  size="sm"
                  disabled={!pkg.narrationScript}
                  title={!pkg.narrationScript ? 'Generate a script first' : undefined}
                  onClick={() => void onRegenerate(idea, 'voiceover')}
                >
                  Regenerate voiceover
                </Button>
              ) : null}
              <Button
                size="sm"
                disabled={!hasTranscript && !hasScenes}
                title={
                  !hasTranscript && !hasScenes
                    ? 'Voiceover/transcript or scenes needed first'
                    : undefined
                }
                onClick={() => void onRegenerate(idea, 'visuals')}
              >
                Regenerate visuals
              </Button>
              <Button
                size="sm"
                disabled={!hasScenes}
                title={!hasScenes ? 'Generate visuals/scenes first' : undefined}
                onClick={() => void onRegenerate(idea, 'animations')}
              >
                Regenerate animation prompts
              </Button>
              <Button size="sm" variant="danger" onClick={() => void onDelete(idea)}>
                Delete
              </Button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2">
            {pkg.voiceIdUsed && pkg.voiceIdUsed !== 'owner:upload' ? (
              <p className="text-xs text-zinc-500">Voice: {pkg.voiceIdUsed}</p>
            ) : (
              <span />
            )}
            <CopyButton
              value={{
                videoTitle: pkg.videoTitle || idea.title,
                videoDescription: pkg.videoDescription,
                storySummary: pkg.storySummary,
                characterPrompts: pkg.characterPrompts,
                timedTranscript: pkg.timedTranscript,
                imagePrompts: pkg.sceneBreakdown.map((scene) =>
                  sanitizeScenePrompt(scene.imagePrompt, 'image'),
                ),
                videoPrompts: pkg.sceneBreakdown.map((scene) =>
                  sanitizeScenePrompt(
                    sceneVideoPrompt(scene, pkg.presentationMode, pkg.characterPrompts),
                    'video',
                  ),
                ),
                negativePrompts: pkg.sceneBreakdown.map((scene) => scene.negativePrompt),
                animationNegativePrompts: pkg.sceneBreakdown.map(
                  (scene) => scene.animationNegativePrompt,
                ),
                thumbnailPrompt: pkg.thumbnailPrompt,
                thumbnailNegativePrompt: pkg.thumbnailNegativePrompt,
                thumbnailPromptVariants: pkg.thumbnailPromptVariants,
                universalVideoPrompt: pkg.universalVideoPrompt,
                voiceoverNarration: pkg.narrationScript,
                ...(pkg.englishSummary?.trim()
                  ? { englishSummary: pkg.englishSummary.trim() }
                  : {}),
              }}
              copyKey={`${idea.id}:all`}
              copiedKey={copiedKey}
              onCopy={onCopy}
              label="Copy all"
            />
          </div>
          <PackageSection
            title="Video title"
            value={pkg.videoTitle || idea.title}
            copyKey={`${idea.id}:title`}
            copiedKey={copiedKey}
            onCopy={onCopy}
          />
          <PackageSection
            title="Video description"
            value={pkg.videoDescription}
            copyKey={`${idea.id}:description`}
            copiedKey={copiedKey}
            onCopy={onCopy}
          />
          <PackageSection
            title="Story / overall concept"
            value={pkg.storySummary || pkg.researchSummary}
            copyKey={`${idea.id}:story`}
            copiedKey={copiedKey}
            onCopy={onCopy}
          />
          {kids && rhyme ? (
            <div className="space-y-2">
              <PackageSection
                title="Rhyme"
                value={rhyme}
                copyKey={`${idea.id}:rhyme`}
                copiedKey={copiedKey}
                onCopy={onCopy}
                copyLabel="Copy rhyme"
              />
              <OwnerVoiceUpload
                ideaId={idea.id}
                waiting={!demo && !!rhyme}
                hasExisting={!!pkg.voiceoverReady}
                onUploaded={onUploaded}
              />
            </div>
          ) : pkg.narrationLines && pkg.narrationLines.length > 0 ? (
            <NarrationLinesSection
              lines={pkg.narrationLines}
              ideaId={idea.id}
              copiedKey={copiedKey}
              onCopy={onCopy}
            />
          ) : pkg.narrationScript ? (
            <PackageSection
              title="Voiceover narration"
              value={pkg.narrationScript}
              copyKey={`${idea.id}:narration`}
              copiedKey={copiedKey}
              onCopy={onCopy}
              copyLabel="Copy narration"
            />
          ) : null}
          {pkg.englishSummary?.trim() ? (
            <PackageSection
              title="English summary"
              value={pkg.englishSummary.trim()}
              copyKey={`${idea.id}:english-summary`}
              copiedKey={copiedKey}
              onCopy={onCopy}
              copyLabel="Copy English summary"
            />
          ) : null}
          <CharacterPromptsSection
            characters={pkg.characterPrompts}
            ideaId={idea.id}
            copiedKey={copiedKey}
            onCopy={onCopy}
          />
          {(pkg.voiceoverReady || (!kids && pkg.voiceoverStatus === 'GENERATING')) && (
            <section className="rounded-lg border border-indigo-100 bg-indigo-50/40 p-3">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {kids ? 'Rhyme sound' : 'Voiceover audio'}
              </h4>
              {pkg.voiceoverReady ? (
                <div className="space-y-2">
                  <audio controls src={ideaVoiceoverUrl(idea.id)} className="w-full max-w-md" />
                  <a
                    href={ideaVoiceoverUrl(idea.id)}
                    download
                    className="inline-flex rounded-md border border-indigo-200 bg-white px-2.5 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                  >
                    {kids ? 'Download sound' : 'Download voiceover'}
                  </a>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Generating voice…</p>
              )}
            </section>
          )}
          <TimedTranscriptSection
            segments={pkg.timedTranscript}
            ideaId={idea.id}
            copiedKey={copiedKey}
            onCopy={onCopy}
          />
          <PromptGroup
            title="Image prompts"
            scenes={pkg.sceneBreakdown}
            kind="image"
            presentationMode={pkg.presentationMode}
            characters={pkg.characterPrompts}
            ideaId={idea.id}
            copiedKey={copiedKey}
            onCopy={onCopy}
          />
          <PromptGroup
            title="Video / animation prompts"
            scenes={pkg.sceneBreakdown}
            kind="video"
            presentationMode={pkg.presentationMode}
            characters={pkg.characterPrompts}
            ideaId={idea.id}
            copiedKey={copiedKey}
            onCopy={onCopy}
          />
          {pkg.universalVideoPrompt ? (
            <Accordion
              id={`${idea.id}:universal-video`}
              title="Universal video prompt"
              summary="Shared collage animation template for every scene"
              actions={
                <CopyButton
                  value={pkg.universalVideoPrompt}
                  copyKey={`${idea.id}:universal-video`}
                  copiedKey={copiedKey}
                  onCopy={onCopy}
                  label="Copy"
                />
              }
            >
              <ReadableValue value={pkg.universalVideoPrompt} />
            </Accordion>
          ) : null}
          <PackageSection
            title="Thumbnail prompt"
            value={pkg.thumbnailPrompt}
            copyKey={`${idea.id}:thumbnail`}
            copiedKey={copiedKey}
            onCopy={onCopy}
          />
          {pkg.thumbnailPromptVariants ? (
            <PackageSection
              title="Thumbnail prompt variants"
              value={pkg.thumbnailPromptVariants}
              copyKey={`${idea.id}:thumbnail-variants`}
              copiedKey={copiedKey}
              onCopy={onCopy}
            />
          ) : null}
          {pkg.thumbnailNegativePrompt ? (
            <PackageSection
              title="Thumbnail negative prompt"
              value={pkg.thumbnailNegativePrompt}
              copyKey={`${idea.id}:thumbnail-negative`}
              copiedKey={copiedKey}
              onCopy={onCopy}
              copyLabel="Copy negative"
            />
          ) : null}
        </div>
      )}
      {finished && (
        <div className="mt-4">
          <IdeaFinalUpload
            idea={idea}
            accountId={accountId}
            defaultTitle={pkg?.videoTitle || idea.title}
            demo={demo}
            onUploaded={onUploaded}
          />
        </div>
      )}
    </>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={`h-4 w-4 shrink-0 text-zinc-400 transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path
        d="m5 7.5 5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IdeaPackagesPanel({ accountId }: { accountId: string }) {
  const toast = useToast();
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [packages, setPackages] = useState<Record<string, ProductionBrief>>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [kidsRhyme, setKidsRhyme] = useState(false);
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  // The 5s poll re-runs load(); without this the newest package would re-open
  // itself and fight whatever the user collapsed.
  const autoOpened = useRef(false);

  function toggle(ideaId: string) {
    setOpenIds((current) => {
      const next = new Set(current);
      if (!next.delete(ideaId)) next.add(ideaId);
      return next;
    });
  }

  async function copy(key: string, value: unknown) {
    const text = plainText(value);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 1500);
    } catch {
      toast('Could not copy to clipboard', 'error');
    }
  }


  const load = useCallback(async () => {
    try {
      const [result, account] = await Promise.all([
        getIdeasView(accountId),
        getApiAccount(accountId).catch(() => null),
      ]);
      setDemo(result.demo);
      setKidsRhyme(isKidsRhymePackage(account?.profile?.styleProfile));
      const active = result.ideas
        .filter(
          (idea) =>
            idea.packageStatus === 'GENERATING' ||
            idea.packageStatus === 'READY' ||
            idea.packageStatus === 'DONE' ||
            idea.packageStatus === 'FAILED' ||
            idea.stage === 'IN_PRODUCTION',
        )
        .sort(comparePackages);
      setIdeas(active);
      const newest = active[0];
      if (!autoOpened.current && newest) {
        autoOpened.current = true;
        setOpenIds(new Set([newest.id]));
      }
      const ready = active.filter((idea) => idea.hasBrief);
      const loaded = await Promise.all(
        ready.map(async (idea) => {
          try {
            return [idea.id, await getIdeaPackage(idea.id)] as const;
          } catch {
            return [idea.id, null] as const;
          }
        }),
      );
      setPackages(
        Object.fromEntries(
          loaded.filter((entry): entry is readonly [string, ProductionBrief] => entry[1] != null),
        ),
      );
    } catch {
      toast('Failed to load idea packages', 'error');
      setIdeas([]);
    }
  }, [accountId, toast]);

  const retryIdea = useCallback(
    async (idea: Idea) => {
      try {
        await retryIdeaPackage(idea.id);
        toast('Retry started — resuming from the failed stage.', 'success');
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not retry generation';
        toast(message, 'error');
      }
    },
    [load, toast],
  );

  const regenerateIdea = useCallback(
    async (idea: Idea, stage: 'script' | 'voiceover' | 'visuals' | 'animations') => {
      const label =
        stage === 'script'
          ? 'script'
          : stage === 'voiceover'
            ? 'voiceover'
            : stage === 'animations'
              ? 'animation prompts'
              : 'visuals';
      if (!confirm(`Regenerate ${label} for “${idea.title}”?`)) return;
      try {
        await regenerateIdeaPackage(idea.id, stage);
        toast(`Regenerating ${label}…`, 'success');
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : `Could not regenerate ${label}`;
        toast(message, 'error');
      }
    },
    [load, toast],
  );

  const removeIdea = useCallback(
    async (idea: Idea) => {
      if (!confirm(`Delete AI package “${idea.title}”?`)) return;
      try {
        await deleteIdea(idea.id);
        toast('Idea deleted', 'success');
        await load();
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not delete idea';
        toast(message, 'error');
      }
    },
    [load, toast],
  );

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  if (ideas === null) return <Skeleton className="h-32 w-full rounded-lg" />;
  if (ideas.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500">
        Start generation from Review to create an AI package.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {ideas.map((idea) => {
        const pkg = packages[idea.id];
        const open = openIds.has(idea.id);
        const bodyId = `idea-package-${idea.id}`;
        const tags = packageTags(idea);
        return (
          <article
            key={idea.id}
            className="overflow-hidden rounded-lg border border-zinc-200 bg-white"
          >
            <h3>
              <button
                type="button"
                onClick={() => toggle(idea.id)}
                aria-expanded={open}
                aria-controls={bodyId}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50"
              >
                <Chevron open={open} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-zinc-900">
                    {pkg?.videoTitle || idea.title}
                  </span>
                  {idea.topicSummary?.trim() ? (
                    <span className="mt-0.5 block line-clamp-2 text-xs text-zinc-500">
                      {idea.topicSummary.trim()}
                    </span>
                  ) : null}
                  <span
                    className="mt-0.5 block text-xs text-zinc-500"
                    title={absoluteTime(idea.createdAt)}
                  >
                    Created {relativeTime(idea.createdAt)}
                  </span>
                </span>
                <span className="flex max-w-[55%] flex-wrap items-center justify-end gap-1">
                  {tags.map((tag) => (
                    <Badge key={tag.label} tone={tag.tone}>
                      <span title={tag.title}>{tag.label}</span>
                    </Badge>
                  ))}
                  <Badge
                    tone={stageBadgeTone(
                      idea.packageStatus,
                      pkg?.packageStage ?? idea.packageStage,
                    )}
                    className="max-w-[220px] truncate"
                  >
                    {stageProgressLabel(idea, pkg, isKidsRhymeIdea(pkg, kidsRhyme))}
                  </Badge>
                </span>
              </button>
            </h3>
            {open && (
              <div id={bodyId} className="border-t border-zinc-100 px-4 pb-4 pt-3">
                <PackageDetails
                  idea={idea}
                  pkg={pkg}
                  accountId={accountId}
                  demo={demo}
                  kidsRhyme={kidsRhyme}
                  copiedKey={copiedKey}
                  onCopy={(key, value) => void copy(key, value)}
                  onUploaded={load}
                  onRetry={(currentIdea) => void retryIdea(currentIdea)}
                  onRegenerate={(currentIdea, stage) => void regenerateIdea(currentIdea, stage)}
                  onDelete={(currentIdea) => void removeIdea(currentIdea)}
                />
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}








