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
  const [driveClientEmail, setDriveClientEmail] = useState('');
  const [drivePrivateKey, setDrivePrivateKey] = useState('');
  const [driveSaJson, setDriveSaJson] = useState('');
  const [driveAuthMode, setDriveAuthMode] = useState<'oauth' | 'service_account'>('oauth');
  const [driveBackend, setDriveBackend] = useState<'local' | 'gdrive'>('local');
  const [driveFolderId, setDriveFolderId] = useState('');
  const [drivePreview, setDrivePreview] = useState<Record<string, string>>({});
  const [driveConfigured, setDriveConfigured] = useState(false);
  const [driveStatus, setDriveStatus] = useState<{
    backend: string;
    configured: boolean;
    rootFolderId: string | null;
    source?: string;
    auth?: 'oauth' | 'service_account' | null;
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
      const mode = gd?.preview?.authMode;
      setDriveAuthMode(mode === 'service_account' ? 'service_account' : 'oauth');
      const previewBackend = gd?.preview?.backend;
      setDriveBackend(previewBackend === 'gdrive' ? 'gdrive' : 'local');
      setDriveClientId('');
      setDriveClientSecret('');
      setDriveRefreshToken('');
      setDriveClientEmail('');
      setDrivePrivateKey('');
      setDriveSaJson('');
      const dm = list.find((s) => s.key === 'demo_mode')?.value as { enabled?: boolean } | undefined;
      setDemoMode(dm?.enabled ?? false);
      try {
        const status = await api.get<{
          backend: string;
          configured: boolean;
          rootFolderId: string | null;
          source?: string;
          auth?: 'oauth' | 'service_account' | null;
        }>('/storage/status');
        setDriveStatus(status);
        if (status.auth === 'service_account' || status.auth === 'oauth') {
          setDriveAuthMode(status.auth);
        }
        if (status.backend === 'gdrive' || status.backend === 'local') {
          // Prefer live status (settings + env fallback) when preview has no backend yet.
          if (!previewBackend) setDriveBackend(status.backend);
        }
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
          description="Choose Local or Google Drive as the media system of record, then paste OAuth or service-account credentials. Encrypted at rest like Platform Apps — leave a secret field blank to keep its current value. No .env edit required."
        />
        <div className="space-y-3 p-4">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <p className="font-medium text-zinc-800">Setup</p>
            {driveAuthMode === 'oauth' ? (
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                <li>In Google Cloud Console, enable the Google Drive API for your project</li>
                <li>
                  Create an OAuth client; authorize once with scope{' '}
                  <code className="rounded bg-zinc-200 px-1">drive.file</code> and copy the refresh token
                </li>
                <li>Paste Client ID, Client Secret, Refresh Token, and root folder ID below</li>
                <li>
                  Set <span className="font-medium">Storage backend</span> to Google Drive and click Save —
                  no <code className="rounded bg-zinc-200 px-1">.env</code> change needed
                </li>
              </ol>
            ) : (
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                <li>
                  Google Cloud Console → <span className="font-medium">IAM &amp; Admin → Service Accounts</span> →
                  Create service account (any name)
                </li>
                <li>
                  Open the SA → <span className="font-medium">Keys → Add key → JSON</span>; download the key file.
                  Also enable <span className="font-medium">Google Drive API</span> for the project (APIs &amp; Services)
                </li>
                <li>
                  In Google Drive, create (or open) your library folder. Share it with the SA email (
                  <code className="rounded bg-zinc-200 px-1">…@….iam.gserviceaccount.com</code>) as{' '}
                  <span className="font-medium">Editor</span> — or add the SA as a member of a Shared Drive
                </li>
                <li>
                  Paste the JSON key below (or client email + private key), and the folder ID from the Drive URL (
                  <code className="rounded bg-zinc-200 px-1">drive.google.com/…/folders/FOLDER_ID</code>)
                </li>
                <li>
                  Set <span className="font-medium">Storage backend</span> to Google Drive and click Save —
                  API + worker pick this up from Settings (no{' '}
                  <code className="rounded bg-zinc-200 px-1">STORAGE_BACKEND</code> in{' '}
                  <code className="rounded bg-zinc-200 px-1">.env</code>)
                </li>
              </ol>
            )}
            <p className="mt-1.5 text-zinc-500">
              Env vars remain an optional bootstrap fallback. Secrets are never returned in full after save
              (last-4 preview only).
            </p>
          </div>

          {driveStatus ? (
            <div
              className={`rounded-md border px-3 py-2 text-xs ${
                driveStatus.configured && driveStatus.backend === 'gdrive'
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
                      ? 'Connected — Google Drive active'
                      : 'Google Drive selected — credentials missing'}
                </span>
              </p>
              <p className="mt-1">
                Backend: <span className="font-medium">{driveStatus.backend}</span>
                {' · '}
                Auth:{' '}
                <span className="font-medium">
                  {(driveStatus.auth ?? driveAuthMode) === 'service_account'
                    ? 'Service account'
                    : 'OAuth'}
                </span>
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

          <Labeled label="Storage backend">
            <select
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900"
              value={driveBackend}
              onChange={(e) =>
                setDriveBackend(e.target.value === 'gdrive' ? 'gdrive' : 'local')
              }
            >
              <option value="local">Local storage (Drive off)</option>
              <option value="gdrive">Google Drive</option>
            </select>
          </Labeled>

          <Labeled label="Auth mode">
            <select
              className="h-9 w-full rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900"
              value={driveAuthMode}
              onChange={(e) =>
                setDriveAuthMode(e.target.value === 'service_account' ? 'service_account' : 'oauth')
              }
            >
              <option value="oauth">OAuth refresh token</option>
              <option value="service_account">Service account</option>
            </select>
          </Labeled>

          {driveAuthMode === 'oauth' ? (
            <>
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
            </>
          ) : (
            <>
              <Labeled label="Paste service account JSON (optional)">
                <textarea
                  className="min-h-[88px] w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs text-zinc-900"
                  value={driveSaJson}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setDriveSaJson(raw);
                    try {
                      const parsed = JSON.parse(raw) as {
                        client_email?: string;
                        private_key?: string;
                      };
                      if (parsed.client_email) setDriveClientEmail(parsed.client_email);
                      if (parsed.private_key) setDrivePrivateKey(parsed.private_key);
                    } catch {
                      // Incomplete JSON while typing — ignore.
                    }
                  }}
                  placeholder='{"type":"service_account","client_email":"…","private_key":"-----BEGIN…"}'
                  autoComplete="off"
                  spellCheck={false}
                />
              </Labeled>
              <Labeled label={`Client email ${drivePreview.clientEmail ? `(…${drivePreview.clientEmail})` : ''}`}>
                <Input
                  value={driveClientEmail}
                  onChange={(e) => setDriveClientEmail(e.target.value)}
                  placeholder="…@….iam.gserviceaccount.com"
                  autoComplete="off"
                />
              </Labeled>
              <Labeled label={`Private key ${drivePreview.privateKey ? `(…${drivePreview.privateKey})` : ''}`}>
                <textarea
                  className="min-h-[88px] w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 font-mono text-xs text-zinc-900"
                  value={drivePrivateKey}
                  onChange={(e) => setDrivePrivateKey(e.target.value)}
                  placeholder="Leave blank to keep current — PEM including BEGIN/END lines"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Labeled>
            </>
          )}

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
                backend: driveBackend,
                authMode: driveAuthMode,
                ...(driveAuthMode === 'oauth'
                  ? {
                      clientId: driveClientId,
                      clientSecret: driveClientSecret,
                      refreshToken: driveRefreshToken,
                    }
                  : {
                      clientEmail: driveClientEmail,
                      privateKey: drivePrivateKey,
                    }),
                rootFolderId: driveFolderId.trim() || undefined,
              })
            }
          >
            Save Drive settings
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
