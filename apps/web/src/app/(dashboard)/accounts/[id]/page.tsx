'use client';

import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { StatCard } from '@/components/ui/stat-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PostStatusBadge } from '@/components/ui/status-badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { compactNumber, relativeTime, absoluteTime } from '@/lib/format';
import {
  getAccountView, getPostsView, getIncidentsView,
  downloadTargetUrl, markTargetPublished, getApiAccount,
} from '@/lib/api-data';
import type { Account, Incident, Post } from '@/lib/domain-types';

function platformPostUrl(p: Post): string | null {
  if (!p.platformPostId) return null;
  if (p.platform === 'FACEBOOK') {
    return `https://www.facebook.com/${encodeURIComponent(p.platformPostId)}`;
  }
  if (p.platform === 'YOUTUBE') {
    return `https://www.youtube.com/watch?v=${encodeURIComponent(p.platformPostId)}`;
  }
  if (p.platform === 'TIKTOK') {
    return `https://www.tiktok.com/@/video/${encodeURIComponent(p.platformPostId)}`;
  }
  return null;
}

export default function AccountOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const [account, setAccount] = useState<Account | null>(null);
  const [connectionMethod, setConnectionMethod] = useState<string | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [incidents, setIncidents] = useState<Incident[]>([]);

  async function refreshPosts() {
    const r = await getPostsView(id);
    setPosts(r.posts);
  }

  useEffect(() => {
    void getAccountView(id).then(({ account: acc }) => setAccount(acc));
    void getApiAccount(id).then((a) => setConnectionMethod(a?.connectionMethod ?? null));
    void refreshPosts();
    void getIncidentsView().then((r) => setIncidents(r.incidents.filter((i) => i.accountId === id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleMarkPublished(publishTargetId: string) {
    try {
      await markTargetPublished(publishTargetId);
      toast('Marked as published', 'success');
      await refreshPosts();
    } catch {
      toast('Failed to mark as published', 'error');
    }
  }

  if (!account) return null; // layout renders loading / not-found states

  const recent = [...posts].sort((a, b) => {
    const ta = Date.parse(a.publishedAt ?? a.scheduledAt ?? '') || 0;
    const tb = Date.parse(b.publishedAt ?? b.scheduledAt ?? '') || 0;
    return tb - ta;
  });
  const openIncidents = incidents.filter((i) => i.status === 'OPEN');
  const publishedViews = recent.reduce((n, p) => n + (p.views ?? 0), 0);
  const analyticsHref = `/accounts/${id}/analytics` as Route;

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
        <p className="font-medium text-zinc-900">Crossposting</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-600">
          Each connected channel is its own account (YouTube, Facebook, TikTok). Set default
          publish timing and sibling destinations under{' '}
          <span className="font-medium">Settings → Publish timing & crosspost</span>. Uploads
          use those defaults; Review Approve still gates all targets before anything goes live.
        </p>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Followers" value={compactNumber(account.followers)} hint="latest sync" />
        <StatCard
          label="Views"
          value={compactNumber(publishedViews > 0 ? publishedViews : account.views30d)}
          hint={publishedViews > 0 ? 'synced videos' : '30 days'}
        />
        <StatCard label="Scheduled" value={account.scheduledCount} hint="upcoming posts" />
        <StatCard
          label="Open incidents"
          value={openIncidents.length}
          hint={openIncidents.length > 0 ? 'needs attention' : 'all clear'}
        />
      </div>

      {connectionMethod === 'MANUAL' && (() => {
        // In manual mode the pipeline stops at PUBLISHING (== SCHEDULED in Post
        // view) — Owner downloads the file, uploads by hand, then marks PUBLISHED.
        const pending = posts.filter((p) => p.status === 'SCHEDULED' && p.publishedAt == null);
        return (
          <Card>
            <CardHeader
              title="Manual uploads"
              description="Videos ready — download the rendered file, upload it to the platform, then mark as published."
              action={<Badge tone="indigo">MANUAL account</Badge>}
            />
            {pending.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title="Nothing ready to upload"
                  hint="Approved content items land here once rendering completes."
                />
              </div>
            ) : (
              <ul className="divide-y divide-zinc-100">
                {pending.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-zinc-900">{p.title}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">rendered {relativeTime(p.scheduledAt)}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <a
                        href={downloadTargetUrl(p.id)}
                        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                      >
                        Download
                      </a>
                      <Button size="sm" variant="primary" onClick={() => handleMarkPublished(p.id)}>
                        Mark published
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })()}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Recent & upcoming posts */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent & upcoming posts"
            description="Latest published and scheduled content for this account"
            action={
              <Link href={analyticsHref} className="text-xs font-medium text-indigo-600 hover:underline">
                Open analytics
              </Link>
            }
          />
          {recent.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No posts yet"
                hint="Content appears here once the first video is scheduled or published."
              />
            </div>
          ) : (
            <Table className="rounded-t-none border-0">
              <THead>
                <TR>
                  <TH>Title</TH>
                  <TH>Status</TH>
                  <TH>When</TH>
                  <TH numeric>Views</TH>
                </TR>
              </THead>
              <TBody>
                {recent.map((p) => {
                  const external = platformPostUrl(p);
                  return (
                    <TR
                      key={p.id}
                      onClick={() => router.push(analyticsHref)}
                      className="cursor-pointer"
                    >
                      <TD className="max-w-[18rem]">
                        <span className="font-medium text-indigo-700 hover:underline">
                          {p.title}
                        </span>
                        {external && (
                          <a
                            href={external}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="mt-0.5 block text-[11px] font-medium text-zinc-500 hover:text-zinc-800"
                          >
                            Open on platform ↗
                          </a>
                        )}
                      </TD>
                      <TD>
                        <PostStatusBadge status={p.status} />
                      </TD>
                      <TD title={absoluteTime(p.publishedAt ?? p.scheduledAt)}>
                        {relativeTime(p.publishedAt ?? p.scheduledAt)}
                      </TD>
                      <TD numeric>{p.views == null ? '—' : compactNumber(p.views)}</TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </Card>

        {/* Connection health */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Connection" description="Token & publishing bridge health" />
            <div className="space-y-3 p-4 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Status</span>
                <Badge
                  tone={
                    account.connection === 'CONNECTED'
                      ? 'green'
                      : account.connection === 'EXPIRING'
                        ? 'amber'
                        : 'red'
                  }
                >
                  {account.connection === 'CONNECTED'
                    ? 'Connected'
                    : account.connection === 'EXPIRING'
                      ? 'Expiring soon'
                      : 'Disconnected'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Token expires</span>
                <span title={absoluteTime(account.tokenExpiresAt)}>
                  {account.tokenExpiresAt
                    ? relativeTime(account.tokenExpiresAt)
                    : 'Does not expire'}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Monetized</span>
                <Badge tone={account.monetized ? 'green' : 'neutral'}>
                  {account.monetized ? 'Yes' : 'No'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-500">Connected</span>
                <span title={absoluteTime(account.createdAt)}>{relativeTime(account.createdAt)}</span>
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Open incidents" />
            <div className="p-4">
              {openIncidents.length === 0 ? (
                <p className="text-sm text-zinc-500">No open incidents for this account.</p>
              ) : (
                <ul className="space-y-2">
                  {openIncidents.map((inc) => (
                    <li key={inc.id} className="text-sm">
                      <Link
                        href={'/incidents' as Route}
                        className="font-medium text-red-600 hover:underline"
                      >
                        {inc.title}
                      </Link>
                      <p className="text-xs text-zinc-500">{relativeTime(inc.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
