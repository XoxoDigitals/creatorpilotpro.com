'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Avatar } from '@/components/ui/avatar';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { api, ApiError } from '@/lib/api';
import { compactNumber } from '@/lib/format';

/** A Facebook Page returned by GET /accounts/connect/meta/pending (tokens stripped). */
interface MetaPage {
  id: string;
  name: string;
  avatarUrl: string | null;
  fanCount: number;
}

/**
 * Meta page-picker — the web destination the API redirects to after the Facebook
 * OAuth callback (`/accounts/connect/meta?session=...`). Supports multi-select so
 * one OAuth round-trip can connect many Pages. Wizard choices live in the
 * pending session; the client posts `{ session, pageIds }`.
 */
export default function MetaConnectPage() {
  const router = useRouter();
  const toast = useToast();

  const [session, setSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    const s = new URLSearchParams(window.location.search).get('session');
    if (!s) {
      setError('Missing page-picker session. Start the connection again from Accounts.');
      setLoading(false);
      return;
    }
    setSession(s);
    let cancelled = false;
    api
      .get<MetaPage[]>(`/accounts/connect/meta/pending?session=${encodeURIComponent(s)}`)
      .then((rows) => {
        if (!cancelled) setPages(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load your Facebook Pages.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function connect() {
    if (!session || selected.size === 0) return;
    setConnecting(true);
    try {
      const pageIds = [...selected];
      const result = await api.post<{ accounts: Array<{ id: string; contentType?: string }> }>(
        '/accounts/connect/meta',
        { session, pageIds },
      );
      const accounts = result.accounts ?? [];
      const n = accounts.length;
      toast(n === 1 ? 'Facebook Page connected' : `${n} Facebook Pages connected`, 'success');
      if (n === 0) {
        router.push('/accounts');
        return;
      }
      if (n === 1) {
        const account = accounts[0]!;
        const ct = account.contentType;
        const dest =
          ct === 'AI' || ct === 'MIXED'
            ? `/accounts/${account.id}/ideas?onboard=refs`
            : `/accounts/${account.id}`;
        router.push(dest as Route);
        return;
      }
      router.push('/accounts');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Connection failed', 'error');
      setConnecting(false);
    }
  }

  const selectedCount = selected.size;

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Choose Facebook Pages"
        description="Select one or more Pages to publish Reels to with your Meta app"
      />

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      )}

      {!loading && error && (
        <EmptyState
          title="Page picker unavailable"
          hint={error}
          cta={
            <Button variant="primary" size="sm" onClick={() => router.push('/accounts')}>
              Back to Accounts
            </Button>
          }
        />
      )}

      {!loading && !error && pages.length === 0 && (
        <EmptyState
          title="No Facebook Pages found"
          hint="Your Meta account doesn’t manage any Pages, or the picker session expired. Reconnect from Accounts to try again."
          cta={
            <Button variant="primary" size="sm" onClick={() => router.push('/accounts')}>
              Back to Accounts
            </Button>
          }
        />
      )}

      {!loading && !error && pages.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
            <span>
              {selectedCount === 0
                ? 'Click pages to select'
                : `${selectedCount} selected`}
            </span>
            <button
              type="button"
              className="font-medium text-indigo-600 hover:text-indigo-700"
              onClick={() => {
                if (selectedCount === pages.length) setSelected(new Set());
                else setSelected(new Set(pages.map((p) => p.id)));
              }}
            >
              {selectedCount === pages.length ? 'Clear all' : 'Select all'}
            </button>
          </div>
          <div className="space-y-2">
            {pages.map((p) => {
              const isOn = selected.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggle(p.id)}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                    isOn
                      ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500'
                      : 'border-zinc-200 hover:bg-zinc-50',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px]',
                      isOn
                        ? 'border-indigo-600 bg-indigo-600 text-white'
                        : 'border-zinc-300 bg-white text-transparent',
                    )}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <Avatar name={p.name} src={p.avatarUrl} size="md" />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-zinc-900">{p.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {typeof p.fanCount === 'number' && p.fanCount > 0
                        ? `${compactNumber(p.fanCount)} followers · Facebook Page`
                        : 'Facebook Page'}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => router.push('/accounts')}>
              Cancel
            </Button>
            <Button variant="primary" disabled={selectedCount === 0 || connecting} onClick={connect}>
              {connecting
                ? 'Connecting…'
                : selectedCount <= 1
                  ? 'Connect Page'
                  : `Connect ${selectedCount} Pages`}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
