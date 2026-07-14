'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { SettingView } from '@/lib/types';

export default function NotificationsSettingsPage() {
  const [settings, setSettings] = useState<SettingView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [smtpUrl, setSmtpUrl] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');

  const load = useCallback(async () => {
    try {
      setSettings(await api.get<SettingView[]>('/system/settings'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load settings');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const isConfigured = (key: string) => settings.find((s) => s.key === key)?.configured ?? false;

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
      <p className="rounded-md border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
        These are secrets: stored AES-256-GCM encrypted and never shown again. Leave fields blank to
        keep the existing value; re-saving overwrites it.
      </p>

      <section>
        <h2 className="mb-1 text-lg font-medium text-slate-200">Telegram</h2>
        <StatusLine configured={isConfigured('notifications.telegram')} />
        <div className="mt-2 space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <Labeled label="Bot token">
            <input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456:ABC-…"
              className={inputCls}
            />
          </Labeled>
          <Labeled label="Chat ID">
            <input
              value={chatId}
              onChange={(e) => setChatId(e.target.value)}
              className={inputCls}
            />
          </Labeled>
          <SaveRow
            saved={saved === 'notifications.telegram'}
            onSave={() => save('notifications.telegram', { botToken, chatId })}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-1 text-lg font-medium text-slate-200">SMTP email</h2>
        <StatusLine configured={isConfigured('notifications.smtp')} />
        <div className="mt-2 space-y-3 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
          <Labeled label="SMTP URL">
            <input
              type="password"
              value={smtpUrl}
              onChange={(e) => setSmtpUrl(e.target.value)}
              placeholder="smtps://user:pass@smtp.host:465"
              className={inputCls}
            />
          </Labeled>
          <Labeled label="From address">
            <input
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              placeholder="SocialCreatorPilot <noreply@…>"
              className={inputCls}
            />
          </Labeled>
          <SaveRow
            saved={saved === 'notifications.smtp'}
            onSave={() => save('notifications.smtp', { url: smtpUrl, from: smtpFrom })}
          />
        </div>
      </section>
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

function StatusLine({ configured }: { configured: boolean }) {
  return (
    <span className={`text-xs ${configured ? 'text-emerald-400' : 'text-slate-500'}`}>
      {configured ? 'Configured ✓' : 'Not configured'}
    </span>
  );
}

function SaveRow({ saved, onSave }: { saved: boolean; onSave: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={onSave}
        className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
      >
        Save
      </button>
      {saved && <span className="text-xs text-emerald-400">Saved ✓</span>}
    </div>
  );
}
