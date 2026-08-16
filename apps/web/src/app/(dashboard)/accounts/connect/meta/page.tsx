'use client';

import { useEffect, useMemo, useState } from 'react';
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
  alreadyConnected?: boolean;
}

/**
 * Meta page-picker — the web destination the API redirects to after the Facebook
 * OAuth callback (`/accounts/connect/meta?session=...`). Supports multi-select so
 * one OAuth round-trip can connect many Pages. Already-connected Pages are shown
 * but not selectable.
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

  const availablePages = useMemo(
    () => pages.filter((p) => !p.alreadyConnected),
    [pages],
  );

  function toggle(id: string) {
    const page = pages.find((p) => p.id === id);
    if (!page || page.alreadyConnected) return;
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
      const pageIds = [...selected].filter((id) => {
        const p = pages.find((x) => x.id === id);
        return p && !p.alreadyConnected;
      });
      if (pageIds.length === 0) {
        toast('Select at least one Page that is not already connected', 'error');
        setConnecting(false);
        return;
      }
      const result = await api.post<{ accounts: Array<{ id: string; contentType?: string }> }>(
        '/accounts/connect/meta',
        {
          session,
          pageIds,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
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
  const allAvailableSelected =
    availablePages.length > 0 && availablePages.every((p) => selected.has(p.id));

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Choose Facebook Pages"
        description="Select one or more Pages that are not already connected."
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
          {availablePages.length === 0 ? (
            <p className="mb-3 text-sm text-zinc-600">
              All of these Pages are already connected. Disconnect one from Accounts if you need to
              reconnect it.
            </p>
          ) : (
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
                  if (allAvailableSelected) setSelected(new Set());
                  else setSelected(new Set(availablePages.map((p) => p.id)));
                }}
              >
                {allAvailableSelected ? 'Clear all' : 'Select all'}
              </button>
            </div>
          )}
          <div className="space-y-2">
            {pages.map((p) => {
              const connected = Boolean(p.alreadyConnected);
              const isOn = !connected && selected.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={connected}
                  onClick={() => toggle(p.id)}
                  aria-disabled={connected}
                  className={cn(
                    'flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                    connected &&
                      'cursor-not-allowed border-zinc-100 bg-zinc-50 opacity-60',
                    !connected &&
                      isOn &&
                      'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500',
                    !connected && !isOn && 'border-zinc-200 hover:bg-zinc-50',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[10px]',
                      connected && 'border-zinc-200 bg-zinc-100 text-transparent',
                      !connected &&
                        isOn &&
                        'border-indigo-600 bg-indigo-600 text-white',
                      !connected &&
                        !isOn &&
                        'border-zinc-300 bg-white text-transparent',
                    )}
                    aria-hidden
                  >
                    ✓
                  </span>
                  <Avatar name={p.name} src={p.avatarUrl} size="md" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="block text-sm font-medium text-zinc-900">{p.name}</span>
                      {connected && (
                        <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-600">
                          Connected
                        </span>
                      )}
                    </span>
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
            <Button
              variant="primary"
              disabled={selectedCount === 0 || connecting || availablePages.length === 0}
              onClick={connect}
            >
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
