import type { Role } from '@/lib/types';

const STYLES: Record<Role, string> = {
  OWNER: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  ADMIN: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  REVIEWER: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  WORKER: 'bg-slate-500/15 text-slate-300 border-slate-500/30',
  ANALYST: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

export function RoleBadge({ role }: { role: Role }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STYLES[role]}`}
    >
      {role}
    </span>
  );
}
