'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { api } from '@/lib/api';
import { isSystemAdmin, type SessionUser } from '@/lib/types';

const ADMIN_TABS = [
  { href: '/settings', label: 'General' },
  { href: '/settings/platform-apps', label: 'Platform Apps' },
  { href: '/settings/ai', label: 'AI Providers & Keys' },
  { href: '/settings/playground', label: 'AI Playground' },
  { href: '/settings/costs', label: 'AI Costs' },
  { href: '/settings/notifications', label: 'Notifications' },
  { href: '/settings/users', label: 'Users' },
  { href: '/settings/password', label: 'Password' },
] as const;

const LIMITED_TABS = [{ href: '/settings/password', label: 'Password' }] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .get<{ user: SessionUser }>('/auth/me')
      .then(({ user: me }) => {
        if (alive) setUser(me);
      })
      .catch(() => {
        if (alive) setUser(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  const admin = user ? isSystemAdmin(user.role) : false;
  const tabs = !user ? [] : admin ? ADMIN_TABS : LIMITED_TABS;

  useEffect(() => {
    if (!user) return;
    if (isSystemAdmin(user.role)) return;
    // Non-admin: only password settings are allowed.
    if (pathname !== '/settings/password') {
      router.replace('/settings/password');
    }
  }, [user, pathname, router]);

  return (
    <div>
      <PageHeader
        title="Settings"
        description={
          admin || !user
            ? 'General (TTS, disk, Google Drive), Platform Apps, AI providers, notifications, and team'
            : 'Change your account password'
        }
      />

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-zinc-200">
        {tabs.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`-mb-px border-b-2 px-3 py-2 text-sm transition-colors ${
                active
                  ? 'border-indigo-600 font-medium text-indigo-700'
                  : 'border-transparent text-zinc-500 hover:text-zinc-800'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div>{children}</div>
    </div>
  );
}
