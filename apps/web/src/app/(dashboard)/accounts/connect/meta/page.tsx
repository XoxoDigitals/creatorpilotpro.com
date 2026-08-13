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

/** A Facebook Page returned by GET /accounts/connect/meta/pending (tokens stripped). */
interface MetaPage {
  id: string;
  name: string;
  avatarUrl: string | null;
}

/**
 * Meta page-picker — the web destination the API redirects to after the Facebook
 * OAuth callback (`/accounts/connect/meta?session=...`). It lists the Pages the
 * user manages and, on confirm, finishes the connect with POST /accounts/connect/meta.
 * The content-type / dramas / schedule choices are carried server-side in the
 * pending session, so only `{ session, pageId }` are posted here.
 */
export default function MetaConnectPage() {
  const router = useRouter();
  const toast = useToast();

  const [session, setSession] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pages, setPages] = useState<MetaPage[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
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

  async function connect() {
    if (!session || !selected) return;
    setConnecting(true);
    try {
      const account = await api.post<{ id: string; contentType?: string }>('/accounts/connect/meta', {
        session,
        pageId: selected,
      });
      toast('Facebook Page connected', 'success');
      const ct = account.contentType;
      const dest =
        ct === 'AI' || ct === 'MIXED'
          ? `/accounts/${account.id}/ideas?onboard=refs`
          : `/accounts/${account.id}`;
      router.push(dest as Route);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Connection failed', 'error');
      setConnecting(false);
    }
  }

  return (
    <div className="max-w-xl">
      <PageHeader
        title="Choose a Facebook Page"
        description="Pick the Page to publish Reels to with your Meta app"
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
          <div className="space-y-2">
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelected(p.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                  selected === p.id
                    ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500'
                    : 'border-zinc-200 hover:bg-zinc-50',
                )}
              >
                <Avatar name={p.name} src={p.avatarUrl} size="md" />
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-zinc-900">{p.name}</span>
                  <span className="block text-xs text-zinc-500">Facebook Page</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => router.push('/accounts')}>
              Cancel
            </Button>
            <Button variant="primary" disabled={!selected || connecting} onClick={connect}>
              {connecting ? 'Connecting…' : 'Connect Page'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
