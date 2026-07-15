'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Route } from 'next';
import { cn } from '@/lib/cn';

export interface TabItem {
  href: string;
  label: string;
  badge?: number;
}

/** URL-driven underline tabs (docs/11 §3). Active = exact match or the item's
 *  own subtree, with `exact` opting the first tab out of prefix matching. */
export function Tabs({ items }: { items: TabItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200">
      {items.map((item, i) => {
        const active =
          i === 0 ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href as Route}
            className={cn(
              '-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
              active
                ? 'border-indigo-600 font-medium text-indigo-700'
                : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800',
            )}
          >
            {item.label}
            {typeof item.badge === 'number' && item.badge > 0 && (
              <span className="nums rounded-full bg-zinc-200 px-1.5 text-[10px] font-semibold text-zinc-600">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
