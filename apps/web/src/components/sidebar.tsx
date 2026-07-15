'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { RoleBadge } from '@/components/role-badge';
import { ConnectWizard } from '@/components/connect-wizard';
import { Avatar } from '@/components/ui/avatar';
import { getAccounts, getRollups } from '@/lib/mock-data';
import type { SessionUser } from '@/lib/types';

/** Minimal stroke icons for the global nav. */
const ICONS: Record<string, ReactNode> = {
  dashboard: <path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z" />,
  calendar: <path d="M7 3v3m10-3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" />,
  review: <path d="M9 11l3 3 6-6M4 6h9M4 12h4M4 18h7" />,
  incidents: <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />,
  workers: <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm14 10v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />,
  accounts: <path d="M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm12.5 0v7M13 16.5h7" />,
  analytics: <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />,
  settings: <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 12H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 5L4.5 5a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8Z" />,
  connect: <path d="M12 5v14M5 12h14" />,
  collapse: <path d="M15 18l-6-6 6-6" />,
  logout: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  bell: <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />,
};

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONS[name]}
    </svg>
  );
}

export function Sidebar({ user }: { user: SessionUser }) {
  const pathname = usePathname();
  const rollups = getRollups();
  const accounts = getAccounts();

  const [unread, setUnread] = useState(0);
  const [signingOut, setSigningOut] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Auto-collapse on narrow viewports (docs/11 §5 responsive).
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const apply = () => setCollapsed(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  // Poll unread notification count every 60s (existing behavior preserved).
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

  const globalNav = [
    { href: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { href: '/calendar', label: 'Calendar', icon: 'calendar' },
    { href: '/review', label: 'Review Queue', icon: 'review', badge: rollups.pendingReviews },
    { href: '/incidents', label: 'Incidents', icon: 'incidents', badge: rollups.openIncidents },
    { href: '/workers', label: 'Workers', icon: 'workers' },
    { href: '/analytics', label: 'Analytics', icon: 'analytics' },
  ] as const;

  return (
    <aside
      className={cn(
        'flex shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 text-zinc-300 transition-[width]',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      {/* Brand + collapse */}
      <div className="flex h-14 items-center justify-between px-3">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-2 px-1">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-indigo-600 text-sm font-bold text-white">
              S
            </span>
            <span className="text-sm font-semibold text-white">SocialCreatorPilot</span>
          </Link>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className={cn('block transition-transform', collapsed && 'rotate-180')}>
            <Icon name="collapse" size={16} />
          </span>
        </button>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-2">
        {/* GLOBAL */}
        <NavSection label="Global" collapsed={collapsed}>
          {globalNav.map((item) => (
            <NavLink
              key={item.href}
              href={item.href}
              label={item.label}
              icon={<Icon name={item.icon} />}
              badge={'badge' in item ? item.badge : undefined}
              active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              collapsed={collapsed}
            />
          ))}
        </NavSection>

        {/* ACCOUNTS — dedicated pages; the full platform-grouped directory lives at /accounts */}
        <NavSection label="Accounts" collapsed={collapsed}>
          <NavLink
            href="/accounts"
            label="All accounts"
            icon={<Icon name="accounts" />}
            badge={accounts.length}
            active={pathname === '/accounts' || pathname.startsWith('/accounts/')}
            collapsed={collapsed}
          />
          <button
            onClick={() => setWizardOpen(true)}
            title={collapsed ? 'Connect account' : undefined}
            className={cn(
              'mt-1 flex w-full items-center gap-2.5 rounded-md border border-dashed border-zinc-700 px-2 py-1.5 text-[13px] text-zinc-400 hover:border-indigo-500 hover:text-indigo-300',
              collapsed && 'justify-center',
            )}
          >
            <Icon name="connect" size={16} />
            {!collapsed && <span>Connect account</span>}
          </button>
        </NavSection>

        {/* SYSTEM */}
        <NavSection label="System" collapsed={collapsed}>
          <NavLink
            href="/settings"
            label="Settings"
            icon={<Icon name="settings" />}
            active={pathname === '/settings' || pathname.startsWith('/settings/')}
            collapsed={collapsed}
          />
        </NavSection>
      </nav>

      {/* Footer: user + bell + logout */}
      <div className="border-t border-zinc-800 p-2">
        <div className={cn('flex items-center gap-2', collapsed && 'flex-col')}>
          <div className={cn('flex min-w-0 items-center gap-2', collapsed ? 'w-full justify-center' : 'flex-1')}>
            <Avatar name={user.name ?? user.email} size="sm" />
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-zinc-100">{user.name ?? user.email}</p>
                <RoleBadge role={user.role} className="mt-0.5" />
              </div>
            )}
          </div>
          <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
            <Link
              href="/incidents"
              title={`${unread} unread notifications`}
              aria-label="Notifications"
              className="relative rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              <Icon name="bell" size={16} />
              {unread > 0 && (
                <span className="nums absolute -right-0.5 -top-0.5 flex min-w-[15px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
            </Link>
            <button
              onClick={signOut}
              disabled={signingOut}
              title="Sign out"
              aria-label="Sign out"
              className="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:opacity-60"
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </div>

      <ConnectWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </aside>
  );
}

function NavSection({
  label,
  collapsed,
  children,
}: {
  label: string;
  collapsed: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      {!collapsed && (
        <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

function NavLink({
  href,
  label,
  icon,
  badge,
  active,
  collapsed,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: number;
  active: boolean;
  collapsed: boolean;
}) {
  return (
    <Link
      href={href as Route}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[13px] transition-colors',
        collapsed && 'justify-center',
        active
          ? 'bg-indigo-600/15 font-medium text-indigo-300'
          : 'text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100',
      )}
    >
      <span className="shrink-0">{icon}</span>
      {!collapsed && <span className="flex-1">{label}</span>}
      {!collapsed && typeof badge === 'number' && badge > 0 && (
        <span className="nums rounded-full bg-zinc-700 px-1.5 text-[10px] font-semibold text-zinc-100">
          {badge}
        </span>
      )}
    </Link>
  );
}
