'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { Avatar } from '@/components/ui/avatar';
import { HealthDot } from '@/components/ui/health-dot';
import { ContentTypeBadge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { compactNumber } from '@/lib/format';
import { getAccount, getReviewItems } from '@/lib/mock-data';
import { TAB_VISIBILITY } from '@/lib/domain-types';

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const account = getAccount(params.id);
  const toast = useToast();
  const [paused, setPaused] = useState(account?.paused ?? false);

  if (!account) {
    return (
      <EmptyState
        title="Account not found"
        hint="This account may have been disconnected or the link is out of date."
        cta={
          <Button variant="secondary" onClick={() => (window.location.href = '/dashboard')}>
            Back to dashboard
          </Button>
        }
      />
    );
  }

  const base = `/accounts/${account.id}`;
  const vis = TAB_VISIBILITY[account.contentType];
  const pendingReviews = getReviewItems(account.id).filter((r) => r.status === 'PENDING').length;

  const tabs: TabItem[] = [
    { href: base, label: 'Overview' },
    ...(vis.sources ? [{ href: `${base}/sources`, label: 'Sources' }] : []),
    { href: `${base}/review`, label: 'Review', badge: pendingReviews },
    ...(vis.ideas ? [{ href: `${base}/ideas`, label: 'Ideas' }] : []),
    ...(vis.dramas ? [{ href: `${base}/dramas`, label: 'Dramas' }] : []),
    { href: `${base}/schedule`, label: 'Schedule' },
    { href: `${base}/analytics`, label: 'Analytics' },
    { href: `${base}/settings`, label: 'Settings' },
  ];

  return (
    <div>
      {/* Workspace header */}
      <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Avatar name={account.name} size="lg" src={account.avatarUrl} />
            <span className="absolute -bottom-1 -right-1 rounded-full bg-white p-1 shadow-sm">
              <PlatformIcon platform={account.platform} size={14} />
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-zinc-900">{account.name}</h1>
              <ContentTypeBadge type={account.contentType} />
              {paused && (
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                  Queue paused
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-zinc-500">
              <span>{account.handle}</span>
              <span className="text-zinc-300">·</span>
              <span className="nums">{compactNumber(account.followers)} followers</span>
              <span className="text-zinc-300">·</span>
              <HealthDot status={account.health} label />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              setPaused((p) => !p);
              toast(paused ? 'Queue resumed' : `Queue paused for ${account.name}`, 'info');
            }}
          >
            {paused ? 'Resume queue' : 'Pause queue'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => toast('Deep-link to the platform arrives in Phase 1', 'info')}
          >
            Open on platform ↗
          </Button>
        </div>
      </div>

      <Tabs items={tabs} />
      <div className="py-6">{children}</div>
    </div>
  );
}
