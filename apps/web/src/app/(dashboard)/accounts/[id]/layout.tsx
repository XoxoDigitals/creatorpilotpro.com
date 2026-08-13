'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Tabs, type TabItem } from '@/components/ui/tabs';
import { Avatar } from '@/components/ui/avatar';
import { HealthDot } from '@/components/ui/health-dot';
import { ContentTypeBadge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { compactNumber } from '@/lib/format';
import { getAccountView, getReviewView } from '@/lib/api-data';
import { api, ApiError } from '@/lib/api';
import { TAB_VISIBILITY, type Account } from '@/lib/domain-types';

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const toast = useToast();

  const [account, setAccount] = useState<Account | null>(null);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [paused, setPaused] = useState(false);
  const [pendingReviews, setPendingReviews] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { account: acc, demo: isDemo } = await getAccountView(params.id);
      setAccount(acc);
      setDemo(isDemo);
      setPaused(acc?.paused ?? false);
      const review = await getReviewView(params.id);
      setPendingReviews(review.items.filter((r) => r.status === 'PENDING').length);
    } finally {
      setLoading(false);
    }
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16 w-full rounded-lg" />
        <Skeleton className="h-8 w-96 rounded-md" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (!account) {
    return (
      <EmptyState
        title="Account not found"
        hint="This account may have been disconnected or the link is out of date."
        cta={
          <Button variant="secondary" onClick={() => (window.location.href = '/accounts')}>
            Back to accounts
          </Button>
        }
      />
    );
  }

  const base = `/accounts/${account.id}`;
  const vis = TAB_VISIBILITY[account.contentType];

  // Ordered to follow the production workflow: Ideas → Review → AI → Schedule.
  const tabs: TabItem[] = [
    { href: base, label: 'Overview' },
    ...(vis.sources ? [{ href: `${base}/sources`, label: 'Sources' }] : []),
    ...(vis.ideas ? [{ href: `${base}/ideas`, label: 'Ideas' }] : []),
    { href: `${base}/review`, label: 'Review', badge: pendingReviews },
    { href: `${base}/ai`, label: 'AI' },
    // Dramas is an explicit per-account toggle, not a contentType consequence.
    ...(account.dramasEnabled ? [{ href: `${base}/dramas`, label: 'Dramas' }] : []),
    { href: `${base}/schedule`, label: 'Schedule' },
    { href: `${base}/analytics`, label: 'Analytics' },
    { href: `${base}/settings`, label: 'Settings' },
  ];

  async function togglePause() {
    const next = !paused;
    setPaused(next);
    if (demo || !account) {
      toast(next ? `Queue paused for ${account?.name}` : 'Queue resumed', 'info');
      return;
    }
    try {
      await api.patch(`/accounts/${account.id}`, { paused: next });
      toast(next ? `Queue paused for ${account.name}` : 'Queue resumed', 'success');
    } catch (err) {
      setPaused(!next); // revert
      toast(err instanceof ApiError ? err.message : 'Could not update queue', 'error');
    }
  }

  return (
    <div>
      {demo && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo account — changes here are illustrative until a real account is connected.
        </div>
      )}
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
          <Button variant="secondary" size="sm" onClick={togglePause}>
            {paused ? 'Resume queue' : 'Pause queue'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => toast('Deep-link to the platform arrives in Phase 1b', 'info')}
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
