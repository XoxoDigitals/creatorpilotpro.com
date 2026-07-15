'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { getApiAccount, getAccountView, type ApiAccount } from '@/lib/api-data';
import type { ContentType } from '@/lib/domain-types';

/**
 * Channel Profile editor (FR-G). For a real account, Save persists via
 * PATCH /accounts/:id (contentType, dramas) + PATCH /accounts/:id/profile.
 * Demo accounts fall back to a toast (nothing to persist).
 */
export default function AccountSettingsPage() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();

  const [loading, setLoading] = useState(true);
  const [real, setReal] = useState<ApiAccount | null>(null);
  const [saving, setSaving] = useState(false);

  const [contentType, setContentType] = useState<ContentType>('AI');
  const [dramasEnabled, setDramasEnabled] = useState(false);
  const [masterPrompt, setMasterPrompt] = useState('');
  const [writingStyle, setWritingStyle] = useState('');
  const [narrationStyle, setNarrationStyle] = useState('');
  const [language, setLanguage] = useState('en');
  const [ttsProvider, setTtsProvider] = useState('kokoro');
  const [voice, setVoice] = useState('af_bella');
  const [titleTemplate, setTitleTemplate] = useState('{{hook}} — {{topic}}');
  const [tags, setTags] = useState('shorts, viral, daily');
  const [aiLabel, setAiLabel] = useState(true);
  const [scriptGate, setScriptGate] = useState(true);
  const [maxPerDay, setMaxPerDay] = useState('2');
  const [minGap, setMinGap] = useState('3');

  const load = useCallback(async () => {
    setLoading(true);
    const apiAccount = await getApiAccount(id);
    if (apiAccount) {
      setReal(apiAccount);
      setContentType(apiAccount.contentType);
      setDramasEnabled(apiAccount.dramasEnabled);
      const p = apiAccount.profile;
      if (p) {
        setMasterPrompt(p.masterPrompt);
        setWritingStyle(p.writingStyle);
        setNarrationStyle(p.narrationStyle);
        setLanguage(p.language);
        if (p.titleTemplate) setTitleTemplate(p.titleTemplate);
        if (p.defaultTags?.length) setTags(p.defaultTags.join(', '));
        setAiLabel(p.aiLabelDefault);
        const voice = p.voiceSettings as { provider?: string; voiceId?: string } | null;
        if (voice?.provider) setTtsProvider(voice.provider);
        if (voice?.voiceId) setVoice(voice.voiceId);
        const approval = p.approvalPolicy as { scriptGate?: boolean } | null;
        if (typeof approval?.scriptGate === 'boolean') setScriptGate(approval.scriptGate);
        const sched = p.schedulingPrefs as { maxPerDay?: number; minGapMin?: number } | null;
        if (typeof sched?.maxPerDay === 'number') setMaxPerDay(String(sched.maxPerDay));
        if (typeof sched?.minGapMin === 'number') setMinGap(String(Math.round(sched.minGapMin / 60)));
      }
    } else {
      // Demo (or missing) account: populate the pipeline toggles for display.
      setReal(null);
      const { account } = await getAccountView(id);
      if (account) {
        setContentType(account.contentType);
        setDramasEnabled(account.dramasEnabled);
      }
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!real) {
      toast('Demo account — connect a real account to persist changes.', 'info');
      return;
    }
    setSaving(true);
    try {
      const existingSched = (real.profile?.schedulingPrefs ?? {}) as Record<string, unknown>;
      await api.patch(`/accounts/${id}`, { contentType, dramasEnabled });
      await api.patch(`/accounts/${id}/profile`, {
        masterPrompt,
        writingStyle,
        narrationStyle,
        language,
        voiceSettings: { provider: ttsProvider, voiceId: voice },
        titleTemplate,
        defaultTags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        aiLabelDefault: aiLabel,
        approvalPolicy: { scriptGate },
        schedulingPrefs: {
          cadence: 'PER_DAY',
          times: [],
          ...existingSched,
          maxPerDay: Number(maxPerDay) || 1,
          minGapMin: (Number(minGap) || 0) * 60,
        },
      });
      toast('Channel profile saved', 'success');
      await load();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Save failed', 'error');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-3xl space-y-6">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      {!real && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo account — Save is illustrative. Connect a real account to persist a channel profile.
        </div>
      )}
      <Card>
        <CardHeader
          title="Content pipeline"
          description="Decides which workspace tabs and pipelines this account uses"
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Content type">
            <Select value={contentType} onChange={(e) => setContentType(e.target.value as ContentType)}>
              <option value="AI">AI content</option>
              <option value="REPURPOSED">Repurposed content</option>
              <option value="MIXED">Both (mixed)</option>
            </Select>
          </Field>
          <Field label="Language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="ur">Urdu</option>
              <option value="hi">Hindi</option>
            </Select>
          </Field>
          <div className="sm:col-span-2">
            <Toggle
              checked={dramasEnabled}
              onChange={setDramasEnabled}
              label="Enable AI drama series (adds the Dramas tab to this account)"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Ideas generation is available on AI and Mixed accounts only; Dramas is this separate
              toggle and works on any account type.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Master prompt & styles"
          description="Injected into every AI task for this account — analysis, rewriting, metadata, ideas"
        />
        <div className="space-y-4 p-4">
          <Field label="Master prompt">
            <Textarea rows={5} value={masterPrompt} onChange={(e) => setMasterPrompt(e.target.value)} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Writing style">
              <Textarea rows={3} value={writingStyle} onChange={(e) => setWritingStyle(e.target.value)} />
            </Field>
            <Field label="Narration / voiceover style">
              <Textarea
                rows={3}
                value={narrationStyle}
                onChange={(e) => setNarrationStyle(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Voice" description="Provider and voice used for generated voiceovers" />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="TTS provider">
            <Select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)}>
              <option value="kokoro">Kokoro (self-hosted, free)</option>
              <option value="gemini">Gemini TTS</option>
              <option value="openai">OpenAI TTS</option>
            </Select>
          </Field>
          <Field label="Voice">
            <Input value={voice} onChange={(e) => setVoice(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Publish defaults" description="Applied to every post on this account" />
        <div className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title template">
              <Input value={titleTemplate} onChange={(e) => setTitleTemplate(e.target.value)} />
            </Field>
            <Field label="Default tags (comma-separated)">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
          </div>
          <Toggle
            checked={aiLabel}
            onChange={setAiLabel}
            label="Mark uploads as AI-generated content (platform disclosure)"
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Approval policy & throughput"
          description="Which gates are manual, and how fast this account publishes"
        />
        <div className="space-y-4 p-4">
          <Toggle
            checked={scriptGate}
            onChange={setScriptGate}
            label="Require manual approval of AI-rewritten scripts before voiceover"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Max posts per day">
              <Input type="number" min={1} value={maxPerDay} onChange={(e) => setMaxPerDay(e.target.value)} />
            </Field>
            <Field label="Minimum gap between posts (hours)">
              <Input type="number" min={0} value={minGap} onChange={(e) => setMinGap(e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button onClick={() => void load()}>Discard</Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save channel profile'}
        </Button>
      </div>
    </div>
  );
}
