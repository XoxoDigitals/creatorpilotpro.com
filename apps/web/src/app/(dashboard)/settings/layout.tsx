'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/settings', label: 'General' },
  { href: '/settings/ai', label: 'AI Providers & Keys' },
  { href: '/settings/playground', label: 'AI Playground' },
  { href: '/settings/costs', label: 'AI Costs' },
  { href: '/settings/notifications', label: 'Notifications' },
  { href: '/settings/users', label: 'Users' },
] as const;

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-100">Settings</h1>
      <p className="mt-1 text-sm text-slate-400">
        System configuration, AI keys, notifications, and user management.
      </p>

      <nav className="mt-6 flex gap-1 border-b border-slate-800">
        {TABS.map((tab) => {
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`-mb-px border-b-2 px-4 py-2 text-sm transition-colors ${
                active
                  ? 'border-indigo-500 font-medium text-indigo-300'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6">{children}</div>
    </div>
  );
}
