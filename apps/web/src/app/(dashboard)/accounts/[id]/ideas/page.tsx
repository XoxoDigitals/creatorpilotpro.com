'use client';

import { useParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { getIdeas } from '@/lib/mock-data';
import type { Idea, IdeaStage } from '@/lib/domain-types';

const STAGES: { key: IdeaStage; label: string }[] = [
  { key: 'SUGGESTED', label: 'Suggested' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'IN_PRODUCTION', label: 'In production' },
  { key: 'UPLOADED', label: 'Uploaded' },
  { key: 'PUBLISHED', label: 'Published' },
];

export default function AccountIdeasPage() {
  const { id } = useParams<{ id: string }>();
  const ideas = getIdeas(id);
  const toast = useToast();

  if (ideas.length === 0) {
    return (
      <EmptyState
        title="No ideas yet"
        hint="Add competitor channels in account settings — the research engine generates original ideas from their recent uploads (arrives in Phase 4)."
        cta={
          <Button
            variant="primary"
            size="sm"
            onClick={() => toast('Idea generation arrives in Phase 4', 'info')}
          >
            Generate ideas
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Approve ideas to generate full production briefs for your team.
        </p>
        <Button
          variant="primary"
          size="sm"
          onClick={() => toast('Idea generation arrives in Phase 4', 'info')}
        >
          Generate ideas
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {STAGES.map((stage) => {
          const column = ideas.filter((i) => i.stage === stage.key);
          return (
            <div key={stage.key} className="rounded-lg bg-zinc-100/70 p-2">
              <p className="flex items-center justify-between px-1 pb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">
                {stage.label}
                <span className="nums rounded-full bg-zinc-200 px-1.5 text-[10px]">{column.length}</span>
              </p>
              <div className="space-y-2">
                {column.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea} />
                ))}
                {column.length === 0 && (
                  <p className="px-1 py-3 text-center text-xs text-zinc-400">—</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function IdeaCard({ idea }: { idea: Idea }) {
  const scoreTone = idea.predictedScore >= 85 ? 'green' : idea.predictedScore >= 70 ? 'amber' : 'neutral';
  return (
    <div className="rounded-md border border-zinc-200 bg-white p-3 shadow-sm">
      <p className="text-[13px] font-medium leading-snug text-zinc-900">{idea.title}</p>
      <p className="mt-1 text-xs text-zinc-500">{idea.angle}</p>
      <p className="mt-1 text-xs italic text-zinc-400">{idea.hook}</p>
      <div className="mt-2">
        <Badge tone={scoreTone} className="nums">
          score {idea.predictedScore}
        </Badge>
      </div>
    </div>
  );
}
