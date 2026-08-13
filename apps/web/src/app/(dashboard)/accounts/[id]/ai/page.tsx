'use client';

/**
 * AI pipeline queue for one account. Content items live here after Review approval
 * and before Publish; the SCRIPT_READY row exposes the second human gate (script
 * approval). At RENDERED / METADATA_READY the row shows the final video preview
 * and platform publish metadata (title / description / tags).
 */
import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { MediaEmbed } from '@/components/media-embed';
import { relativeTime } from '@/lib/format';
import { ApiError } from '@/lib/api';
import {
  approveScript,
  contentMediaUrl,
  contentThumbnailUrl,
  getAiPipeline,
  regenerateMetadata,
  resetToReview,
  retryAi,
  updatePublishMetadata,
  type AiPipelineItem,
} from '@/lib/api-data';
import { IdeaPackagesPanel } from '@/components/idea-packages-panel';

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
  SCRIPT_APPROVED: 'Script approved',
  TTS_DONE: 'Narration rendered',
  RENDERED: 'Render ready',
  METADATA_READY: 'Metadata ready',
  FAILED: 'Failed',
};

const STATUS_TONE: Record<string, 'neutral' | 'indigo' | 'sky' | 'amber' | 'green' | 'red'> = {
  APPROVED: 'neutral',
  ANALYZING: 'sky',
  SCRIPT_READY: 'amber',
  SCRIPT_APPROVED: 'green',
  TTS_DONE: 'indigo',
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

function FinalPreviewPanel({
  item,
  onSaved,
  onRegenerate,
  busy,
}: {
  item: AiPipelineItem;
  onSaved: (next: AiPipelineItem) => void;
  onRegenerate: () => void;
  busy: boolean;
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

  return (
    <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <div className="space-y-3">
        <div className="overflow-hidden rounded-md border border-zinc-200 bg-zinc-950">
          {hasVideo ? (
            <MediaEmbed
              key={item.id}
              kind="video"
              embedUrl={item.videoEmbedUrl}
              streamUrl={contentMediaUrl(item.id)}
              poster={
                !item.videoEmbedUrl && item.hasThumbnail && !thumbBroken
                  ? contentThumbnailUrl(item.id)
                  : undefined
              }
              className="aspect-video w-full border-0 bg-black"
            />
          ) : (
            <div className="flex aspect-video items-center justify-center bg-zinc-100 text-sm text-zinc-500">
              Final video not available yet
            </div>
          )}
        </div>
        {item.hasThumbnail && !thumbBroken && (
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
              Thumbnail
            </p>
            <MediaEmbed
              kind="image"
              embedUrl={item.thumbnailEmbedUrl}
              streamUrl={contentThumbnailUrl(item.id)}
              className="max-h-36 rounded-md border border-zinc-200 object-contain"
              title="Thumbnail"
            />
          </div>
        )}
      </div>

      <div className="space-y-3">
        {showMetadataEditor ? (
          <>
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
          </>
        ) : (
          <div className="rounded-md border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
            Final video is ready. Metadata generation runs next — title, description, and tags
            tailored to {platformLabel(item.platform)} will appear here.
          </div>
        )}
      </div>
    </div>
  );
}

export default function AccountAiPipelinePage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [items, setItems] = useState<AiPipelineItem[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    // Poll while jobs are running — cheap, and the user needs to see phase changes.
    const t = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(t);
  }, [refresh]);

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
        <Card>
        <CardHeader
          title="AI pipeline"
          description="Analyze → Narrate → Approve script → TTS → Render → Metadata. Human gate at Script ready."
        />
        <div className="divide-y divide-zinc-100">
          {items.map((it) => {
            const phaseIdx = PHASE_ORDER.indexOf(it.status);
            const showFinalPreview =
              it.status === 'RENDERED' || it.status === 'METADATA_READY';
            const displayTitle =
              it.status === 'METADATA_READY' && it.publishTitle
                ? it.publishTitle
                : it.title;
            return (
              <div key={it.id} className="px-4 py-3">
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
                        >
                          Approve script
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void onSendBackToReview(it.id)}
                          disabled={busyId === it.id}
                          title="Clear analysis/script and send back to Review. Re-approve to re-run Analyze → Narrate with current prompts."
                        >
                          Regenerate
                        </Button>
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
                  </div>
                </div>

                {/* phase rail */}
                <div className="mt-2 grid grid-cols-7 gap-1">
                  {PHASE_ORDER.map((p, i) => (
                    <div
                      key={p}
                      className={
                        'h-1 rounded-full ' +
                        (phaseIdx >= 0 && i <= phaseIdx ? 'bg-blue-500' : 'bg-zinc-200')
                      }
                      title={STATUS_LABEL[p] ?? p}
                    />
                  ))}
                </div>

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
                  />
                )}

                {/* preview of AI outputs so the reviewer knows what they're approving */}
                {(it.analysis || it.script) && !showFinalPreview && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    {it.analysis && (
                      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2">
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                          Analysis
                        </div>
                        <p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-zinc-700">
                          {readableAiText(it.analysis)}
                        </p>
                      </div>
                    )}
                    {it.script && (
                      <div className="rounded-md border border-zinc-200 bg-zinc-50 p-2">
                        <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                          Narration script
                        </div>
                        <p className="max-h-40 overflow-auto whitespace-pre-wrap text-xs text-zinc-700">
                          {readableAiText(it.script)}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        </Card>
      )}
    </div>
  );
}
