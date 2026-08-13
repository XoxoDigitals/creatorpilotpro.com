'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field, Toggle } from '@/components/ui/input';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { AiKeyStatus, AiProviderView } from '@/lib/types';

const STATUS_TONE: Record<AiKeyStatus, BadgeTone> = {
  ACTIVE: 'green',
  COOLDOWN: 'amber',
  EXHAUSTED: 'red',
  DISABLED: 'neutral',
};

export default function AiSettingsPage() {
  const toast = useToast();
  const [providers, setProviders] = useState<AiProviderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [addKeyFor, setAddKeyFor] = useState<AiProviderView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProviders(await api.get<AiProviderView[]>('/ai/providers'));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load providers', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function act(fn: () => Promise<unknown>) {
    try { await fn(); await load(); }
    catch (err) { toast(err instanceof ApiError ? err.message : 'Action failed', 'error'); }
  }

  if (loading) return <p className="text-sm text-zinc-500">Loading…</p>;

  return (
    <div className="space-y-4">
      {providers.map((p) => (
        <Card key={p.id}>
          <div className="flex items-center justify-between border-b border-zinc-100 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-zinc-900">{p.name}</span>
              <Badge tone="indigo">{p.kind}</Badge>
            </div>
            <div className="flex items-center gap-3">
              <Toggle
                checked={p.enabled}
                onChange={(v) => act(() => api.patch(`/ai/providers/${p.id}`, { enabled: v }))}
                label="Enabled"
              />
              <Button variant="primary" size="sm" onClick={() => setAddKeyFor(p)}>
                + Add key
              </Button>
            </div>
          </div>

          <div className="divide-y divide-zinc-100">
            {p.keys.length === 0 && (
              <p className="px-4 py-3 text-sm text-zinc-500">
                No keys.{' '}
                {(p.baseConfig as { needsKey?: boolean }).needsKey === false
                  ? '(Self-hosted — no key required.)'
                  : 'Add one to enable this provider.'}
              </p>
            )}
            {p.keys.map((k, idx) => (
              <div key={k.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-zinc-900">{k.label}</span>
                  <span className="font-mono text-xs text-zinc-500">••••{k.last4}</span>
                  <Badge tone={STATUS_TONE[k.status]}>{k.status}</Badge>
                  <span className="text-[11px] text-zinc-400">priority {k.priority}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button title="Move up" disabled={idx === 0}
                    onClick={() => act(() => api.patch(`/ai/keys/${k.id}/reorder`, { direction: 'up' }))}
                    className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >↑</button>
                  <button title="Move down" disabled={idx === p.keys.length - 1}
                    onClick={() => act(() => api.patch(`/ai/keys/${k.id}/reorder`, { direction: 'down' }))}
                    className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-40"
                  >↓</button>
                  <button
                    onClick={() => act(() => api.patch(`/ai/keys/${k.id}/status`, {
                      status: k.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED',
                    }))}
                    className="rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-50"
                  >
                    {k.status === 'DISABLED' ? 'Enable' : 'Disable'}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete key "${k.label}"? This cannot be undone.`)) {
                        void act(() => api.del(`/ai/keys/${k.id}`));
                      }
                    }}
                    className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}

      {addKeyFor && (
        <AddKeyDialog
          provider={addKeyFor}
          onClose={() => setAddKeyFor(null)}
          onAdded={() => { setAddKeyFor(null); void load(); }}
          onError={(m) => toast(m, 'error')}
        />
      )}
    </div>
  );
}

function AddKeyDialog({
  provider, onClose, onAdded, onError,
}: {
  provider: AiProviderView;
  onClose: () => void;
  onAdded: () => void;
  onError: (m: string) => void;
}) {
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post(`/ai/providers/${provider.id}/keys`, { label, key });
      onAdded();
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Add key failed');
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-900/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-2xl">
        <h3 className="mb-1 text-base font-semibold text-zinc-900">Add key — {provider.name}</h3>
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Paste the key once. It is encrypted at rest and will never be shown again — only the last 4 characters are kept for display.
        </p>
        <Field label="Label">
          <Input required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. primary paid key" />
        </Field>
        <div className="mt-3">
          <Field label="API key">
            <Input required type="password" value={key} onChange={(e) => setKey(e.target.value)} className="font-mono" />
          </Field>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" size="sm" disabled={busy}>
            {busy ? 'Saving…' : 'Add key'}
          </Button>
        </div>
      </form>
    </div>
  );
}
