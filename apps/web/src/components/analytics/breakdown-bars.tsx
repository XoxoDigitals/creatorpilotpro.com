import { compactNumber } from '@/lib/format';

interface Row {
  label: string;
  pct: number;
  extra?: string | number;
}

/**
 * Simple horizontal bar chart for percent-based breakdowns
 * (traffic countries, age groups, sources, device split).
 */
export function BreakdownBars({
  title,
  rows,
  emptyLabel = 'No data yet',
  max = 8,
}: {
  title: string;
  rows: Row[];
  emptyLabel?: string;
  max?: number;
}) {
  const sorted = [...rows].sort((a, b) => b.pct - a.pct).slice(0, max);
  if (sorted.length === 0) {
    return (
      <div>
        <p className="mb-2 text-xs font-medium text-zinc-600">{title}</p>
        <p className="text-xs text-zinc-400">{emptyLabel}</p>
      </div>
    );
  }
  const maxPct = Math.max(...sorted.map((r) => r.pct), 1);
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-zinc-600">{title}</p>
      <div className="space-y-1.5">
        {sorted.map((r) => (
          <div key={r.label} className="flex items-center gap-2 text-xs">
            <span className="w-16 shrink-0 truncate text-zinc-600">{r.label}</span>
            <div className="relative h-4 flex-1 overflow-hidden rounded bg-zinc-100">
              <div
                className="h-full rounded bg-indigo-500/80 transition-[width]"
                style={{ width: `${(r.pct / maxPct) * 100}%` }}
              />
            </div>
            <span className="nums w-16 shrink-0 text-right text-zinc-500">
              {r.pct.toFixed(1)}%
              {r.extra != null && (
                <span className="ml-1 text-zinc-400">
                  ({typeof r.extra === 'number' ? compactNumber(r.extra) : r.extra})
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
