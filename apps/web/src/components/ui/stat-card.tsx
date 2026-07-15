import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface StatCardProps {
  label: string;
  value: ReactNode;
  /** Signed delta, e.g. +4.2% — arrow + color inferred from the leading sign. */
  delta?: string;
  hint?: string;
  icon?: ReactNode;
}

export function StatCard({ label, value, delta, hint, icon }: StatCardProps) {
  const down = delta?.trim().startsWith('-');
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-500">{label}</p>
        {icon && <span className="text-zinc-400">{icon}</span>}
      </div>
      <p className="nums mt-2 text-2xl font-semibold tracking-tight text-zinc-900">{value}</p>
      <div className="mt-1 flex items-center gap-1.5">
        {delta && (
          <span
            className={cn(
              'nums inline-flex items-center gap-0.5 text-xs font-medium',
              down ? 'text-red-600' : 'text-green-600',
            )}
          >
            {down ? '▾' : '▴'} {delta.replace(/^[+-]/, '')}
          </span>
        )}
        {hint && <span className="text-xs text-zinc-400">{hint}</span>}
      </div>
    </div>
  );
}
