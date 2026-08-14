'use client';

/**
 * AI pipeline queue for one account. Content items live here after Review approval
 * and before Publish; the SCRIPT_READY row exposes the second human gate (script
 * approval). Pre-render: 9:16 original + analysis accordion (closed) + full-width
 * script. Post-render: same 9:16 size; analysis/script closed; metadata under narration.
 */
import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MediaEmbed } from '@/components/media-embed';
import { relativeTime } from '@/lib/format';
import { ApiError } from '@/lib/api';
import {
  approveScript,
  contentMediaUrl,
  contentOriginalMediaUrl,
  contentThumbnailUrl,
  deleteContent,
  getAiPipeline,
  regenerateMetadata,
  regenerateRender,
  regenerateScript,
  regenerateVoiceover,
  resetToReview,
  retryAi,
  rewriteNarrationScript,
  selectNarrationScript,
  updateNarrationScript,
  updatePublishMetadata,
  type AiPipelineItem,
} from '@/lib/api-data';
import { IdeaPackagesPanel } from '@/components/idea-packages-panel';
import {
  DEFAULT_BACKGROUND_BED_PERCENT,
  clampBackgroundBedPercent,
} from '@scp/shared';

function readableAiText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    const parsed = JSON.parse(trimmed) as unknown;

    // Prefer a clean beat-by-beat layout for VIDEO_ANALYSIS JSON.
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.segments)) {
        const lines: string[] = [];
        if (typeof obj.summary === 'string' && obj.summary.trim()) {
          lines.push(obj.summary.trim());
        }
        if (typeof obj.overallWhatHappens === 'string' && obj.overallWhatHappens.trim()) {
          lines.push(obj.overallWhatHappens.trim());
        }
        for (const seg of obj.segments) {
          if (!seg || typeof seg !== 'object') continue;
          const s = seg as Record<string, unknown>;
          const start = typeof s.startSec === 'number' ? s.startSec : '?';
          const end = typeof s.endSec === 'number' ? s.endSec : '?';
          const what = typeof s.whatHappens === 'string' ? s.whatHappens.trim() : '';
          if (what) lines.push(`[${start}s–${end}s] ${what}`);
        }
        if (lines.length) return lines.join('\n\n');
      }
      // Narration structured output — prefer the spoken script.
      if (typeof obj.script === 'string' && obj.script.trim()) {
        return obj.script.trim();
      }
    }

    const lines: string[] = [];
    const visit = (node: unknown, label?: string) => {
      if (node == null) return;
      if (Array.isArray(node)) {
        node.forEach((item, index) => visit(item, label ? `${label} ${index + 1}` : `${index + 1}`));
      } else if (typeof node === 'object') {
        Object.entries(node as Record<string, unknown>).forEach(([key, child]) =>
          visit(child, key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ')),
        );
      } else {
        lines.push(label ? `${label}: ${String(node)}` : String(node));
      }
    };
    visit(parsed);
    return lines.join('\n\n') || value;
  } catch {
    return value;
  }
}

function platformLabel(platform: string | null | undefined): string {
  switch ((platform ?? '').toUpperCase()) {
    case 'YOUTUBE':
      return 'YouTube';
    case 'TIKTOK':
      return 'TikTok';
    case 'FACEBOOK':
      return 'Facebook';
    default:
      return platform?.trim() || 'Platform';
  }
}

/** Fallback parser when an older API payload only has the opaque metadata string. */
function parseMetadataFields(it: AiPipelineItem): {
  title: string;
  description: string;
  tags: string[];
} {
  if (it.publishTitle || it.publishDescription || (it.publishTags?.length ?? 0) > 0) {
    return {
      title: it.publishTitle ?? '',
      description: it.publishDescription ?? '',
      tags: it.publishTags ?? [],
    };
  }
  if (!it.metadata) return { title: '', description: '', tags: [] };
  try {
    const parsed = JSON.parse(it.metadata) as Record<string, unknown>;
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      description: typeof parsed.description === 'string' ? parsed.description : '',
      tags: Array.isArray(parsed.tags)
        ? (parsed.tags as unknown[]).filter((t): t is string => typeof t === 'string')
        : [],
    };
  } catch {
    return { title: '', description: '', tags: [] };
  }
}

// Group + label the AI-pipeline statuses so the UI reads as a flow, not a raw enum.
const STATUS_LABEL: Record<string, string> = {
  APPROVED: 'Queued',
  ANALYZING: 'Analyzing',
  SCRIPT_READY: 'Script ready — needs approval',
  SCRIPT_APPROVED: 'Voiceover in progress',
  TTS_DONE: 'Render in progress',
  RENDERED: 'Render ready',
  METADATA_READY: 'Metadata ready',
  FAILED: 'Failed',
};

