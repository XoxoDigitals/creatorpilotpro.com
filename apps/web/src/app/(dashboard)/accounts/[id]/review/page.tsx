'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { Route } from 'next';
import { useParams } from 'next/navigation';
import { ReviewList } from '@/components/review-list';
import {
  decideReview,
  deleteContent,
  deleteIdea,
  generateIdeaPackage,
  getIdeasView,
  getReviewView,
} from '@/lib/api-data';
import type { Idea, ReviewItem, ReviewStatus } from '@/lib/domain-types';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Field, Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';

/**
 * Mirrors IdeasService.findBlockingActiveIdea: one AI package at a time per
 * account, released only when its final video and thumbnail are both stored.
 */
function findBlockingIdea(ideas: Idea[]): Idea | null {
  return (
    ideas.find(
      (idea) =>
        (['GENERATING', 'READY', 'DONE'].includes(idea.packageStatus) ||
          idea.stage === 'IN_PRODUCTION') &&
        !['UPLOADED', 'PUBLISHED', 'REJECTED'].includes(idea.stage) &&
        !(idea.hasFinalVideo && idea.hasThumbnail),
    ) ?? null
  );
}

export default function AccountReviewPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [blocker, setBlocker] = useState<Idea | null>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedIdea, setSelectedIdea] = useState<Idea | null>(null);
  const [videoDurationSec, setVideoDurationSec] = useState(60);
  const [customVideoDuration, setCustomVideoDuration] = useState(false);
  const [clipDurationSec, setClipDurationSec] = useState<8 | 10 | 15 | 30>(10);
  const [starting, setStarting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ items: list, demo: isDemo }, ideasResult] = await Promise.all([
        // Exclude held/scheduled publish packages — those approve only on Review Queue.
        getReviewView(id, { excludeScheduled: true }),
        getIdeasView(id),
      ]);
      setItems(list);
      setIdeas(
        ideasResult.ideas.filter(
          (idea) => idea.stage === 'APPROVED' && idea.packageStatus === 'NONE',
        ),
      );
      setBlocker(findBlockingIdea(ideasResult.ideas));
      setDemo(isDemo);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDecide = demo
    ? undefined
    : async (item: ReviewItem, status: ReviewStatus) => {
        await decideReview(item.id, status);
        await load();
      };

  function openGeneration(idea: Idea) {
    setSelectedIdea(idea);
    const duration = idea.requestedVideoDurationSec ?? 60;
    setVideoDurationSec(duration);
    setCustomVideoDuration(duration !== 30 && duration !== 60);
    setClipDurationSec((idea.requestedClipDurationSec as 8 | 10 | 15) || 10);
  }

  async function startGeneration() {
    if (!selectedIdea) return;
    setStarting(true);
    try {
      await generateIdeaPackage(selectedIdea.id, { videoDurationSec, clipDurationSec });
      toast('Generation started — the idea is now on the AI tab.', 'success');
      setSelectedIdea(null);
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to start generation', 'error');
    } finally {
      setStarting(false);
    }
  }

  async function onDeleteIdea(idea: Idea) {
    if (demo) {
      toast('Connect a real account to delete ideas', 'info');
      return;
    }
    if (!confirm(`Delete idea “${idea.title}”?`)) return;
    setBusyId(idea.id);
    try {
      await deleteIdea(idea.id);
      toast('Idea deleted', 'success');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to delete idea', 'error');
    } finally {
      setBusyId(null);
    }
  }

  const onDeleteContent = demo
    ? undefined
    : async (item: ReviewItem) => {
        if (!confirm(`Delete video “${item.title}”?`)) return;
        await deleteContent(item.id);
        await load();
      };

  if (loading) return <p className="p-4 text-sm text-zinc-500">Loading review queue…</p>;

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">Approved ideas</h2>
          <p className="text-xs text-zinc-500">
            Start generation when an approved idea is ready for production.
          </p>
        </div>
        {blocker && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            “{blocker.title}” is still in production. Upload its final video and thumbnail on the{' '}
            <Link href={`/accounts/${id}/ai` as Route} className="font-medium underline">
              AI tab
            </Link>{' '}
            before starting generation on another idea.
          </div>
        )}
        {ideas.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500">
            No approved ideas are waiting for generation.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {ideas.map((idea) => (
              <div key={idea.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-zinc-900">{idea.title}</p>
                  {idea.viralScore != null && (
                    <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800">
                      Viral {idea.viralScore}
                    </span>
                  )}
                </div>
                {idea.topicSummary?.trim() ? (
                  <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{idea.topicSummary.trim()}</p>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => openGeneration(idea)}
                    disabled={demo || !!blocker}
                    title={
                      blocker
                        ? `Upload the final video and thumbnail for “${blocker.title}” first.`
                        : undefined
                    }
                  >
                    Start Generation
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={demo || busyId === idea.id}
                    onClick={() => void onDeleteIdea(idea)}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-900">Content review</h2>
        <ReviewList
          items={items}
          onDecide={onDecide}
          onDelete={onDeleteContent}
          emptyHint="Ingested sources and pre-pipeline content for this account queue here. Scheduled packages for publish approval appear on Review Queue."
        />
      </section>

      <Modal
        open={!!selectedIdea}
        onClose={() => !starting && setSelectedIdea(null)}
        title="Start Generation"
        description={selectedIdea?.title}
        footer={
          <div className="flex justify-end gap-2">
            <Button size="sm" onClick={() => setSelectedIdea(null)} disabled={starting}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => void startGeneration()}
              disabled={starting}
            >
              {starting ? 'Starting…' : 'Generate Video'}
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label="Total video duration">
            <div className="flex flex-wrap gap-2">
              {([30, 60] as const).map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => {
                    setVideoDurationSec(seconds);
                    setCustomVideoDuration(false);
                  }}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    !customVideoDuration && videoDurationSec === seconds
                      ? 'border-zinc-900 bg-zinc-900 text-white'
                      : 'border-zinc-200 bg-white text-zinc-700'
                  }`}
                >
                  {seconds}s
                </button>
              ))}
              <button
                type="button"
                onClick={() => setCustomVideoDuration(true)}
                className={`rounded-md border px-3 py-1.5 text-sm ${
                  customVideoDuration
                    ? 'border-zinc-900 bg-zinc-900 text-white'
                    : 'border-zinc-200 bg-white text-zinc-700'
                }`}
              >
                Custom
              </button>
            </div>
            {customVideoDuration && (
              <Input
                className="mt-2"
                type="number"
                min={15}
                max={600}
                value={videoDurationSec}
                onChange={(event) => setVideoDurationSec(Number(event.target.value) || 60)}
              />
            )}
          </Field>
          <Field label="Clip duration">
            <div className="flex gap-2">
              {([8, 10, 15, 30] as const).map((seconds) => (
                <button
                  key={seconds}
                  type="button"
                  onClick={() => setClipDurationSec(seconds)}
                  className={`rounded-md border px-3 py-1.5 text-sm ${
                    clipDurationSec === seconds
                      ? 'border-zinc-900 bg-zinc-900 text-white'
                      : 'border-zinc-200 bg-white text-zinc-700'
                  }`}
                >
                  {seconds}s
                </button>
              ))}
            </div>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
