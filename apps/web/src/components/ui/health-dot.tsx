import { cn } from '@/lib/cn';
import type { HealthStatus } from '@/lib/domain-types';

const MAP: Record<HealthStatus, { color: string; label: string }> = {
  HEALTHY: { color: 'bg-green-500', label: 'Healthy' },
  WARNING: { color: 'bg-amber-500', label: 'Needs attention' },
  CRITICAL: { color: 'bg-red-500', label: 'Critical' },
};

export function HealthDot({
  status,
  label,
  className,
}: {
  status: HealthStatus;
  /** Show the text label alongside the dot. */
  label?: boolean;
  className?: string;
}) {
  const { color, label: text } = MAP[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={text}>
      <span className={cn('inline-block h-2 w-2 shrink-0 rounded-full', color)} />
      {label && <span className="text-xs text-zinc-600">{text}</span>}
    </span>
  );
}
