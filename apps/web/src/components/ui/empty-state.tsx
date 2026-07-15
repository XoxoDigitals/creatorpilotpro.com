import type { ReactNode } from 'react';

export function EmptyState({
  icon,
  title,
  hint,
  cta,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  cta?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 px-6 py-12 text-center">
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-zinc-500">{hint}</p>}
      {cta && <div className="mt-4">{cta}</div>}
    </div>
  );
}
