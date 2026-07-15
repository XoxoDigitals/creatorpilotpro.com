import { cn } from '@/lib/cn';
import type { Role } from '@/lib/types';

// Light-friendly chips that also read on the dark sidebar footer.
const STYLES: Record<Role, string> = {
  OWNER: 'bg-amber-100 text-amber-800 border-amber-200',
  ADMIN: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  REVIEWER: 'bg-sky-100 text-sky-800 border-sky-200',
  WORKER: 'bg-zinc-200 text-zinc-700 border-zinc-300',
  ANALYST: 'bg-emerald-100 text-emerald-800 border-emerald-200',
};

export function RoleBadge({ role, className }: { role: Role; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
        STYLES[role],
        className,
      )}
    >
      {role}
    </span>
  );
}
