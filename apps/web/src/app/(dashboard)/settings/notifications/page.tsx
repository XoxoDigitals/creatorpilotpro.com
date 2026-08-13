'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Field } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { SettingView } from '@/lib/types';

export default function NotificationsSettingsPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<SettingView[]>([]);

  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [smtpUrl, setSmtpUrl] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');

  const load = useCallback(async () => {
    try {
      setSettings(await api.get<SettingView[]>('/system/settings'));
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to load settings', 'error');
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const isConfigured = (key: string) => settings.find((s) => s.key === key)?.configured ?? false;

  async function save(key: string, value: unknown) {
    try {
      await api.put(`/system/settings/${key}`, { value });
      toast('Saved', 'success');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Save failed', 'error');
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <p className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
        These are secrets — stored AES-256-GCM encrypted and never shown again. Leave a field blank to keep the existing value.
      </p>

      <Card>
        <CardHeader
          title="Telegram"
          description="Owner + Admin get instant alerts on incidents"
          action={
            isConfigured('notifications.telegram')
              ? <Badge tone="green">Configured</Badge>
              : <Badge tone="neutral">Not configured</Badge>
          }
        />
        <div className="space-y-3 p-4">
          <Field label="Bot token">
            <Input
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="123456:ABC-…"
            />
          </Field>
          <Field label="Chat ID">
            <Input value={chatId} onChange={(e) => setChatId(e.target.value)} />
          </Field>
          <Button variant="primary" size="sm"
            onClick={() => save('notifications.telegram', { botToken, chatId })}>
            Save Telegram
          </Button>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="SMTP email"
          description="Fallback channel + daily digest"
          action={
            isConfigured('notifications.smtp')
              ? <Badge tone="green">Configured</Badge>
              : <Badge tone="neutral">Not configured</Badge>
          }
        />
        <div className="space-y-3 p-4">
          <Field label="SMTP URL">
            <Input
              type="password"
              value={smtpUrl}
              onChange={(e) => setSmtpUrl(e.target.value)}
              placeholder="smtps://user:pass@smtp.host:465"
            />
          </Field>
          <Field label="From address">
            <Input
              value={smtpFrom}
              onChange={(e) => setSmtpFrom(e.target.value)}
              placeholder="SocialCreatorPilot <noreply@…>"
            />
          </Field>
          <Button variant="primary" size="sm"
            onClick={() => save('notifications.smtp', { url: smtpUrl, from: smtpFrom })}>
            Save SMTP
          </Button>
        </div>
      </Card>
    </div>
  );
}
