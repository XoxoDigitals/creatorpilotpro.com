'use client';

import { useState } from 'react';
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
import { getAccounts, getIncidents } from '@/lib/mock-data';
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
  const toast = useToast();
  const accounts = getAccounts();
  const incidents = getIncidents().filter((i) => filter === 'ALL' || i.status === filter);
  const accountName = (id: string) => accounts.find((a) => a.id === id)?.name ?? id;

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

      {incidents.length === 0 ? (
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
            {incidents.map((inc) => (
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
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => toast('Retry runs against the real publish engine in Phase 1', 'info')}
                >
                  Retry
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    toast('Marked resolved (mock — persists in Phase 1)', 'success');
                    setSelected(null);
                  }}
                >
                  Mark resolved
                </Button>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
