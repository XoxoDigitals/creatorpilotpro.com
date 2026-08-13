import { cn } from '@/lib/cn';
import { ROLE_LABELS, type Role } from '@/lib/types';

// Light-friendly chips that also read on the dark sidebar footer.
const STYLES: Record<Role, string> = {
  OWNER: 'bg-amber-100 text-amber-800 border-amber-200',
  ADMIN: 'bg-indigo-100 text-indigo-800 border-indigo-200',
  REVIEWER: 'bg-sky-100 text-sky-800 border-sky-200',
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
      {ROLE_LABELS[role]}
    </span>
  );
}
