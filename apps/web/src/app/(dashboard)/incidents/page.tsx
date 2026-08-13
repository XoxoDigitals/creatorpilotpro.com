'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { SeverityBadge, IncidentStatusBadge } from '@/components/ui/status-badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { Drawer } from '@/components/ui/drawer';
import { EmptyState } from '@/components/ui/empty-state';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { relativeTime, absoluteTime } from '@/lib/format';
import { getIncidentsView, retryIncident, resolveIncident } from '@/lib/api-data';
import type { Incident, IncidentKind } from '@/lib/domain-types';

const KIND: Record<IncidentKind, { tone: BadgeTone; label: string }> = {
  AUTH: { tone: 'red', label: 'Auth' },
  RATE_LIMIT: { tone: 'amber', label: 'Rate limit' },
  COPYRIGHT: { tone: 'red', label: 'Copyright' },
  PUBLISH_ERROR: { tone: 'amber', label: 'Publish error' },
  POLICY: { tone: 'red', label: 'Policy' },
};

type Filter = 'ALL' | 'OPEN' | 'RESOLVED';

export default function IncidentsPage() {
  const [filter, setFilter] = useState<Filter>('OPEN');
  const [selected, setSelected] = useState<Incident | null>(null);
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [accountNames, setAccountNames] = useState<Record<string, string>>({});
  const [demo, setDemo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { incidents: list, accountNames: names, demo: isDemo } = await getIncidentsView();
      setIncidents(list);
      setAccountNames(names);
      setDemo(isDemo);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = incidents.filter((i) => filter === 'ALL' || i.status === filter);
  const accountName = (id: string) => accountNames[id] ?? (id || '—');

  const onRetry = async (inc: Incident) => {
    if (demo) {
      toast('Retry runs against the real job queue once a real account is connected', 'info');
      return;
    }
    if (!inc.retryable) {
      toast('Nothing to re-queue for this incident — fix the cause, then mark resolved', 'info');
      return;
    }
    setBusy(true);
    try {
      await retryIncident(inc.id);
      toast('Retry queued — related work is running again', 'success');
      setSelected(null);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Retry failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const onResolve = async (inc: Incident) => {
    if (demo) {
      toast('Marked resolved (demo — connect a real account to persist)', 'info');
      setSelected(null);
      return;
    }
    setBusy(true);
    try {
      await resolveIncident(inc.id);
      toast('Incident marked resolved', 'success');
      setSelected(null);
      await load();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not resolve incident', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Incidents"
        description="Copyright claims, auth failures, rate limits, and publish errors — with one-click retry"
        actions={
          <div className="flex rounded-md border border-zinc-300 bg-white p-0.5">
            {(['OPEN', 'RESOLVED', 'ALL'] as Filter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'rounded px-3 py-1 text-xs font-medium transition-colors',
                  filter === f ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-800',
                )}
              >
                {f[0] + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        }
      />

      {demo && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Showing demo data. Connect a real account, or turn off <strong>Demo data</strong> in
          Settings → General, to see live incidents.
        </div>
      )}

      {loading ? (
        <p className="p-4 text-sm text-zinc-500">Loading incidents…</p>
      ) : visible.length === 0 ? (
        <EmptyState
          title={filter === 'OPEN' ? 'No open incidents' : 'No incidents'}
          hint="When a publish fails or a platform flags content, the item is drafted automatically and the incident appears here."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Incident</TH>
              <TH>Account</TH>
              <TH>Kind</TH>
              <TH>Severity</TH>
              <TH>Status</TH>
              <TH>When</TH>
            </TR>
          </THead>
          <TBody>
            {visible.map((inc) => (
              <TR key={inc.id} onClick={() => setSelected(inc)}>
                <TD className="font-medium text-zinc-900">{inc.title}</TD>
                <TD>{accountName(inc.accountId)}</TD>
                <TD>
                  <Badge tone={KIND[inc.kind].tone}>{KIND[inc.kind].label}</Badge>
                </TD>
                <TD>
                  <SeverityBadge severity={inc.severity} />
                </TD>
                <TD>
                  <IncidentStatusBadge status={inc.status} />
                </TD>
                <TD title={absoluteTime(inc.createdAt)}>{relativeTime(inc.createdAt)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Drawer open={selected != null} onClose={() => setSelected(null)} title={selected?.title ?? ''}>
        {selected && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={KIND[selected.kind].tone}>{KIND[selected.kind].label}</Badge>
              <SeverityBadge severity={selected.severity} />
              <IncidentStatusBadge status={selected.status} />
            </div>
            <p className="text-zinc-600">{selected.detail}</p>
            <dl className="space-y-2 border-t border-zinc-100 pt-3 text-xs">
              <div className="flex justify-between">
                <dt className="text-zinc-500">Account</dt>
                <dd className="font-medium text-zinc-800">{accountName(selected.accountId)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-zinc-500">Opened</dt>
                <dd title={absoluteTime(selected.createdAt)}>{relativeTime(selected.createdAt)}</dd>
              </div>
              {selected.resolvedAt && (
                <div className="flex justify-between">
                  <dt className="text-zinc-500">Resolved</dt>
                  <dd title={absoluteTime(selected.resolvedAt)}>{relativeTime(selected.resolvedAt)}</dd>
                </div>
              )}
            </dl>
            {selected.status === 'OPEN' && (
              <div className="flex gap-2 border-t border-zinc-100 pt-4">
                {selected.retryable && (
                  <Button size="sm" variant="primary" disabled={busy} onClick={() => void onRetry(selected)}>
                    Retry
                  </Button>
                )}
                <Button size="sm" disabled={busy} onClick={() => void onResolve(selected)}>
                  Mark resolved
                </Button>
              </div>
            )}
            {selected.status === 'ACKED' && (
              <p className="border-t border-zinc-100 pt-4 text-xs text-zinc-500">
                Retry was queued. The incident will stay acknowledged until you mark it resolved or a new
                failure opens a fresh incident.
              </p>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
