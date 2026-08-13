'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { isSystemAdmin, type SessionUser, type SettingView } from '@/lib/types';

export default function GeneralSettingsPage() {
  const toast = useToast();
  const router = useRouter();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [settings, setSettings] = useState<SettingView[]>([]);

  const [ttsProvider, setTtsProvider] = useState('kokoro');
  const [ttsSpeed, setTtsSpeed] = useState('1.0');
  const [warnPercent, setWarnPercent] = useState('80');
  const [evictPercent, setEvictPercent] = useState('90');
  const [demoMode, setDemoMode] = useState(false);

  const [driveClientId, setDriveClientId] = useState('');
  const [driveClientSecret, setDriveClientSecret] = useState('');
  const [driveRefreshToken, setDriveRefreshToken] = useState('');
  const [driveFolderId, setDriveFolderId] = useState('');
  const [drivePreview, setDrivePreview] = useState<Record<string, string>>({});
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [driveStatus, setDriveStatus] = useState<{
    backend: string;
    configured: boolean;
    rootFolderId: string | null;
    source?: string;
  } | null>(null);

  useEffect(() => {
    let alive = true;
    void api
      .get<{ user: SessionUser }>('/auth/me')
      .then(({ user }) => {
        if (!alive) return;
        if (!isSystemAdmin(user.role)) {
          setAllowed(false);
          router.replace('/settings/password');
          return;
        }
        setAllowed(true);
      })
      .catch(() => {
        if (alive) {
          setAllowed(false);
          router.replace('/settings/password');
        }
      });
    return () => {
      alive = false;
    };
  }, [router]);

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
      const gd = list.find((s) => s.key === 'storage.gdrive');
      setDriveConfigured(gd?.configured ?? false);
      setDrivePreview(gd?.preview ?? {});
      setDriveFolderId(gd?.preview?.rootFolderId ?? '');
      setDriveClientId('');
      setDriveClientSecret('');
      setDriveRefreshToken('');
      const dm = list.find((s) => s.key === 'demo_mode')?.value as { enabled?: boolean } | undefined;
      setDemoMode(dm?.enabled ?? false);
      try {
        const status = await api.get<{
          backend: string;
          configured: boolean;
          rootFolderId: string | null;
          source?: string;
        }>('/storage/status');
        setDriveStatus(status);
        if (status.rootFolderId && !gd?.preview?.rootFolderId) {
          setDriveFolderId(status.rootFolderId);
        }
      } catch {
        setDriveStatus(null);
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load settings', 'error');
    }
  }, [toast]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function save(key: string, value: unknown) {
    try {
      await api.put(`/system/settings/${key}`, { value });
      toast(key === 'storage.gdrive' ? 'Saved — secrets encrypted at rest' : 'Saved', 'success');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Save failed', 'error');
    }
  }

  if (!allowed) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <Card>
        <CardHeader title="Default TTS" description="Voiceover provider used when a channel doesn't override it" />
        <div className="space-y-3 p-4">
          <Labeled label="Provider">
            <Input value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)} />
          </Labeled>
          <Labeled label="Speed">
            <Input type="number" step="0.1" value={ttsSpeed} onChange={(e) => setTtsSpeed(e.target.value)} />
          </Labeled>
          <Button variant="primary" size="sm" onClick={() => save('tts.default', { provider: ttsProvider, speed: Number(ttsSpeed) })}>
            Save
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Storage thresholds" description="Disk-usage triggers for warnings and auto-eviction" />
        <div className="space-y-3 p-4">
          <Labeled label="Warn at (% disk used)">
            <Input type="number" value={warnPercent} onChange={(e) => setWarnPercent(e.target.value)} />
          </Labeled>
          <Labeled label="Auto-evict at (% disk used)">
            <Input type="number" value={evictPercent} onChange={(e) => setEvictPercent(e.target.value)} />
          </Labeled>
          <Button variant="primary" size="sm" onClick={() => save('storage.thresholds', { warnPercent: Number(warnPercent), evictPercent: Number(evictPercent) })}>
            Save
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Google Drive media library"
          description="OAuth credentials for archiving finals & thumbnails. Encrypted at rest like Platform Apps — leave a field blank to keep its current value."
        />
        <div className="space-y-3 p-4">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <p className="font-medium text-zinc-800">Setup</p>
            <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
              <li>Enable Google Drive API in your Google Cloud project</li>
              <li>
                Create an OAuth client; authorize once with scope{' '}
                <code className="rounded bg-zinc-200 px-1">drive.file</code> and copy the refresh token
              </li>
              <li>Paste Client ID, Client Secret, Refresh Token, and root folder ID below</li>
              <li>
                Set <code className="rounded bg-zinc-200 px-1">STORAGE_BACKEND=gdrive</code> in server{' '}
                <code className="rounded bg-zinc-200 px-1">.env</code> and restart API + worker
              </li>
            </ol>
            <p className="mt-1.5 text-zinc-500">
              Env vars remain an optional bootstrap fallback. Secrets are never returned in full after save
              (last-4 preview only).
            </p>
          </div>

          {driveStatus ? (
            <div
              className={`rounded-md border px-3 py-2 text-xs ${
                driveStatus.configured
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                  : driveStatus.backend === 'gdrive'
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-600'
              }`}
            >
              <p>
                Status:{' '}
                <span className="font-semibold">
                  {driveStatus.backend === 'local'
                    ? 'Local storage (Drive off)'
                    : driveStatus.configured
                      ? 'Connected'
                      : 'gdrive selected — credentials missing'}
                </span>
              </p>
              <p className="mt-1">
                Backend: <span className="font-medium">{driveStatus.backend}</span>
                {' · '}
                Credentials:{' '}
                <span className="font-medium">
                  {driveStatus.configured
                    ? `present (${driveStatus.source ?? 'unknown'})`
                    : driveConfigured
                      ? 'incomplete'
                      : 'missing'}
                </span>
              </p>
              {driveStatus.rootFolderId && (
                <p className="mt-1 truncate" title={driveStatus.rootFolderId}>
                  Root folder: {driveStatus.rootFolderId}
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">Could not load Drive status (GET /storage/status).</p>
          )}

          <Labeled label={`Client ID ${drivePreview.clientId ? `(…${drivePreview.clientId})` : ''}`}>
            <Input
              value={driveClientId}
              onChange={(e) => setDriveClientId(e.target.value)}
              placeholder="Leave blank to keep current"
              autoComplete="off"
            />
          </Labeled>
          <Labeled label={`Client Secret ${drivePreview.clientSecret ? `(…${drivePreview.clientSecret})` : ''}`}>
            <Input
              type="password"
              value={driveClientSecret}
              onChange={(e) => setDriveClientSecret(e.target.value)}
              placeholder="Leave blank to keep current"
              autoComplete="off"
            />
          </Labeled>
          <Labeled label={`Refresh Token ${drivePreview.refreshToken ? `(…${drivePreview.refreshToken})` : ''}`}>
            <Input
              type="password"
              value={driveRefreshToken}
              onChange={(e) => setDriveRefreshToken(e.target.value)}
              placeholder="Leave blank to keep current"
              autoComplete="off"
            />
          </Labeled>
          <Labeled label="Root folder ID">
            <Input
              value={driveFolderId}
              onChange={(e) => setDriveFolderId(e.target.value)}
              placeholder="From Drive URL …/folders/{id}"
              autoComplete="off"
            />
          </Labeled>
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              save('storage.gdrive', {
                clientId: driveClientId,
                clientSecret: driveClientSecret,
                refreshToken: driveRefreshToken,
                rootFolderId: driveFolderId.trim() || undefined,
              })
            }
          >
            Save Drive credentials
          </Button>
          <p className="text-[11px] text-zinc-500">Leave secret fields blank to keep stored values.</p>
        </div>
      </Card>

      <Card>
        <CardHeader title="Demo data" description="Show designed mock data when there are no real accounts" />
        <div className="flex items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm text-zinc-700">
              Demo mode is <span className="font-semibold">{demoMode ? 'ON' : 'OFF'}</span>
            </p>
            <p className="mt-1 text-xs text-zinc-500">
              When on, pages fall back to mock data if no real accounts are connected. Turn off for live use.
            </p>
          </div>
          <Button
            variant={demoMode ? 'secondary' : 'primary'}
            size="sm"
            onClick={() => save('demo_mode', { enabled: !demoMode })}
          >
            Turn {demoMode ? 'OFF' : 'ON'}
          </Button>
        </div>
      </Card>

      <p className="text-xs text-zinc-500">
        {settings.length} whitelisted setting keys.
      </p>
    </div>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}
