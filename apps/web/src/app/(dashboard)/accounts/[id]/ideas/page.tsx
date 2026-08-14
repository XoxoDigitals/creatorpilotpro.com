'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import {
  approveIdea,
  generateIdeas,
  getCompetitorsView,
  getIdeasGenerationStatus,
  getIdeasView,
  rejectIdea,
  deleteIdea,
  type IdeaGenerationStatus,
} from '@/lib/api-data';
import type { CompetitorChannel, Idea } from '@/lib/domain-types';
import { ReferenceChannelsPanel } from '@/components/reference-channels-panel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

const TOPIC_SEED_MAX = 2000;

const GENERATION_POLL_MS = 2_500;
const GENERATION_TIMEOUT_MS = 5 * 60 * 1000;

const IDLE_GENERATION: IdeaGenerationStatus = {
  runId: null,
  status: 'idle',
  createdAt: null,
  startedAt: null,
  finishedAt: null,
  error: null,
};

function withClientTimeout(status: IdeaGenerationStatus): IdeaGenerationStatus {
  if (
    (status.status === 'queued' || status.status === 'running') &&
    status.createdAt &&
    Date.now() - new Date(status.createdAt).getTime() >= GENERATION_TIMEOUT_MS
  ) {
    return {
      ...status,
      status: 'failed',
      error: 'Idea generation timed out after 5 minutes. You can try again.',
    };
  }
  return status;
}

