'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { AiKeyStatus, AiProviderView } from '@/lib/types';

const STATUS_CHIP: Record<AiKeyStatus, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-300',
  COOLDOWN: 'bg-amber-500/15 text-amber-300',
  EXHAUSTED: 'bg-orange-500/15 text-orange-300',
  DISABLED: 'bg-slate-500/15 text-slate-400',
};

export default function AiSettingsPage() {
  const [providers, setProviders] = useState<AiProviderView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addKeyFor, setAddKeyFor] = useState<AiProviderView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProviders(await api.get<AiProviderView[]>('/ai/providers'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load providers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed');
    }
  }

  return (
    <div>
      <h2 className="mb-4 text-lg font-medium text-slate-200">AI Providers &amp; Keys</h2>
      {error && (
        <p className="mb-4 rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      <div className="space-y-4">
        {providers.map((p) => (
          <div key={p.id} className="rounded-lg border border-slate-800 bg-slate-900/40">
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="font-medium text-slate-100">{p.name}</span>
                <span className="rounded bg-slate-800 px-2 py-0.5 text-[10px] uppercase text-slate-400">
                  {p.kind}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-xs text-slate-400">
                  <input
                    type="checkbox"
                    checked={p.enabled}
                    onChange={(e) =>
                      act(() => api.patch(`/ai/providers/${p.id}`, { enabled: e.target.checked }))
                    }
                  />
                  Enabled
                </label>
                <button
                  onClick={() => setAddKeyFor(p)}
                  className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
                >
                  + Add key
                </button>
              </div>
            </div>

            <div className="divide-y divide-slate-800">
              {p.keys.length === 0 && (
                <p className="px-4 py-3 text-sm text-slate-500">
                  No keys.{' '}
                  {(p.baseConfig as { needsKey?: boolean }).needsKey === false
                    ? '(Self-hosted — no key required.)'
                    : 'Add one to enable this provider.'}
                </p>
              )}
              {p.keys.map((k, idx) => (
                <div key={k.id} className="flex items-center justify-between px-4 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <span className="text-slate-200">{k.label}</span>
                    <span className="font-mono text-xs text-slate-500">••••{k.last4}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-medium ${STATUS_CHIP[k.status]}`}
                    >
                      {k.status}
                    </span>
                    <span className="text-[11px] text-slate-600">priority {k.priority}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      title="Move up"
                      disabled={idx === 0}
                      onClick={() =>
                        act(() => api.patch(`/ai/keys/${k.id}/reorder`, { direction: 'up' }))
                      }
                      className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      title="Move down"
                      disabled={idx === p.keys.length - 1}
                      onClick={() =>
                        act(() => api.patch(`/ai/keys/${k.id}/reorder`, { direction: 'down' }))
                      }
                      className="rounded border border-slate-700 px-1.5 py-0.5 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() =>
                        act(() =>
                          api.patch(`/ai/keys/${k.id}/status`, {
                            status: k.status === 'DISABLED' ? 'ACTIVE' : 'DISABLED',
                          }),
                        )
                      }
                      className="rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 hover:bg-slate-800"
                    >
                      {k.status === 'DISABLED' ? 'Enable' : 'Disable'}
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete key "${k.label}"? This cannot be undone.`)) {
                          void act(() => api.del(`/ai/keys/${k.id}`));
                        }
                      }}
                      className="rounded border border-red-900/60 px-2 py-0.5 text-xs text-red-300 hover:bg-red-950/40"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {addKeyFor && (
        <AddKeyDialog
          provider={addKeyFor}
          onClose={() => setAddKeyFor(null)}
          onAdded={() => {
            setAddKeyFor(null);
            void load();
          }}
          onError={setError}
        />
      )}
    </div>
  );
}

function AddKeyDialog({
  provider,
  onClose,
  onAdded,
  onError,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900 p-6 shadow-xl"
      >
        <h3 className="mb-1 text-base font-medium text-slate-100">Add key — {provider.name}</h3>
        <p className="mb-4 rounded-md border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          Paste the key once. It is encrypted at rest and will never be shown again — only the last
          4 characters are kept for display.
        </p>
        <label className="block">
          <span className="text-sm text-slate-300">Label</span>
          <input
            required
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. primary paid key"
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <label className="mt-3 block">
          <span className="text-sm text-slate-300">API key</span>
          <input
            required
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm text-slate-200 focus:border-indigo-500 focus:outline-none"
          />
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
          >
            {busy ? 'Saving…' : 'Add key'}
          </button>
        </div>
      </form>
    </div>
  );
}
