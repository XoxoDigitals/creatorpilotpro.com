'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field, Toggle } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';

interface SettingView {
  key: string;
  secret: boolean;
  configured: boolean;
  preview?: Record<string, string>;
  value?: unknown;
}

export default function PlatformAppsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<Record<string, SettingView>>({});
  const [webOrigin, setWebOrigin] = useState('http://localhost:3000');

  const [googleClientId, setGoogleClientId] = useState('');
  const [googleClientSecret, setGoogleClientSecret] = useState('');
  const [googleDirectUpload, setGoogleDirectUpload] = useState(true);
  const [youtubeDataApiKey, setYoutubeDataApiKey] = useState('');

  const [metaAppId, setMetaAppId] = useState('');
  const [metaAppSecret, setMetaAppSecret] = useState('');

  const [tiktokKey, setTiktokKey] = useState('');
  const [tiktokSecret, setTiktokSecret] = useState('');

  const load = useCallback(async () => {
    if (typeof window !== 'undefined') setWebOrigin(window.location.origin);
    try {
      const list = await api.get<SettingView[]>('/system/settings');
      const map: Record<string, SettingView> = {};
      for (const s of list) map[s.key] = s;
      setSettings(map);

      const g = map['platform_apps.google']?.value as { directUpload?: boolean } | undefined;
      if (g?.directUpload != null) setGoogleDirectUpload(g.directUpload);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load settings', 'error');
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  async function save(key: string, value: unknown) {
    try {
      await api.put(`/system/settings/${key}`, { value });
      toast('Saved — secret is encrypted at rest', 'success');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Save failed', 'error');
    }
  }

  const googleRedirect = `${webOrigin}/api/v1/accounts/connect/google/callback`;
  const metaRedirect = `${webOrigin}/api/v1/accounts/connect/meta/callback`;
  const tiktokRedirect = `${webOrigin}/api/v1/accounts/connect/tiktok/callback`;
  const metaWebhookUrl = `${webOrigin}/api/v1/webhooks/meta`;

  return (
    <div className="max-w-3xl space-y-6">
      <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
        Secrets are encrypted with AES-256-GCM before storage and never returned by the API.
        Only the last-4 of stored values shows as a preview. Leave a field blank to keep its current value.
      </p>

      {/* YouTube Data API key — own card so it is not mistaken for OAuth Client Secret */}
      <Card>
        <CardHeader
          title="YouTube Data API key"
          description="Required for competitor Ideas: resolve channel URLs and poll uploads. Separate from Google OAuth below."
          action={<StatusBadge configured={settings['youtubeDataApiKey']?.configured ?? false} />}
        />
        <div className="space-y-3 p-4">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            This is a Google Cloud <b>API key</b> (starts with <code className="rounded bg-amber-100 px-1">AIza…</code>),
            not the OAuth Client ID / Client Secret used to connect your channel.
            Create one under Google Cloud → Credentials → API key, and restrict it to YouTube Data API v3.
          </p>
          <Field label={<>API key {previewOf(settings, 'youtubeDataApiKey', 'apiKey')}</>}>
            <Input
              type="password"
              placeholder="AIza..."
              value={youtubeDataApiKey}
              onChange={(e) => setYoutubeDataApiKey(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Button
            variant="primary"
            size="sm"
            onClick={() => save('youtubeDataApiKey', { apiKey: youtubeDataApiKey })}
          >
            Save YouTube Data API key
          </Button>
        </div>
      </Card>

      {/* Google Cloud OAuth */}
      <Card>
        <CardHeader
          title="Google Cloud OAuth (YouTube channel connect)"
          description="OAuth client for connecting your channels, YouTube Analytics, and direct video upload."
          action={<StatusBadge configured={settings['platform_apps.google']?.configured ?? false} />}
        />
        <div className="space-y-3 p-4">
          <Field label={<>Client ID {previewOf(settings, 'platform_apps.google', 'clientId')}</>}>
            <Input placeholder="1234567890-abc.apps.googleusercontent.com"
              value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={<>Client Secret {previewOf(settings, 'platform_apps.google', 'clientSecret')}</>}>
            <Input type="password" placeholder="GOCSPX-..."
              value={googleClientSecret} onChange={(e) => setGoogleClientSecret(e.target.value)} autoComplete="off" />
          </Field>
          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-xs font-medium text-zinc-700">Enable direct YouTube upload</p>
              <p className="text-xs text-zinc-500">Uses the YouTube Data API v3 to upload videos (needs quota approval).</p>
            </div>
            <Toggle checked={googleDirectUpload} onChange={setGoogleDirectUpload} />
          </div>
          <Button variant="primary" size="sm"
            onClick={() => save('platform_apps.google', {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
              directUpload: googleDirectUpload,
            })}>
            Save Google OAuth
          </Button>

          <SetupGuide title="How to set up Google Cloud">
            <ol className="ml-4 list-decimal space-y-2">
              <li>Open the <ExtLink href="https://console.cloud.google.com/projectcreate">Google Cloud console</ExtLink> and create a new project (or use an existing one).</li>
              <li>Enable APIs: search for <b>YouTube Data API v3</b> and <b>YouTube Analytics API</b>, then click <b>Enable</b> on each.</li>
              <li>
                For competitor Ideas: <ExtLink href="https://console.cloud.google.com/apis/credentials">Credentials → Create credentials → API key</ExtLink>.
                Restrict the key to YouTube Data API v3, paste it in the <b>YouTube Data API key</b> card above, and click <b>Save YouTube Data API key</b>.
              </li>
              <li>Configure the <ExtLink href="https://console.cloud.google.com/apis/credentials/consent">OAuth consent screen</ExtLink>. If your channels live under a Google Workspace organization, choose <b>Internal</b> — this skips app verification entirely.</li>
              <li>Go to <ExtLink href="https://console.cloud.google.com/apis/credentials">Credentials → Create credentials → OAuth client ID</ExtLink>. Application type = <b>Web application</b>.</li>
              <li>Add this <b>Authorized redirect URI</b> and save: <Callback url={googleRedirect} /></li>
              <li>Add scopes on the OAuth consent screen: <code className="rounded bg-zinc-100 px-1">youtube.upload</code>, <code className="rounded bg-zinc-100 px-1">youtube.readonly</code>, <code className="rounded bg-zinc-100 px-1">yt-analytics.readonly</code>, <code className="rounded bg-zinc-100 px-1">yt-analytics-monetary.readonly</code> (revenue).</li>
              <li>Copy the generated <b>Client ID</b> and <b>Client Secret</b> into the fields above and click <b>Save Google OAuth</b>.</li>
              <li>YouTube&apos;s default upload quota is 6 videos/day per project. Request more via the <b>YouTube API Services - Audit and Quota Extension</b> form linked from the Cloud console. Approvals typically take 1–4 weeks.</li>
              <li>Once saved, use <b>Accounts → Connect account → Google</b> to authorize each channel individually.</li>
            </ol>
          </SetupGuide>
        </div>
      </Card>

      {/* Meta / Facebook */}
      <Card>
        <CardHeader
          title="Meta (Facebook Pages + Reels)"
          description="App credentials for publishing Facebook Reels and reading Page Insights."
          action={<StatusBadge configured={settings['platform_apps.meta']?.configured ?? false} />}
        />
        <div className="space-y-3 p-4">
          <Field label={<>App ID {previewOf(settings, 'platform_apps.meta', 'appId')}</>}>
            <Input placeholder="1234567890123456"
              value={metaAppId} onChange={(e) => setMetaAppId(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={<>App Secret {previewOf(settings, 'platform_apps.meta', 'appSecret')}</>}>
            <Input type="password" placeholder="abcd1234..."
              value={metaAppSecret} onChange={(e) => setMetaAppSecret(e.target.value)} autoComplete="off" />
          </Field>
          <Button variant="primary" size="sm"
            onClick={() => save('platform_apps.meta', { appId: metaAppId, appSecret: metaAppSecret })}>
            Save Meta
          </Button>

          <SetupGuide title="How to set up Meta">
            <ol className="ml-4 list-decimal space-y-2">
              <li>Go to <ExtLink href="https://developers.facebook.com/apps/">Meta for Developers → My Apps → Create app</ExtLink>. Choose type <b>Business</b>.</li>
              <li>Under <b>App settings → Basic</b> copy the <b>App ID</b> and <b>App Secret</b>.</li>
              <li>Add the <b>Facebook Login for Business</b> product. Under its <b>Settings</b>, add this URI to <b>Valid OAuth Redirect URIs</b>: <Callback url={metaRedirect} /></li>
              <li>On <b>App Review → Permissions and Features</b>, request:
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs">
                  <li><code className="rounded bg-zinc-100 px-1">pages_show_list</code> — list the Pages the user manages</li>
                  <li><code className="rounded bg-zinc-100 px-1">pages_read_engagement</code> — read Page Insights</li>
                  <li><code className="rounded bg-zinc-100 px-1">pages_manage_posts</code> — publish Reels</li>
                  <li><code className="rounded bg-zinc-100 px-1">pages_read_user_content</code> — verify posts and read reactions</li>
                  <li><code className="rounded bg-zinc-100 px-1">business_management</code> — required for Business App Review</li>
                </ul>
              </li>
              <li>App Review submission needs a screencast of the Login flow + a use-case explanation. Approval usually 3–7 days.</li>
              <li>While in <b>Development mode</b>, only Roles-added test users can authorize. Add yourself as a developer under <b>Roles</b> to try before review.</li>
              <li>Webhook (optional but recommended): <b>Products → Webhooks → Page</b>. Callback URL: <Callback url={metaWebhookUrl} />. Subscribe to the fields <code className="rounded bg-zinc-100 px-1">feed</code>, <code className="rounded bg-zinc-100 px-1">videos</code>, <code className="rounded bg-zinc-100 px-1">reels</code>. Verify token is any string — copy it into the app's env as <code className="rounded bg-zinc-100 px-1">META_WEBHOOK_VERIFY_TOKEN</code>.</li>
              <li>Copy App ID + App Secret above and click <b>Save Meta</b>. Then <b>Accounts → Connect account → Meta</b> starts the Page picker flow.</li>
            </ol>
          </SetupGuide>
        </div>
      </Card>

      {/* TikTok */}
      <Card>
        <CardHeader
          title="TikTok"
          description="Client key/secret for TikTok Login Kit + Content Posting API — native DIRECT_POST publishing."
          action={<StatusBadge configured={settings['platform_apps.tiktok']?.configured ?? false} />}
        />
        <div className="space-y-3 p-4">
          <Field label={<>Client Key {previewOf(settings, 'platform_apps.tiktok', 'clientKey')}</>}>
            <Input placeholder="aw..."
              value={tiktokKey} onChange={(e) => setTiktokKey(e.target.value)} autoComplete="off" />
          </Field>
          <Field label={<>Client Secret {previewOf(settings, 'platform_apps.tiktok', 'clientSecret')}</>}>
            <Input type="password" placeholder="tiktok_secret_..."
              value={tiktokSecret} onChange={(e) => setTiktokSecret(e.target.value)} autoComplete="off" />
          </Field>
          <Button variant="primary" size="sm"
            onClick={() => save('platform_apps.tiktok', { clientKey: tiktokKey, clientSecret: tiktokSecret })}>
            Save TikTok
          </Button>

          <SetupGuide title="How to set up TikTok">
            <ol className="ml-4 list-decimal space-y-2">
              <li>Go to <ExtLink href="https://developers.tiktok.com/apps/">TikTok for Developers → Manage apps → Connect an app</ExtLink>.</li>
              <li>Add the <b>Login Kit</b> and <b>Content Posting API</b> products.</li>
              <li>Under <b>Login Kit → Redirect URI</b>, add: <Callback url={tiktokRedirect} /></li>
              <li>Under <b>Login Kit → Scopes</b>, request:
                <ul className="ml-4 mt-1 list-disc space-y-0.5 text-xs">
                  <li><code className="rounded bg-zinc-100 px-1">user.info.basic</code></li>
                  <li><code className="rounded bg-zinc-100 px-1">video.upload</code></li>
                  <li><code className="rounded bg-zinc-100 px-1">video.publish</code></li>
                </ul>
              </li>
              <li>Submit the app for <b>Audit</b>. TikTok requires a working demo of the Content Posting API flow before granting Production access. Review usually 5–14 days.</li>
              <li>Copy <b>Client Key</b> and <b>Client Secret</b> above and click <b>Save TikTok</b>.</li>
              <li>You can save credentials now — connecting a TikTok account will unlock once the native adapter is wired (tracked as follow-up).</li>
            </ol>
          </SetupGuide>
        </div>
      </Card>
    </div>
  );
}

function StatusBadge({ configured }: { configured: boolean }) {
  return configured
    ? <Badge tone="green">Configured</Badge>
    : <Badge tone="neutral">Not configured</Badge>;
}

function previewOf(settings: Record<string, SettingView>, key: string, field: string) {
  const p = settings[key]?.preview?.[field];
  if (!p) return null;
  return <span className="ml-2 text-zinc-400">•••• {p}</span>;
}

function ExtLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener"
       className="font-medium text-indigo-700 underline hover:text-indigo-900">
      {children}
    </a>
  );
}

function Callback({ url }: { url: string }) {
  return (
    <code className="mt-1 block break-all rounded bg-zinc-100 px-2 py-1 text-[11px] text-zinc-800">
      {url}
    </code>
  );
}

function SetupGuide({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-zinc-700 hover:bg-zinc-100"
      >
        <span>{title}</span>
        <span className="text-xs text-zinc-500">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open && (
        <div className="border-t border-zinc-200 bg-white px-4 py-3 text-xs leading-relaxed text-zinc-700">
          {children}
        </div>
      )}
    </div>
  );
}
