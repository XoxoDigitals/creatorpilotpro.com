/** Presentation helpers shared across pages. */

/** Compact number: 184300 → "184.3K", 2410000 → "2.4M". */
export function compactNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

/** Relative time from an ISO string: "in 2h", "3d ago", "just now". */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.parse(iso) - Date.now();
  const abs = Math.abs(diff);
  const min = 60_000;
  const hour = 60 * min;
  const day = 24 * hour;
  const fmt = (v: number, unit: string) => `${Math.round(v)}${unit}`;
  let text: string;
  if (abs < min) return 'just now';
  else if (abs < hour) text = fmt(abs / min, 'm');
  else if (abs < day) text = fmt(abs / hour, 'h');
  else text = fmt(abs / day, 'd');
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}

/** Absolute timestamp for title/hover tooltips. */
export function absoluteTime(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

export function duration(sec: number | null): string {
  if (sec == null) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
