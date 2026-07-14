'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { SettingView } from '@/lib/types';

export default function GeneralSettingsPage() {
  const [settings, setSettings] = useState<SettingView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  // Form state.
  const [ttsProvider, setTtsProvider] = useState('kokoro');
  const [ttsSpeed, setTtsSpeed] = useState('1.0');
  const [warnPercent, setWarnPercent] = useState('80');
  const [evictPercent, setEvictPercent] = useState('90');

  const load = useCallback(async () => {
    try {
      const list = await api.get<SettingView[]>('/system/settings');
      setSettings(list);
      const tts = list.find((s) => s.key === 'tts.default')?.value as
        { provider?: string; speed?: number } | undefined;
      if (tts) {
        if (tts.provider) setTtsProvider(tts.provider);
        if (typeof tts.speed === 'number') setTtsSpeed(String(tts.speed));
      }
      const st = list.find((s) => s.key === 'storage.thresholds')?.value as
        { warnPercent?: number; evictPercent?: number } | undefined;
      if (st) {
        if (typeof st.warnPercent === 'number') setWarnPercent(String(st.warnPercent));
        if (typeof st.evictPercent === 'number') setEvictPercent(String(st.evictPercent));
      }
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load settings');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(key: string, value: unknown) {
    setSaved(null);
    try {
      await api.put(`/system/settings/${key}`, { value });
      setSaved(key);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Save failed');
    }
  }

  return (
    <div className="max-w-lg space-y-8">
      {error && (
        <p className="rounded-md border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      )}

      <section>
        <h2 className="mb-3 text-lg font-medium text-slate-200">Default TTS</h2>
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <Labeled label="Provider">
            <input
              value={ttsProvider}
              onChange={(e) => setTtsProvider(e.target.value)}
              className={inputCls}
            />
          </Labeled>
          <Labeled label="Speed">
            <input
              type="number"
              step="0.1"
              value={ttsSpeed}
              onChange={(e) => setTtsSpeed(e.target.value)}
              className={inputCls}
            />
          </Labeled>
          <SaveRow
            savedKey={saved}
            thisKey="tts.default"
            onSave={() => save('tts.default', { provider: ttsProvider, speed: Number(ttsSpeed) })}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium text-slate-200">Storage thresholds</h2>
        <div className="space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <Labeled label="Warn at (% disk used)">
            <input
              type="number"
              value={warnPercent}
              onChange={(e) => setWarnPercent(e.target.value)}
              className={inputCls}
            />
          </Labeled>
          <Labeled label="Auto-evict at (% disk used)">
            <input
              type="number"
              value={evictPercent}
              onChange={(e) => setEvictPercent(e.target.value)}
              className={inputCls}
            />
          </Labeled>
          <SaveRow
            savedKey={saved}
            thisKey="storage.thresholds"
            onSave={() =>
              save('storage.thresholds', {
                warnPercent: Number(warnPercent),
                evictPercent: Number(evictPercent),
              })
            }
          />
        </div>
      </section>

      <p className="text-xs text-slate-600">
        {settings.length} whitelisted setting keys. Kill-switches and feature flags are managed here
        in later phases.
      </p>
    </div>
  );
}

const inputCls =
  'mt-1 w-full rounded-md border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-indigo-500 focus:outline-none';

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-sm text-slate-300">{label}</span>
      {children}
    </label>
  );
}

function SaveRow({
  savedKey,
  thisKey,
  onSave,
}: {
  savedKey: string | null;
  thisKey: string;
  onSave: () => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onSave}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Save
      </button>
      {savedKey === thisKey && <span className="text-xs text-emerald-400">Saved ✓</span>}
    </div>
  );
}