const STATUS_TONE: Record<string, 'neutral' | 'indigo' | 'sky' | 'amber' | 'green' | 'red'> = {
  APPROVED: 'neutral',
  ANALYZING: 'sky',
  SCRIPT_READY: 'amber',
  SCRIPT_APPROVED: 'sky',
  TTS_DONE: 'sky',
  RENDERED: 'green',
  METADATA_READY: 'green',
  FAILED: 'red',
};

// A rough phase index so we can render the mini progress rail below each row.
const PHASE_ORDER = [
  'APPROVED',
  'ANALYZING',
  'SCRIPT_READY',
  'SCRIPT_APPROVED',
  'TTS_DONE',
  'RENDERED',
  'METADATA_READY',
];

const TTS_STAGE = 'SCRIPT_APPROVED';
const RENDER_STAGE = 'TTS_DONE';

function isTtsStage(status: string) {
  return status === TTS_STAGE;
}
function isRenderStage(status: string) {
  return status === RENDER_STAGE;
}

function hasOriginalPreview(item: AiPipelineItem): boolean {
  if (item.hasOriginalVideo === true) return true;
  if (item.hasOriginalVideo === false) return item.hasFinalVideo === true;
  return item.hasFinalVideo !== false;
}

function originalStreamUrl(item: AiPipelineItem): string {
  return item.hasOriginalVideo === true ? contentOriginalMediaUrl(item.id) : contentMediaUrl(item.id);
}

function originalEmbedUrl(item: AiPipelineItem): string | null | undefined {
  if (item.originalVideoEmbedUrl) return item.originalVideoEmbedUrl;
  if (item.hasOriginalVideo === true) return null;
  return item.videoEmbedUrl;
}

/** Vertical 9:16 frame for pipeline previews (Reels / Shorts style). */
const VIDEO_ASPECT = 'aspect-[9/16]';

function PipelineAccordion({
  id,
  title,
  defaultOpen = false,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-100"
      >
        <span
          className={
            'inline-block text-zinc-500 transition-transform ' + (open ? 'rotate-90' : '')
          }
          aria-hidden
        >
          ▸
        </span>
        <span className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
          {title}
        </span>
      </button>
      {open && (
        <div id={id} className="border-t border-zinc-200 px-3 pb-3 pt-2">
          {children}
        </div>
      )}
    </section>
  );
}

function PipelineVideoFrame({
  label,
  itemId,
  embedUrl,
  streamUrl,
  poster,
}: {
  label: string;
  itemId: string;
  embedUrl?: string | null;
  streamUrl: string;
  poster?: string;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-950">
        <MediaEmbed
          key={`${itemId}-${label}`}
          kind="video"
          embedUrl={embedUrl}
          streamUrl={streamUrl}
          poster={poster}
          className={`${VIDEO_ASPECT} w-full border-0 bg-black object-contain`}
        />
      </div>
    </div>
  );
}

