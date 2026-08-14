'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { HealthDot } from '@/components/ui/health-dot';
import { ContentTypeBadge, Badge } from '@/components/ui/badge';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { ConnectWizard } from '@/components/connect-wizard';
import { compactNumber } from '@/lib/format';
import { deleteAccount, getAccountsView } from '@/lib/api-data';
import { api } from '@/lib/api';
import { isSystemAdmin, type SessionUser } from '@/lib/types';
import type { Account, Platform } from '@/lib/domain-types';

const PLATFORM_ORDER: { id: Platform; label: string }[] = [
  { id: 'YOUTUBE', label: 'YouTube' },
  { id: 'FACEBOOK', label: 'Facebook' },
  { id: 'TIKTOK', label: 'TikTok' },
];

export default function AccountsPage() {
  const toast = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [canConnect, setCanConnect] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void api
      .get<{ user: SessionUser }>('/auth/me')
      .then(({ user }) => setCanConnect(isSystemAdmin(user.role)))
      .catch(() => setCanConnect(false));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { accounts: list, demo: isDemo } = await getAccountsView();
      setAccounts(list);
      setDemo(isDemo);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function onDelete(account: Account) {
    if (!canConnect) return;
    if (
      !confirm(
        `Delete account “${account.name}”? It will be disconnected and hidden. This cannot be undone from the UI.`,
      )
    ) {
      return;
    }
    setBusyId(account.id);
    try {
      await deleteAccount(account.id);
      toast('Account deleted', 'success');
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Failed to delete account', 'error');
    } finally {
      setBusyId(null);
    }
  }

  // Surface OAuth errors bounced back by the API (?connect=google|meta&error=1).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('error') === '1') {
      const provider = params.get('connect') === 'meta' ? 'Meta' : 'Google';
      toast(`${provider} connection was cancelled or failed. Please try again.`, 'error');
      window.history.replaceState(null, '', '/accounts');
    }
  }, [toast]);

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Each connection is one platform channel. Connect YouTube and Facebook separately, then set default crosspost destinations in that channel’s Settings."
        actions={
          canConnect ? (
            <Button variant="primary" size="sm" onClick={() => setWizardOpen(true)}>
              Connect account
            </Button>
          ) : undefined
        }
      />

      {demo && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing demo data. Connect a real account, or turn off <strong>Demo data</strong> in
          Settings → General, to see your live accounts.
        </div>
      )}

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      )}

      {!loading && accounts.length === 0 ? (
        <EmptyState
          title="No accounts connected"
          hint="Connect your first YouTube channel, Facebook Page, or TikTok account to start publishing."
          cta={
            <Button variant="primary" size="sm" onClick={() => setWizardOpen(true)}>
              Connect account
            </Button>
          }
        />
      ) : (
        !loading &&
        <div className="space-y-8">
          {PLATFORM_ORDER.map(({ id, label }) => {
            const group = accounts.filter((a) => a.platform === id);
            if (group.length === 0) return null;
            return (
              <section key={id}>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-900">
                  <PlatformIcon platform={id} size={18} />
                  {label}
                  <span className="nums rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                    {group.length}
                  </span>
                </h2>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {group.map((a) => (
                    <Card key={a.id} className="p-4 transition-shadow hover:shadow-md">
                      <Link href={`/accounts/${a.id}` as Route} className="block">
                        <div className="flex items-start justify-between">
                          <div className="flex items-center gap-3">
                            <Avatar name={a.name} size="lg" />
                            <div>
                              <p className="text-sm font-semibold text-zinc-900">{a.name}</p>
                              <p className="text-xs text-zinc-500">{a.handle}</p>
                            </div>
                          </div>
                          <HealthDot status={a.health} />
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          <ContentTypeBadge type={a.contentType} />
                          {a.dramasEnabled && <Badge tone="violet">Dramas</Badge>}
                          {a.monetized && <Badge tone="green">Monetized</Badge>}
                          {a.connectionMethod === 'MANUAL' && <Badge tone="indigo">Manual</Badge>}
                          {a.paused && <Badge tone="amber">Paused</Badge>}
                        </div>
                        <div className="mt-4 grid grid-cols-3 gap-2 border-t border-zinc-100 pt-3 text-center">
                          <div>
                            <p className="nums text-sm font-semibold text-zinc-900">
                              {compactNumber(a.followers)}
                            </p>
                            <p className="text-[10px] uppercase tracking-wide text-zinc-400">Followers</p>
                          </div>
                          <div>
                            <p className="nums text-sm font-semibold text-zinc-900">
                              {compactNumber(a.views30d)}
                            </p>
                            <p className="text-[10px] uppercase tracking-wide text-zinc-400">Views 30d</p>
                          </div>
                          <div>
                            <p className="nums text-sm font-semibold text-zinc-900">{a.scheduledCount}</p>
                            <p className="text-[10px] uppercase tracking-wide text-zinc-400">Scheduled</p>
                          </div>
                        </div>
                      </Link>
                      {canConnect && (
                        <div className="mt-3 flex justify-end border-t border-zinc-100 pt-3">
                          <Button
                            size="sm"
                            variant="danger"
                            disabled={busyId === a.id}
                            onClick={() => void onDelete(a)}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <ConnectWizard
        open={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
          void load();
        }}
      />
    </div>
  );
}