export default function AccountIdeasPage() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const toast = useToast();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [refs, setRefs] = useState<CompetitorChannel[]>([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState<IdeaGenerationStatus>(IDLE_GENERATION);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [onboardHint, setOnboardHint] = useState(false);
  const [topicSeed, setTopicSeed] = useState('');

  const load = useCallback(async () => {
    try {
      const [ideasResult, compsResult] = await Promise.all([
        getIdeasView(id),
        getCompetitorsView(id),
      ]);
      setIdeas(ideasResult.ideas.filter((idea) => idea.stage === 'SUGGESTED'));
      setDemo(ideasResult.demo);
      setRefs(compsResult.competitors);
      if (!ideasResult.demo) {
        setGeneration(withClientTimeout(await getIdeasGenerationStatus(id)));
      }
    } catch {
      toast('Failed to load ideas', 'error');
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (searchParams.get('onboard') === 'refs') setOnboardHint(true);
  }, [searchParams]);

  const generationPending =
    generation.status === 'queued' || generation.status === 'running';

  useEffect(() => {
    if (!generationPending) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const next = withClientTimeout(await getIdeasGenerationStatus(id));
        if (cancelled) return;
        setGeneration(next);
        if (next.status === 'succeeded') {
          await load();
        }
      } catch {
        // A transient polling error should not unlock the action. The next poll
        // can recover, and the client-side five-minute deadline still applies.
      }
    };
    const timer = window.setInterval(() => void poll(), GENERATION_POLL_MS);
    void poll();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [generationPending, id, load]);

  async function startGeneration(seed?: string) {
    if (generationPending) return;
    if (demo) {
      toast('Connect a real account and add reference channels to generate ideas', 'info');
      return;
    }
    if (refs.length === 0) {
      toast('Add at least one YouTube reference channel first', 'info');
      return;
    }
    const trimmedSeed = seed?.trim();
    if (seed !== undefined && !trimmedSeed) {
      toast('Enter a topic seed first', 'info');
      return;
    }
    setGeneration({
      runId: null,
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      error: null,
    });
    try {
      const { runId } = await generateIdeas(
        id,
        50,
        trimmedSeed ? { topicSeed: trimmedSeed } : undefined,
      );
      const status = withClientTimeout(await getIdeasGenerationStatus(id));
      setGeneration({ ...status, runId: status.runId ?? runId });
      toast(
        trimmedSeed ? 'Idea generation started from your topic seed' : 'Idea generation started',
        'success',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start idea generation';
      setGeneration({
        ...IDLE_GENERATION,
        status: 'failed',
        error: message,
        finishedAt: new Date().toISOString(),
      });
      toast(message, 'error');
    }
  }

  async function handleGenerate() {
    await startGeneration();
  }

  async function handleGenerateFromSeed() {
    await startGeneration(topicSeed);
  }

  async function handleApprove(ideaId: string) {
    if (demo) {
      toast('Demo mode — connect a real account to approve ideas', 'info');
      return;
    }
    setBusyId(ideaId);
    try {
      await approveIdea(ideaId);
      setIdeas((current) => current.filter((idea) => idea.id !== ideaId));
      toast('Approved — the idea is now on the Review tab', 'success');
    } catch {
      toast('Failed to approve idea', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(ideaId: string) {
    if (demo) {
      toast('Demo mode — connect a real account to reject ideas', 'info');
      return;
    }
    setBusyId(ideaId);
    try {
      await rejectIdea(ideaId);
      setIdeas((current) => current.filter((idea) => idea.id !== ideaId));
      toast('Idea rejected', 'success');
    } catch {
      toast('Failed to reject idea', 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(ideaId: string, title: string) {
    if (demo) {
      toast('Demo mode — connect a real account to delete ideas', 'info');
      return;
    }
    if (!confirm(`Delete topic “${title}”? This hides it from the ideas list.`)) return;
    setBusyId(ideaId);
    try {
      await deleteIdea(ideaId);
      setIdeas((current) => current.filter((idea) => idea.id !== ideaId));
      toast('Topic deleted', 'success');
    } catch {
      toast('Failed to delete idea', 'error');
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {demo && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo data — connect a real account to use the AI idea engine.
        </div>
      )}
      {onboardHint && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900">
          Account connected. Add YouTube reference channels below, then generate ideas.
          <button type="button" className="ml-2 underline" onClick={() => setOnboardHint(false)}>
            Dismiss
          </button>
        </div>
      )}

      <ReferenceChannelsPanel
        accountId={id}
        demo={demo}
        channels={refs}
        onChanged={() => void load()}
      />

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-zinc-900">Seed your own topic</h2>
        <p className="mt-1 text-xs text-zinc-500">
          Optional. Ideas expand on your seed while matching reference-channel title style and your
          channel profile.
        </p>
        <div className="mt-3 space-y-3">
          <Field label="Topic seed">
            <Textarea
              value={topicSeed}
              onChange={(e) => setTopicSeed(e.target.value.slice(0, TOPIC_SEED_MAX))}
              placeholder='e.g. "forgotten WWII submarine mysteries" or "why airports change runway numbers"'
              rows={3}
              disabled={generationPending || demo}
              maxLength={TOPIC_SEED_MAX}
            />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-zinc-400">
              {topicSeed.trim().length}/{TOPIC_SEED_MAX}
            </p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void handleGenerateFromSeed()}
              disabled={generationPending || !topicSeed.trim()}
            >
              {generationPending ? 'Generating…' : 'Generate from seed'}
            </Button>
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">Approve a suggestion to move it to the Review tab.</p>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleGenerate()}
          disabled={generationPending}
        >
          {generationPending ? 'Generating…' : 'Generate 50 ideas'}
        </Button>
      </div>

      {generationPending && (
        <div
          className="overflow-hidden rounded-lg border border-indigo-200 bg-indigo-50"
          role="status"
          aria-live="polite"
        >
          <div className="h-1.5 overflow-hidden bg-indigo-100">
            <div className="h-full w-2/3 animate-pulse rounded-full bg-indigo-500" />
          </div>
          <div className="px-4 py-3">
            <p className="text-sm font-medium text-indigo-950">
              {generation.status === 'queued' ? 'Idea generation is queued…' : 'Generating ideas…'}
            </p>
            <p className="mt-0.5 text-xs text-indigo-700">
              This can take a minute. New ideas will appear automatically.
            </p>
          </div>
        </div>
      )}

      {generation.status === 'failed' && generation.error && (
        <div
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
          role="alert"
        >
          <p className="font-medium">Idea generation failed</p>
          <p className="mt-0.5 text-xs text-red-700">{generation.error}</p>
        </div>
      )}

      {ideas.length === 0 ? (
        <EmptyState
          title="No suggested ideas"
          hint="Add YouTube reference channels above, then generate ideas from their recent uploads."
          cta={
            <Button
              variant="primary"
              size="sm"
              onClick={() => void handleGenerate()}
              disabled={generationPending}
            >
              {generationPending ? 'Generating…' : 'Generate 50 ideas'}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {ideas.map((idea) => (
            <article
              key={idea.id}
              className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-sm font-medium leading-snug text-zinc-900">{idea.title}</h2>
                {idea.viralScore != null && (
                  <Badge tone="amber" className="shrink-0 text-[10px]">
                    Viral {idea.viralScore}
                  </Badge>
                )}
              </div>
              <div className="mt-3 flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void handleApprove(idea.id)}
                  disabled={busyId === idea.id}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleReject(idea.id)}
                  disabled={busyId === idea.id}
                >
                  Reject
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => void handleDelete(idea.id, idea.title)}
                  disabled={busyId === idea.id}
                >
                  Delete
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
