'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

/** Routes from docs/02 §3 — one nav entry per dashboard area. */
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/accounts', label: 'Accounts' },
  { href: '/sources', label: 'Sources' },
  { href: '/review', label: 'Review' },
  { href: '/ideas', label: 'Ideas' },
  { href: '/dramas', label: 'Dramas' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/incidents', label: 'Incidents' },
  { href: '/workers', label: 'Workers' },
  { href: '/settings', label: 'Settings' },
] as const;

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80">
      <div className="flex h-14 items-center border-b border-slate-800 px-4">
        <Link href="/dashboard" className="text-sm font-semibold tracking-wide text-slate-100">
          SocialCreatorPilot
        </Link>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`block rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-indigo-600/20 font-medium text-indigo-300'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t border-slate-800 p-3">
        <Link href="/login" className="block text-xs text-slate-500 hover:text-slate-300">
          Sign out (task #4)
        </Link>
      </div>
    </aside>
  );
}
