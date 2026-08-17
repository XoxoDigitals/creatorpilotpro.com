'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { isSystemAdmin, type SessionUser, type SettingView } from '@/lib/types';

type DriveStatus = {
  backend: string;
  configured: boolean;
  rootFolderId: string | null;
  source?: string;
  auth?: 'oauth' | 'service_account' | null;
  oauthConnected?: boolean;
  googleAppConfigured?: boolean;
};

type DriveFolder = { id: string; name: string };

export default function GeneralSettingsPage() {
  const toast = useToast();
  const router = useRouter();
  const searchParams = useSearchParams();
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
  const [driveStatus, setDriveStatus] = useState<DriveStatus | null>(null);
  const [showAdvancedOauth, setShowAdvancedOauth] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderParentId, setFolderParentId] = useState('root');
  const [folderStack, setFolderStack] = useState<Array<{ id: string; name: string }>>([
    { id: 'root', name: 'My Drive' },
  ]);
  const [folders, setFolders] = useState<DriveFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(false);
  const [folderBusy, setFolderBusy] = useState(false);

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

  useEffect(() => {
    const gdrive = searchParams.get('gdrive');
    if (!gdrive) return;
    if (gdrive === 'connected') {
      toast('Google Drive connected — select a library folder next', 'success');
    } else if (gdrive === 'error') {
      toast('Google Drive connect failed. Check Platform Apps → Google and try again.', 'error');
    }
    router.replace('/settings', { scroll: false });
  }, [searchParams, toast, router]);

  const load = useCallback(async () => {
    try {
      const list = await api.get<SettingView[]>('/system/settings');
      setSettings(list);
      const tts = list.find((s) => s.key === 'tts.default')?.value as
        | { provider?: string; speed?: number }
        | undefined;
      if (tts) {
        if (tts.provider) setTtsProvider(tts.provider);
        if (typeof tts.speed === 'number') setTtsSpeed(String(tts.speed));
      }
      const st = list.find((s) => s.key === 'storage.thresholds')?.value as
        | { warnPercent?: number; evictPercent?: number }
        | undefined;
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
        const status = await api.get<DriveStatus>('/storage/status');
        setDriveStatus(status);
        if (status.auth === 'service_account' || status.auth === 'oauth') {
          setDriveAuthMode(status.auth);
        }
        if (status.backend === 'gdrive' || status.backend === 'local') {
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

  async function disconnectDrive() {
    try {
      await api.post('/storage/gdrive/disconnect');
      toast('Google Drive disconnected', 'success');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Disconnect failed', 'error');
    }
  }

  async function loadFolders(parentId: string) {
    setFoldersLoading(true);
    try {
      const list = await api.get<DriveFolder[]>(
        `/storage/gdrive/folders?parentId=${encodeURIComponent(parentId)}`,
      );
      setFolders(list);
      setFolderParentId(parentId);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not list folders', 'error');
    } finally {
      setFoldersLoading(false);
    }
  }

  async function openFolderPicker() {
    setFolderPickerOpen(true);
    setFolderStack([{ id: 'root', name: 'My Drive' }]);
    await loadFolders('root');
  }

  async function enterFolder(folder: DriveFolder) {
    setFolderStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
    await loadFolders(folder.id);
  }

  async function goUpTo(index: number) {
    const next = folderStack.slice(0, index + 1);
    setFolderStack(next);
    const target = next[next.length - 1];
    if (target) await loadFolders(target.id);
  }

  async function selectFolderById(id: string) {
    if (!id || id === 'root') {
      toast(
        'Open a folder (or create one in Drive) and select it — My Drive root is not recommended.',
        'error',
      );
      return;
    }
    setFolderBusy(true);
    try {
      const res = await api.put<{ rootFolderId: string }>('/storage/gdrive/root-folder', {
        folderId: id,
      });
      setDriveFolderId(res.rootFolderId);
      setFolderPickerOpen(false);
      toast('Library folder saved', 'success');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save folder', 'error');
    } finally {
      setFolderBusy(false);
    }
  }

  async function selectCurrentFolder() {
    await selectFolderById(folderParentId);
  }

  if (!allowed) return null;

  const oauthConnected = Boolean(driveStatus?.oauthConnected || drivePreview.refreshToken);
  const canBrowseFolders =
    oauthConnected ||
    driveAuthMode === 'service_account' ||
    Boolean(drivePreview.clientEmail);

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
          <Button
            variant="primary"
            size="sm"
            onClick={() => save('tts.default', { provider: ttsProvider, speed: Number(ttsSpeed) })}
          >
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
          <Button
            variant="primary"
            size="sm"
            onClick={() =>
              save('storage.thresholds', {
                warnPercent: Number(warnPercent),
                evictPercent: Number(evictPercent),
              })
            }
          >
            Save
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Google Drive media library"
          description="Connect with the same Google OAuth client as YouTube (Platform Apps), then pick a library folder. Service account remains available as an alternative."
        />
        <div className="space-y-3 p-4">
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
            <p className="font-medium text-zinc-800">Setup</p>
            {driveAuthMode === 'oauth' ? (
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                <li>
                  Configure Google OAuth in <span className="font-medium">Settings → Platform Apps</span>{' '}
                  (same client as YouTube)
                </li>
                <li>
                  Enable <span className="font-medium">Google Drive API</span> for that Google Cloud project
                </li>
                <li>
                  Add the Drive callback redirect URI on the OAuth client (shown under Platform Apps →
                  Google)
                </li>
                <li>
                  Click <span className="font-medium">Connect with Google</span>, then{' '}
                  <span className="font-medium">Select folder</span>
                </li>
                <li>
                  Set <span className="font-medium">Storage backend</span> to Google Drive and click Save —
                  no manual refresh-token paste required
                </li>
              </ol>
            ) : (
              <ol className="mt-1.5 list-decimal space-y-0.5 pl-4">
                <li>
                  Google Cloud Console → <span className="font-medium">IAM &amp; Admin → Service Accounts</span>{' '}
                  → Create service account (any name)
                </li>
                <li>
                  Open the SA → <span className="font-medium">Keys → Add key → JSON</span>; download the key
                  file. Also enable <span className="font-medium">Google Drive API</span> for the project
                  (APIs &amp; Services)
                </li>
                <li>
                  In Google Drive, create (or open) your library folder. Share it with the SA email (
                  <code className="rounded bg-zinc-200 px-1">…@….iam.gserviceaccount.com</code>) as{' '}
                  <span className="font-medium">Editor</span> — or add the SA as a member of a Shared Drive
                </li>
                <li>
                  Paste the JSON key below (or client email + private key), then use{' '}
                  <span className="font-medium">Select folder</span> (or paste the folder ID)
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
                  : driveStatus.backend === 'gdrive' || oauthConnected
                    ? 'border-amber-200 bg-amber-50 text-amber-900'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-600'
              }`}
            >
              <p>
                Status:{' '}
                <span className="font-semibold">
                  {driveStatus.backend === 'local' && !oauthConnected
                    ? 'Local storage (Drive off)'
                    : driveStatus.configured && driveStatus.backend === 'gdrive'
                      ? 'Connected — Google Drive active'
                      : oauthConnected && !driveStatus.rootFolderId
                        ? 'Google connected — select a library folder'
                        : driveStatus.backend === 'gdrive'
                          ? 'Google Drive selected — credentials or folder missing'
                          : oauthConnected
                            ? 'Google connected (backend still Local)'
                            : 'Not connected'}
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
                    ? `ready (${driveStatus.source ?? 'unknown'})`
                    : oauthConnected
                      ? 'OAuth ok — folder needed'
                      : driveConfigured
                        ? 'incomplete'
                        : 'missing'}
                </span>
              </p>
              {(driveStatus.rootFolderId || driveFolderId) && (
                <p className="mt-1 truncate" title={driveStatus.rootFolderId ?? driveFolderId}>
                  Root folder: {driveStatus.rootFolderId ?? driveFolderId}
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
              onChange={(e) => setDriveBackend(e.target.value === 'gdrive' ? 'gdrive' : 'local')}
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
              <option value="oauth">OAuth (Connect with Google)</option>
              <option value="service_account">Service account</option>
            </select>
          </Labeled>

          {driveAuthMode === 'oauth' ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {oauthConnected ? (
                  <>
                    <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-900">
                      Google connected
                    </span>
                    <Button variant="secondary" size="sm" onClick={() => void disconnectDrive()}>
                      Disconnect
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={driveStatus?.googleAppConfigured === false}
                    onClick={() => {
                      window.location.assign('/api/v1/storage/gdrive/connect/start');
                    }}
                  >
                    Connect with Google
                  </Button>
                )}
                {driveStatus?.googleAppConfigured === false && !oauthConnected && (
                  <p className="w-full text-[11px] text-amber-800">
                    Add Client ID/Secret in Settings → Platform Apps → Google first.
                  </p>
                )}
              </div>

              <div className="pt-1">
                <button
                  type="button"
                  className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800"
                  onClick={() => setShowAdvancedOauth((v) => !v)}
                >
                  {showAdvancedOauth ? 'Hide' : 'Show'} advanced (manual Client ID / Secret / Refresh Token)
                </button>
              </div>
              {showAdvancedOauth && (
                <>
                  <Labeled label={`Client ID ${drivePreview.clientId ? `(…${drivePreview.clientId})` : ''}`}>
                    <Input
                      value={driveClientId}
                      onChange={(e) => setDriveClientId(e.target.value)}
                      placeholder="Leave blank to keep current"
                      autoComplete="off"
                    />
                  </Labeled>
                  <Labeled
                    label={`Client Secret ${drivePreview.clientSecret ? `(…${drivePreview.clientSecret})` : ''}`}
                  >
                    <Input
                      type="password"
                      value={driveClientSecret}
                      onChange={(e) => setDriveClientSecret(e.target.value)}
                      placeholder="Leave blank to keep current"
                      autoComplete="off"
                    />
                  </Labeled>
                  <Labeled
                    label={`Refresh Token ${drivePreview.refreshToken ? `(…${drivePreview.refreshToken})` : ''}`}
                  >
                    <Input
                      type="password"
                      value={driveRefreshToken}
                      onChange={(e) => setDriveRefreshToken(e.target.value)}
                      placeholder="Leave blank to keep current"
                      autoComplete="off"
                    />
                  </Labeled>
                </>
              )}
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

          <div className="space-y-2">
            <Labeled label="Root folder ID">
              <div className="flex flex-wrap gap-2">
                <Input
                  className="min-w-0 flex-1"
                  value={driveFolderId}
                  onChange={(e) => setDriveFolderId(e.target.value)}
                  placeholder="From Drive URL …/folders/{id} or use Select folder"
                  autoComplete="off"
                />
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!canBrowseFolders}
                  onClick={() => void openFolderPicker()}
                >
                  Select folder
                </Button>
              </div>
            </Labeled>
            {!canBrowseFolders && (
              <p className="text-[11px] text-zinc-500">
                Connect with Google (or save a service account) before browsing folders.
              </p>
            )}
          </div>

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

      {folderPickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-lg border border-zinc-200 bg-white shadow-lg">
            <div className="border-b border-zinc-200 px-4 py-3">
              <p className="text-sm font-semibold text-zinc-900">Select library folder</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Open a folder, then click Use this folder.
              </p>
              <div className="mt-2 flex flex-wrap gap-1 text-xs text-zinc-600">
                {folderStack.map((crumb, i) => (
                  <button
                    key={`${crumb.id}-${i}`}
                    type="button"
                    className="rounded px-1 hover:bg-zinc-100 hover:underline"
                    onClick={() => void goUpTo(i)}
                  >
                    {i > 0 ? ' / ' : ''}
                    {crumb.name}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {foldersLoading ? (
                <p className="px-2 py-6 text-center text-xs text-zinc-500">Loading folders…</p>
              ) : folders.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-zinc-500">No subfolders here.</p>
              ) : (
                <ul className="space-y-0.5">
                  {folders.map((f) => (
                    <li key={f.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        className="min-w-0 flex-1 rounded-md px-2 py-2 text-left text-sm text-zinc-800 hover:bg-zinc-100"
                        onClick={() => void enterFolder(f)}
                      >
                        <span className="truncate">{f.name}</span>
                      </button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={folderBusy}
                        onClick={() => void selectFolderById(f.id)}
                      >
                        Select
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3">
              <Button variant="secondary" size="sm" onClick={() => setFolderPickerOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={folderBusy || folderParentId === 'root'}
                onClick={() => void selectCurrentFolder()}
              >
                Use this folder
              </Button>
            </div>
          </div>
        </div>
      )}

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

      <p className="text-xs text-zinc-500">{settings.length} whitelisted setting keys.</p>
    </div>
  );
}

function Labeled({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-zinc-600">{label}</span>
      {children}
    </label>
  );
}
