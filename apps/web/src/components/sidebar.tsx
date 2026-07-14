'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { RoleBadge } from '@/components/role-badge';
import type { SessionUser } from '@/lib/types';

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

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  const [signingOut, setSigningOut] = useState(false);

  // Poll unread notification count every 60s (docs task #5).
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { count } = await api.get<{ count: number }>('/notifications/unread-count');
        if (alive) setUnread(count);
      } catch {
        /* ignore transient errors */
      }
    };
    void load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    try {
      await api.post('/auth/logout');
    } catch {
      /* ignore */
    }
    window.location.href = '/login';
  }

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-slate-800 bg-slate-950/80">
      <div className="flex h-14 items-center justify-between border-b border-slate-800 px-4">
        <Link href="/dashboard" className="text-sm font-semibold tracking-wide text-slate-100">
          SocialCreatorPilot
        </Link>
        <Link
          href="/incidents"
          title={`${unread} unread notifications`}
          className="relative text-slate-400 hover:text-slate-200"
          aria-label="Notifications"
        >
          <span className="text-base">🔔</span>
          {unread > 0 && (
            <span className="absolute -right-2 -top-1 flex min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
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

      <div className="space-y-2 border-t border-slate-800 p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-medium text-slate-200">{user.name ?? user.email}</p>
            <p className="truncate text-[11px] text-slate-500">{user.email}</p>
          </div>
          <RoleBadge role={user.role} />
        </div>
        <button
          type="button"
          onClick={signOut}
          disabled={signingOut}
          className="w-full rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800/60 disabled:opacity-60"
        >
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
      </div>
    </aside>
  );
}