function StageProgressBanner({ status }: { status: string }) {
  if (!isTtsStage(status) && !isRenderStage(status)) return null;
  const label = isTtsStage(status) ? 'Generating voiceover…' : 'Rendering video…';
  const detail = isTtsStage(status)
    ? 'TTS is synthesizing narration from the approved script.'
    : 'ffmpeg is mixing the voiceover onto the source video.';
  return (
    <div
      className="mt-3 overflow-hidden rounded-md border border-indigo-200 bg-indigo-50"
      role="status"
      aria-live="polite"
    >
      <div className="h-1 overflow-hidden bg-indigo-100">
        <div className="h-full w-2/3 animate-pulse rounded-full bg-indigo-500" />
      </div>
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-indigo-300 border-t-indigo-700"
          aria-hidden
        />
        <div>
          <p className="text-xs font-medium text-indigo-950">{label}</p>
          <p className="text-[11px] text-indigo-700">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function FinalPreviewPanel({
  item,
  onSaved,
  onRegenerate,
  busy,
  onScriptSaved,
}: {
  item: AiPipelineItem;
  onSaved: (next: AiPipelineItem) => void;
  onRegenerate: () => void;
  busy: boolean;
  onScriptSaved: (next: AiPipelineItem) => void;
}) {
  const toast = useToast();
  const parsed = parseMetadataFields(item);
  const [title, setTitle] = useState(parsed.title);
  const [description, setDescription] = useState(parsed.description);
  const [tagsText, setTagsText] = useState(parsed.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const [thumbBroken] = useState(false);

  // Sync when the pipeline row refreshes (e.g. metadata job finishes).
  useEffect(() => {
    const next = parseMetadataFields(item);
    setTitle(next.title);
    setDescription(next.description);
    setTagsText(next.tags.join(', '));
  }, [item.id, item.metadata, item.publishTitle, item.publishDescription, item.publishTags]);

  const showMetadataEditor = item.status === 'METADATA_READY';
  const hasVideo = item.hasFinalVideo !== false; // default true for older payloads

  async function onSave() {
    setSaving(true);
    try {
      const tags = tagsText
        .split(/[,#\n]+/)
        .map((t) => t.trim())
        .filter(Boolean);
      const next = await updatePublishMetadata(item.id, {
        title: title.trim() || item.title,
        description,
        tags,
      });
      onSaved(next);
      toast('Publish metadata saved.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to save metadata', 'error');
    } finally {
      setSaving(false);
    }
  }

  const poster =
    item.hasThumbnail && !thumbBroken ? contentThumbnailUrl(item.id) : undefined;

  return (
    <div className="mt-3 grid items-start gap-3 [overflow-anchor:none] md:grid-cols-[minmax(14rem,22rem)_minmax(0,1fr)]">
      <div className="space-y-3">
        {hasVideo ? (
          <PipelineVideoFrame
            label="Rendered"
            itemId={item.id}
            embedUrl={item.videoEmbedUrl}
            streamUrl={contentMediaUrl(item.id)}
            poster={!item.videoEmbedUrl ? poster : undefined}
          />
        ) : (
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Rendered
            </p>
            <div
              className={`flex ${VIDEO_ASPECT} items-center justify-center rounded-md border border-zinc-200 bg-zinc-100 text-sm text-zinc-500`}
            >
              Final video not available yet
            </div>
          </div>
        )}
        {item.hasThumbnail && !thumbBroken && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Thumbnail
            </p>
            <MediaEmbed
              kind="image"
              embedUrl={item.thumbnailEmbedUrl}
              streamUrl={contentThumbnailUrl(item.id)}
              className="max-h-28 rounded-md border border-zinc-200 object-contain"
              title="Thumbnail"
            />
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        {item.analysis && (
          <PipelineAccordion id={`analysis-${item.id}`} title="Analysis" defaultOpen={false}>
            <p className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-zinc-700">
              {readableAiText(item.analysis)}
            </p>
          </PipelineAccordion>
        )}
        {item.script && (
          <PipelineAccordion id={`script-${item.id}`} title="Narration script" defaultOpen={false}>
            <NarrationScriptPanel
              item={item}
              busy={busy}
              layout="fluid"
              onSaved={onScriptSaved}
            />
          </PipelineAccordion>
        )}

        <div className="rounded-md border border-zinc-200 bg-white p-3">
          {showMetadataEditor ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-zinc-900">
                    Publish metadata · {platformLabel(item.platform)}
                  </p>
                  <p className="text-[11px] text-zinc-500">
                    AI-generated for this account&apos;s platform. Edit before scheduling.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={onRegenerate}
                  disabled={busy || saving}
                  title="Clear metadata and re-run the AI metadata step for this platform"
                >
                  Regenerate
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={300}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={5}
                  className="min-h-[100px]"
                />
              </div>
              <div className="space-y-1.5">
                <Label>
                  Tags {item.platform === 'TIKTOK' ? '/ hashtags' : ''}
                </Label>
                <Input
                  value={tagsText}
                  onChange={(e) => setTagsText(e.target.value)}
                  placeholder="comma-separated tags"
                />
                {parsed.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {tagsText
                      .split(/[,#\n]+/)
                      .map((t) => t.trim())
                      .filter(Boolean)
                      .slice(0, 20)
                      .map((tag) => (
                        <Badge key={tag} tone="neutral">
                          {tag.startsWith('#') ? tag : `#${tag}`}
                        </Badge>
                      ))}
                  </div>
                )}
              </div>
              <Button size="sm" onClick={() => void onSave()} disabled={saving || busy}>
                {saving ? 'Saving…' : 'Save metadata'}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-zinc-600">
              Final video is ready. Metadata generation runs next — title, description, and tags
              tailored to {platformLabel(item.platform)} will appear here under narration.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const SCRIPT_EDITABLE = new Set(['SCRIPT_READY', 'SCRIPT_APPROVED', 'TTS_DONE', 'FAILED']);

function variantList(item: AiPipelineItem) {
  return item.scriptVariants?.filter((v) => v.script.trim()) ?? [];
}

function selectedVariant(item: AiPipelineItem) {
  const variants = variantList(item);
  if (variants.length === 0) return null;
  return (
    variants.find((v) => v.id === item.selectedScriptId) ??
    variants.find((v) => v.id === 'explainer') ??
    variants[0] ??
    null
  );
}

function NarrationScriptPanel({
  item,
  busy,
  onSaved,
  layout = 'fixed',
}: {
  item: AiPipelineItem;
  busy: boolean;
  onSaved: (next: AiPipelineItem) => void;
  /** `fluid` = full-width under analysis / inside accordion; `fixed` = legacy 340px box. */
  layout?: 'fixed' | 'fluid';
}) {
  const toast = useToast();
  const variants = variantList(item);
  const selected = selectedVariant(item);
  const stored = selected?.script
    ? selected.script
    : readableAiText(item.script ?? '');
  const canEdit = SCRIPT_EDITABLE.has(item.status);
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [rewriting, setRewriting] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [selectingId, setSelectingId] = useState<string | null>(null);
  const locked = busy || saving || rewriting || accepting || selectingId != null;

  useEffect(() => {
    if (mode !== 'view') return;
    setDraft(selected?.script ? selected.script : readableAiText(item.script ?? ''));
  }, [item.id, item.script, item.selectedScriptId, item.scriptVariants, mode, selected?.script]);

  async function persist(script: string): Promise<boolean> {
    const trimmed = script.trim();
    if (!trimmed) {
      toast('Narration script cannot be empty.', 'error');
      return false;
    }
    const next = await updateNarrationScript(item.id, trimmed, selected?.id);
    onSaved(next);
    return true;
  }

  async function onSelectVariant(id: string) {
    if (!canEdit || id === selected?.id || locked) return;
    setSelectingId(id);
    try {
      const next = await selectNarrationScript(item.id, id);
      onSaved(next);
      setMode('view');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to select narration option', 'error');
    } finally {
      setSelectingId(null);
    }
  }

  async function onSaveEdit() {
    setSaving(true);
    try {
      const ok = await persist(draft);
      if (ok) {
        setMode('view');
        toast(
          item.status === 'SCRIPT_READY'
            ? 'Script saved.'
            : 'Script saved. Regenerate voiceover to apply it to the video.',
          'success',
        );
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to save script', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function onRewrite() {
    const trimmed = instruction.trim();
    if (!trimmed) {
      toast('Describe what to change (e.g. “make it shorter”).', 'error');
      return;
    }
    setRewriting(true);
    try {
      const result = await rewriteNarrationScript(item.id, {
        instruction: trimmed,
        script: (mode === 'edit' ? draft : stored).trim() || undefined,
      });
      setPreview(result.script);
      toast('Rewrite ready — review and accept to save.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to rewrite script', 'error');
    } finally {
      setRewriting(false);
    }
  }

  async function onAcceptRewrite() {
    if (!preview?.trim()) return;
    setAccepting(true);
    try {
      const ok = await persist(preview);
      if (ok) {
        setDraft(preview.trim());
        setMode('view');
        setAskOpen(false);
        setInstruction('');
        setPreview(null);
        toast(
          item.status === 'SCRIPT_READY'
            ? 'AI rewrite saved.'
            : 'AI rewrite saved. Regenerate voiceover to apply it to the video.',
          'success',
        );
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to save rewrite', 'error');
    } finally {
      setAccepting(false);
    }
  }

  const shellClass =
    layout === 'fluid'
      ? 'flex flex-col space-y-2 [overflow-anchor:none]'
      : 'flex h-[340px] min-h-[340px] flex-col overflow-hidden rounded-md border border-zinc-200 bg-zinc-50 p-2 [overflow-anchor:none]';

  return (
    <div className={shellClass}>
      <div className="mb-1 flex shrink-0 flex-wrap items-center justify-between gap-2">
        {layout === 'fixed' ? (
          <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">
            Narration script
          </div>
        ) : (
          <div />
        )}
        {canEdit && mode === 'view' && (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDraft(stored);
                setMode('edit');
              }}
              disabled={locked}
            >
              Quick edit
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setAskOpen(true);
                setPreview(null);
              }}
              disabled={locked}
            >
              Ask AI
            </Button>
          </div>
        )}
      </div>
      {variants.length >= 2 && (
        <div className="mb-2 flex shrink-0 flex-wrap gap-1">
          {variants.map((v) => {
            const active = v.id === selected?.id;
            return (
              <button
                key={v.id}
                type="button"
                disabled={locked || !canEdit}
                onClick={() => void onSelectVariant(v.id)}
                className={
                  'rounded-md border px-2 py-1 text-[11px] font-medium ' +
                  (active
                    ? 'border-indigo-300 bg-indigo-50 text-indigo-800'
                    : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-100')
                }
                title={v.hook || v.label}
              >
                {v.label}
                {active ? ' · selected' : ''}
              </button>
            );
          })}
        </div>
      )}
      {mode === 'edit' ? (
        <div className="flex min-h-0 flex-1 flex-col space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={layout === 'fluid' ? 12 : 8}
            className={
              layout === 'fluid'
                ? 'min-h-[180px] resize-y bg-white text-xs'
                : 'min-h-0 flex-1 resize-none bg-white text-xs'
            }
            disabled={locked}
          />
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => void onSaveEdit()} disabled={locked}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setDraft(stored);
                setMode('view');
              }}
              disabled={locked}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setAskOpen(true);
                setPreview(null);
              }}
              disabled={locked}
            >
              Ask AI
            </Button>
          </div>
        </div>
      ) : (
        <div className={layout === 'fluid' ? 'max-h-[28rem] overflow-auto' : 'min-h-0 flex-1 overflow-auto'}>
          <p className="whitespace-pre-wrap text-xs text-zinc-700">{stored}</p>
          {selected?.englishSummary?.trim() || item.englishSummary?.trim() ? (
            <div className="mt-2 rounded-md border border-emerald-100 bg-emerald-50/60 p-2">
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-emerald-700">
                English summary
              </div>
              <p className="whitespace-pre-wrap text-xs text-zinc-700">
                {(selected?.englishSummary?.trim() || item.englishSummary?.trim()) ?? ''}
              </p>
            </div>
          ) : null}
        </div>
      )}

      <Modal
        open={askOpen}
        onClose={() => {
          if (rewriting || accepting) return;
          setAskOpen(false);
        }}
        size="lg"
        title="Ask AI to rewrite the script"
        description="Describe the change. Review the rewrite, then accept to save the selected option."
        footer={
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              onClick={() => {
                if (rewriting || accepting) return;
                setAskOpen(false);
              }}
              disabled={rewriting || accepting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void onRewrite()}
              disabled={rewriting || accepting || !instruction.trim()}
            >
              {rewriting ? 'Rewriting…' : preview ? 'Rewrite again' : 'Rewrite'}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void onAcceptRewrite()}
              disabled={rewriting || accepting || !preview?.trim()}
            >
              {accepting ? 'Saving…' : 'Accept & save'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>What should change?</Label>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              placeholder="e.g. make it shorter, more hooky in the first line, less formal…"
              disabled={rewriting || accepting}
            />
          </div>
          {preview != null && (
            <div className="space-y-1.5">
              <Label>Proposed script</Label>
              <Textarea
                value={preview}
                onChange={(e) => setPreview(e.target.value)}
                rows={10}
                className="min-h-[160px] text-xs"
                disabled={rewriting || accepting}
              />
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}

const FILTER_STATUSES = [
  'APPROVED',
  'ANALYZING',
  'SCRIPT_READY',
  'SCRIPT_APPROVED',
  'TTS_DONE',
  'RENDERED',
  'METADATA_READY',
  'FAILED',
] as const;

const FILTER_PLATFORMS = ['YOUTUBE', 'TIKTOK', 'FACEBOOK'] as const;

export default function AccountAiPipelinePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [items, setItems] = useState<AiPipelineItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rerenderItem, setRerenderItem] = useState<AiPipelineItem | null>(null);
  const [rerenderBedPercent, setRerenderBedPercent] = useState(DEFAULT_BACKGROUND_BED_PERCENT);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [platformFilter, setPlatformFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const refresh = useCallback(async () => {
    try {
      const rows = await getAiPipeline(id);
      setItems(rows);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load AI pipeline', 'error');
      setItems([]);
    }
  }, [id, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const needsFastPoll = (items ?? []).some(
    (it) => isTtsStage(it.status) || isRenderStage(it.status),
  );

  useEffect(() => {
    const ms = needsFastPoll ? 2500 : 5000;
    const t = window.setInterval(() => void refresh(), ms);
    return () => window.clearInterval(t);
  }, [refresh, needsFastPoll]);

  const filteredItems = useMemo(() => {
    const rows = items ?? [];
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((it) => {
      if (statusFilter !== 'all' && it.status !== statusFilter) return false;
      if (platformFilter !== 'all' && (it.platform ?? '').toUpperCase() !== platformFilter) {
        return false;
      }
      if (q) {
        const hay = `${it.title ?? ''} ${it.publishTitle ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [items, statusFilter, platformFilter, searchQuery]);

  const filtersActive =
    statusFilter !== 'all' || platformFilter !== 'all' || searchQuery.trim().length > 0;

  async function onApproveScript(itemId: string) {
    setBusyId(itemId);
    try {
      await approveScript(itemId);
      toast('Script approved — TTS enqueued.', 'success');
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to approve script', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onRetry(itemId: string) {
    setBusyId(itemId);
    try {
      await retryAi(itemId);
      toast('Retrying at the failed step — cached AI outputs are reused.', 'info');
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to retry item', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onSendBackToReview(itemId: string) {
    setBusyId(itemId);
    try {
      await resetToReview(itemId);
      toast('Sent back to Review. Re-approve to run the pipeline from scratch.', 'info');
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to reset item', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onRegenerateMetadata(itemId: string) {
    setBusyId(itemId);
    try {
      await regenerateMetadata(itemId);
      toast('Regenerating platform metadata…', 'info');
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to regenerate metadata', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onRegenerateScript(itemId: string) {
    if (!confirm('Regenerate the voiceover script from the current analysis?')) return;
    setBusyId(itemId);
    try {
      await regenerateScript(itemId);
      toast('Regenerating script…', 'info');
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to regenerate script', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onRegenerateVoiceover(itemId: string) {
    if (!confirm('Re-synthesize the voiceover from the current script? The video will re-render after TTS.')) return;
    setBusyId(itemId);
    try {
      await regenerateVoiceover(itemId);
      toast('Regenerating voiceover…', 'info');
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to regenerate voiceover', 'error');
    } finally {
      setBusyId(null);
    }
  }

  function openRerenderModal(item: AiPipelineItem) {
    setRerenderItem(item);
    setRerenderBedPercent(
      clampBackgroundBedPercent(
        item.backgroundBedPercent ?? DEFAULT_BACKGROUND_BED_PERCENT,
      ),
    );
  }

  async function onConfirmRerender() {
    if (!rerenderItem) return;
    const itemId = rerenderItem.id;
    const percent = clampBackgroundBedPercent(rerenderBedPercent);
    setBusyId(itemId);
    try {
      await regenerateRender(itemId, { backgroundBedPercent: percent });
      toast(`Re-rendering with background at ${percent}%…`, 'info');
      setRerenderItem(null);
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to re-render', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function onDeleteItem(item: AiPipelineItem) {
    if (!confirm(`Delete “${item.title}” from the AI pipeline?`)) return;
    setBusyId(item.id);
    try {
      await deleteContent(item.id);
      toast('Deleted', 'success');
      await refresh();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to delete', 'error');
    } finally {
      setBusyId(null);
    }
  }

  if (items === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Idea generation packages</h2>
          <p className="text-xs text-zinc-500">
            Newest first, with finished videos moved to the bottom. Expand a package for its
            readable production sections.
          </p>
        </div>
        <IdeaPackagesPanel accountId={id} />
      </section>

      {items.length === 0 ? (
        <EmptyState
          title="Nothing in the content AI queue"
          hint="Approve an ingested video in Review to send it here for analysis, narration, and metadata."
        />
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="AI pipeline"
              description="Analyze → Narrate (3 options) → Approve one script → TTS → Render → Metadata. Human gate at Script ready."
            />
            <div className="flex flex-wrap items-end gap-3 border-t border-zinc-100 px-4 py-3">
              <div className="min-w-[10rem] flex-1">
                <Label>Search</Label>
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Title…"
                  className="py-1.5 text-xs"
                />
              </div>
              <div className="w-44">
                <Label>Status</Label>
                <Select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="py-1.5 text-xs"
                >
                  <option value="all">All statuses</option>
                  {FILTER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s] ?? s}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="w-36">
                <Label>Platform</Label>
                <Select
                  value={platformFilter}
                  onChange={(e) => setPlatformFilter(e.target.value)}
                  className="py-1.5 text-xs"
                >
                  <option value="all">All platforms</option>
                  {FILTER_PLATFORMS.map((p) => (
                    <option key={p} value={p}>
                      {platformLabel(p)}
                    </option>
                  ))}
                </Select>
              </div>
              {filtersActive && (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setStatusFilter('all');
                    setPlatformFilter('all');
                    setSearchQuery('');
                  }}
                >
                  Clear
                </Button>
              )}
              <p className="ml-auto text-[11px] text-zinc-500">
                {filteredItems.length} of {items.length}
              </p>
            </div>
          </Card>

          {filteredItems.length === 0 ? (
            <EmptyState
              title="No videos match these filters"
              hint="Clear filters or pick another status / platform."
            />
          ) : null}

          {filteredItems.map((it) => {
            const phaseIdx = PHASE_ORDER.indexOf(it.status);
            const showFinalPreview =
              it.status === 'RENDERED' || it.status === 'METADATA_READY';
            const displayTitle =
              it.status === 'METADATA_READY' && it.publishTitle
                ? it.publishTitle
                : it.title;
            return (
              <Card key={it.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[it.status] ?? 'neutral'}>
                        {STATUS_LABEL[it.status] ?? it.status}
                      </Badge>
                      {it.platform && (
                        <Badge tone="neutral">{platformLabel(it.platform)}</Badge>
                      )}
                      <span className="truncate text-sm font-medium text-zinc-900">
                        {displayTitle}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-zinc-500">
                      Updated {relativeTime(it.updatedAt)}
                      {it.statusReason ? ` · ${it.statusReason}` : ''}
                      {it.status === 'METADATA_READY' && it.publishTitle && it.title !== it.publishTitle
                        ? ` · source: ${it.title}`
                        : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {it.status === 'SCRIPT_READY' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void onApproveScript(it.id)}
                          disabled={busyId === it.id}
                          title="Approve the selected narration option and start TTS"
                        >
                          Approve script
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void onRegenerateScript(it.id)}
                          disabled={busyId === it.id}
                          title="Re-write the narration from the existing analysis"
                        >
                          Regenerate script
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void onSendBackToReview(it.id)}
                          disabled={busyId === it.id}
                          title="Clear analysis/script and send back to Review. Re-approve to re-run Analyze → Narrate with current prompts."
                        >
                          Send to Review
                        </Button>
                      </>
                    )}
                    {(it.status === 'SCRIPT_APPROVED' ||
                      it.status === 'TTS_DONE' ||
                      it.status === 'RENDERED' ||
                      it.status === 'METADATA_READY') && (
                      <>
                        {it.analysis && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void onRegenerateScript(it.id)}
                            disabled={busyId === it.id}
                          >
                            Regenerate script
                          </Button>
                        )}
                        {it.script && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => void onRegenerateVoiceover(it.id)}
                            disabled={busyId === it.id}
                          >
                            Regenerate voiceover
                          </Button>
                        )}
                        {(it.status === 'TTS_DONE' ||
                          it.status === 'RENDERED' ||
                          it.status === 'METADATA_READY') && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => openRerenderModal(it)}
                            disabled={busyId === it.id}
                          >
                            Re-render
                          </Button>
                        )}
                      </>
                    )}
                    {(it.status === 'RENDERED' || it.status === 'METADATA_READY') && (
                      <>
                        {/* The content-item media route streams the FINAL asset
                            (produced-video path) or falls back to ORIGINAL. */}
                        <a
                          href={contentMediaUrl(it.id)}
                          download
                          className="inline-flex items-center rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                          title="Download the rendered video"
                        >
                          Download
                        </a>
                        <Link
                          href={`/accounts/${id}/schedule?itemId=${it.id}` as Route}
                          className="inline-flex items-center rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                          title="Create publish targets — the package goes to Review before anything publishes"
                        >
                          Schedule to publish
                        </Link>
                      </>
                    )}
                    {it.status === 'FAILED' && (
                      <>
                        <Button
                          size="sm"
                          onClick={() => void onRetry(it.id)}
                          disabled={busyId === it.id}
                          title="Retry at the failed step. Cached AI outputs are reused, so successful earlier steps do not re-bill."
                        >
                          Retry
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void onSendBackToReview(it.id)}
                          disabled={busyId === it.id}
                          title="Clear all AI outputs and send to Review. Re-approving will run the pipeline from scratch."
                        >
                          Send to Review
                        </Button>
                      </>
                    )}
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => void onDeleteItem(it)}
                      disabled={busyId === it.id}
                    >
                      Delete
                    </Button>
                  </div>
                </div>

                {/* phase rail */}
                <div className="mt-2 grid grid-cols-7 gap-1">
                  {PHASE_ORDER.map((p, i) => {
                    const active = phaseIdx >= 0 && i <= phaseIdx;
                    const inProgress =
                      i === phaseIdx && (isTtsStage(it.status) || isRenderStage(it.status));
                    return (
                      <div
                        key={p}
                        className={
                          'h-1 rounded-full ' +
                          (inProgress
                            ? 'animate-pulse bg-indigo-500'
                            : active
                              ? 'bg-blue-500'
                              : 'bg-zinc-200')
                        }
                        title={STATUS_LABEL[p] ?? p}
                      />
                    );
                  })}
                </div>

                <StageProgressBanner status={it.status} />

                {showFinalPreview && (
                  <FinalPreviewPanel
                    item={it}
                    busy={busyId === it.id}
                    onRegenerate={() => void onRegenerateMetadata(it.id)}
                    onSaved={(next) =>
                      setItems((prev) =>
                        prev ? prev.map((row) => (row.id === next.id ? { ...row, ...next } : row)) : prev,
                      )
                    }
                    onScriptSaved={(next) =>
                      setItems((prev) =>
                        prev ? prev.map((row) => (row.id === next.id ? { ...row, ...next } : row)) : prev,
                      )
                    }
                  />
                )}

                {!showFinalPreview && (hasOriginalPreview(it) || it.analysis || it.script) && (
                  <div className="mt-3 space-y-3 [overflow-anchor:none]">
                    <div
                      className={
                        'grid items-start gap-3 ' +
                        (hasOriginalPreview(it) ? 'md:grid-cols-[minmax(14rem,22rem)_minmax(0,1fr)]' : '')
                      }
                    >
                      {hasOriginalPreview(it) && (
                        <PipelineVideoFrame
                          label="Original"
                          itemId={it.id}
                          embedUrl={originalEmbedUrl(it)}
                          streamUrl={originalStreamUrl(it)}
                          poster={
                            !originalEmbedUrl(it) && it.hasThumbnail
                              ? contentThumbnailUrl(it.id)
                              : undefined
                          }
                        />
                      )}
                      <div className="min-w-0 space-y-3">
                        {it.analysis && (
                          <PipelineAccordion
                            id={`pre-analysis-${it.id}`}
                            title="Analysis"
                            defaultOpen={false}
                          >
                            <p className="max-h-72 overflow-auto whitespace-pre-wrap text-xs text-zinc-700">
                              {readableAiText(it.analysis)}
                            </p>
                          </PipelineAccordion>
                        )}
                        {it.script && (
                          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3">
                            <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                              Narration script
                            </div>
                            <NarrationScriptPanel
                              item={it}
                              busy={busyId === it.id}
                              layout="fluid"
                              onSaved={(next) =>
                                setItems((prev) =>
                                  prev
                                    ? prev.map((row) =>
                                        row.id === next.id ? { ...row, ...next } : row,
                                      )
                                    : prev,
                                )
                              }
                            />
                          </div>
                        )}
                        {!it.analysis && !it.script && hasOriginalPreview(it) && (
                          <p className="text-xs text-zinc-500">
                            Waiting for analysis and narration…
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        open={rerenderItem != null}
        onClose={() => {
          if (busyId) return;
          setRerenderItem(null);
        }}
        title="Re-render video"
        description={
          rerenderItem
            ? `Remix “${rerenderItem.title}” with the existing voiceover. Adjust background for this video only.`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRerenderItem(null)}
              disabled={busyId === rerenderItem?.id}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => void onConfirmRerender()}
              disabled={busyId === rerenderItem?.id}
            >
              {busyId === rerenderItem?.id ? 'Starting…' : 'Re-render'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <Label>Background music / ambience</Label>
            <span className="text-sm font-semibold tabular-nums text-zinc-800">
              {rerenderBedPercent}%
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={100}
            step={1}
            value={rerenderBedPercent}
            onChange={(e) =>
              setRerenderBedPercent(clampBackgroundBedPercent(e.target.value))
            }
            className="w-full accent-indigo-600"
            aria-label="Background level for this video"
            disabled={busyId === rerenderItem?.id}
          />
          <p className="text-[11px] text-zinc-500">
            1% = almost silent · 100% = full bed. Saved on this video only (channel Settings
            default is unchanged). TTS will not run again.
          </p>
        </div>
      </Modal>
    </div>
  );
}
