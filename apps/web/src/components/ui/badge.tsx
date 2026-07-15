import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { ContentType } from '@/lib/domain-types';

export type BadgeTone =
  | 'neutral'
  | 'indigo'
  | 'green'
  | 'amber'
  | 'red'
  | 'violet'
  | 'sky';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-zinc-100 text-zinc-600 border-zinc-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  green: 'bg-green-50 text-green-700 border-green-200',
  amber: 'bg-amber-50 text-amber-700 border-amber-200',
  red: 'bg-red-50 text-red-700 border-red-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  sky: 'bg-sky-50 text-sky-700 border-sky-200',
};

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** AI = violet, REPURPOSED = sky, MIXED = indigo (docs/11 §2). */
export function ContentTypeBadge({ type }: { type: ContentType }) {
  const map: Record<ContentType, { tone: BadgeTone; label: string }> = {
    AI: { tone: 'violet', label: 'AI' },
    REPURPOSED: { tone: 'sky', label: 'Repurposed' },
    MIXED: { tone: 'indigo', label: 'Mixed' },
  };
  const { tone, label } = map[type];
  return <Badge tone={tone}>{label}</Badge>;
}
