'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  emptyStyleProfileAnswers,
  defaultVoiceForLanguage,
  contentLanguageSelectOptions,
  contentLanguageOptionLabel,
  DEFAULT_BACKGROUND_BED_PERCENT,
  clampBackgroundBedPercent,
  type StyleProfileAnswers,
} from '@scp/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import {
  StyleQuestionnaire,
  answersFromProfile,
  styleProfileFromState,
} from '@/components/style-questionnaire';
import { CrosspostAccountPicker } from '@/components/crosspost-account-picker';
import { api, ApiError } from '@/lib/api';
import {
  getApiAccount,
  getAccountView,
  publishDefaultsFromProfile,
  deleteAccount,
  type ApiAccount,
  type ChannelScheduleMode,
} from '@/lib/api-data';
import type { ContentType } from '@/lib/domain-types';
import { cn } from '@/lib/cn';

interface EdgeVoice {
  name: string;
  shortName: string;
  gender: string;
  locale: string;
  label: string;
}

type ScheduleCadence = 'PER_DAY' | 'SPECIFIC_DAYS';

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_SLOT_TIMES = ['09:00', '13:00', '18:00', '21:00'];
const WEEKDAYS: { id: string; label: string }[] = [
  { id: 'mon', label: 'Mon' },
  { id: 'tue', label: 'Tue' },
  { id: 'wed', label: 'Wed' },
  { id: 'thu', label: 'Thu' },
  { id: 'fri', label: 'Fri' },
  { id: 'sat', label: 'Sat' },
  { id: 'sun', label: 'Sun' },
];

function normalizeTimes(count: number, existing: string[]): string[] {
  const n = Math.max(1, Math.min(50, count));
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const prev = existing[i]?.trim();
    out.push(prev && TIME_RE.test(prev) ? prev : DEFAULT_SLOT_TIMES[i] ?? '18:00');
  }
  return out;
}

function normalizeDayId(raw: string): string | null {
  const key = raw.trim().slice(0, 3).toLowerCase();
  return WEEKDAYS.some((d) => d.id === key) ? key : null;
}

interface ComposeMasterPromptResponse {
  masterPrompt: string;
  writingStyle: string;
  narrationStyle: string;
  tags?: string[];
  source: 'ai' | 'local';
}

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
  const [generatingPrompt, setGeneratingPrompt] = useState(false);
  const [generatingTags, setGeneratingTags] = useState(false);

  const [contentType, setContentType] = useState<ContentType>('AI');
  const [dramasEnabled, setDramasEnabled] = useState(false);
  const [masterPrompt, setMasterPrompt] = useState('');
  const [writingStyle, setWritingStyle] = useState('');
  const [narrationStyle, setNarrationStyle] = useState('');
  const [styleAnswers, setStyleAnswers] = useState<StyleProfileAnswers>(emptyStyleProfileAnswers());
  const [masterPromptOverridden, setMasterPromptOverridden] = useState(false);
  const [showAdvancedStyles, setShowAdvancedStyles] = useState(false);
  const [animationReferencePrompt, setAnimationReferencePrompt] = useState('');
  const [language, setLanguage] = useState('en');
  const [ttsProvider, setTtsProvider] = useState('edge');
  const [voice, setVoice] = useState('en-US-AriaNeural');
  const [voiceLocale, setVoiceLocale] = useState('en-US');
  const [voiceRate, setVoiceRate] = useState('+0%');
  const [voicePitch, setVoicePitch] = useState('+0Hz');
  const [voiceVolume, setVoiceVolume] = useState('+0%');
  const [backgroundBedPercent, setBackgroundBedPercent] = useState(DEFAULT_BACKGROUND_BED_PERCENT);
  const [voices, setVoices] = useState<EdgeVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [ttsStatus, setTtsStatus] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [titleTemplate, setTitleTemplate] = useState('{{hook}} — {{topic}}');
  const [descriptionTemplate, setDescriptionTemplate] = useState(
    '{{description}} — {{default-content}}',
  );
  const [thumbnailReferencePrompt, setThumbnailReferencePrompt] = useState('');
  const [tags, setTags] = useState('shorts, viral, daily');
  const [aiLabel, setAiLabel] = useState(true);
  const [scriptGate, setScriptGate] = useState(true);
  const [scheduleCadence, setScheduleCadence] = useState<ScheduleCadence>('PER_DAY');
  const [scheduleDays, setScheduleDays] = useState<string[]>(['mon', 'wed', 'fri']);
  const [maxPerDay, setMaxPerDay] = useState('2');
  const [postTimes, setPostTimes] = useState<string[]>(['09:00', '18:00']);
  const [minGap, setMinGap] = useState('3');
  const [defaultScheduleMode, setDefaultScheduleMode] =
    useState<ChannelScheduleMode>('QUEUE_SLOT');
  const [defaultCrosspostIds, setDefaultCrosspostIds] = useState<string[]>([]);
  const [timezone, setTimezone] = useState('Asia/Karachi');
  const [randomizeMinutes, setRandomizeMinutes] = useState('0');
  const [defaultVisibility, setDefaultVisibility] = useState<'PUBLIC' | 'UNLISTED' | 'PRIVATE'>(
    'PUBLIC',
  );
  const [defaultCategory, setDefaultCategory] = useState('22');

  const localeOptions = useMemo(() => {
    const set = new Set(voices.map((v) => v.locale).filter(Boolean));
    return Array.from(set).sort();
  }, [voices]);

  const filteredVoices = useMemo(() => {
    if (!voiceLocale) return voices;
    return voices.filter(
      (v) =>
        v.locale.toLowerCase() === voiceLocale.toLowerCase() ||
        v.shortName.toLowerCase().startsWith(voiceLocale.toLowerCase()),
    );
  }, [voices, voiceLocale]);

  const voiceNotes = useMemo(() => {
    const parts = [
      `provider=${ttsProvider}`,
      `voice=${voice}`,
      voiceLocale ? `locale=${voiceLocale}` : '',
      voiceRate !== '+0%' ? `rate=${voiceRate}` : '',
      voicePitch !== '+0Hz' ? `pitch=${voicePitch}` : '',
    ].filter(Boolean);
    return parts.join(', ');
  }, [ttsProvider, voice, voiceLocale, voiceRate, voicePitch]);

  const loadVoices = useCallback(async (locale?: string) => {
    setVoicesLoading(true);
    try {
      const q = locale ? `?locale=${encodeURIComponent(locale)}` : '';
      const res = await api.get<{ voices: EdgeVoice[] }>(`/ai/tts/voices${q}`);
      setVoices(res.voices ?? []);
      const status = await api.get<{ ok: boolean; detail: string; versionHint: string }>(
        '/ai/tts/status',
      );
      setTtsStatus(
        status.ok
          ? `Edge TTS ready${status.versionHint ? ` (${status.versionHint})` : ''}`
          : status.detail,
      );
    } catch (err) {
      setTtsStatus(err instanceof ApiError ? err.message : 'Could not reach Edge TTS');
      setVoices([]);
    } finally {
      setVoicesLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const apiAccount = await getApiAccount(id);
    if (apiAccount) {
      setReal(apiAccount);
      setContentType(apiAccount.contentType);
      setDramasEnabled(apiAccount.dramasEnabled);
      const p = apiAccount.profile;
      if (p) {
        const fromProfile = answersFromProfile(p.styleProfile);
        setStyleAnswers(fromProfile.answers);
        setMasterPromptOverridden(fromProfile.masterPromptOverridden);
        setMasterPrompt(p.masterPrompt);
        setWritingStyle(p.writingStyle);
        setNarrationStyle(p.narrationStyle);
        setAnimationReferencePrompt(p.animationReferencePrompt ?? '');
        setLanguage(p.language);
        if (p.titleTemplate) setTitleTemplate(p.titleTemplate);
        if (p.descriptionTemplate) setDescriptionTemplate(p.descriptionTemplate);
        setThumbnailReferencePrompt(p.thumbnailReferencePrompt ?? '');
        if (p.defaultTags?.length) setTags(p.defaultTags.join(', '));
        setAiLabel(p.aiLabelDefault);
        const voiceCfg = p.voiceSettings as {
          provider?: string;
          voiceId?: string;
          locale?: string;
          rate?: string;
          pitch?: string;
          volume?: string;
          backgroundBedPercent?: number;
        } | null;
        const defaults = defaultVoiceForLanguage(p.language);
        setTtsProvider(voiceCfg?.provider || defaults.provider);
        setVoice(voiceCfg?.voiceId || defaults.voiceId);
        setVoiceLocale(voiceCfg?.locale || defaults.locale);
        if (voiceCfg?.rate) setVoiceRate(voiceCfg.rate);
        if (voiceCfg?.pitch) setVoicePitch(voiceCfg.pitch);
        if (voiceCfg?.volume) setVoiceVolume(voiceCfg.volume);
        setBackgroundBedPercent(
          clampBackgroundBedPercent(
            voiceCfg?.backgroundBedPercent ?? DEFAULT_BACKGROUND_BED_PERCENT,
          ),
        );
        const approval = p.approvalPolicy as { scriptGate?: boolean } | null;
        if (typeof approval?.scriptGate === 'boolean') setScriptGate(approval.scriptGate);
        const sched = p.schedulingPrefs as {
          cadence?: ScheduleCadence;
          maxPerDay?: number;
          perDay?: number;
          minGapMin?: number;
          times?: string[];
          days?: string[];
          randomizeMinutes?: number;
          defaultVisibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
          defaultCategory?: string;
        } | null;
        const posts =
          typeof sched?.maxPerDay === 'number'
            ? sched.maxPerDay
            : typeof sched?.perDay === 'number'
              ? sched.perDay
              : Array.isArray(sched?.times) && sched.times.length > 0
                ? sched.times.length
                : 2;
        setMaxPerDay(String(posts));
        setPostTimes(normalizeTimes(posts, Array.isArray(sched?.times) ? sched.times : []));
        if (typeof sched?.minGapMin === 'number') setMinGap(String(Math.round(sched.minGapMin / 60)));
        if (typeof sched?.randomizeMinutes === 'number') {
          setRandomizeMinutes(String(sched.randomizeMinutes));
        } else {
          setRandomizeMinutes('0');
        }
        if (sched?.defaultVisibility) setDefaultVisibility(sched.defaultVisibility);
        if (sched?.defaultCategory) setDefaultCategory(sched.defaultCategory);
        if (sched?.cadence === 'SPECIFIC_DAYS') {
          setScheduleCadence('SPECIFIC_DAYS');
          const loaded = (sched.days ?? [])
            .map(normalizeDayId)
            .filter((d): d is string => Boolean(d));
          if (loaded.length) setScheduleDays(loaded);
        } else {
          setScheduleCadence('PER_DAY');
        }
        const publishDefaults = publishDefaultsFromProfile(p);
        setDefaultScheduleMode(publishDefaults.scheduleMode);
        setDefaultCrosspostIds(publishDefaults.crosspostAccountIds);
        if (fromProfile.masterPromptOverridden || p.masterPrompt.trim()) setShowAdvancedStyles(true);
      }
      setTimezone(
        apiAccount.timezone && apiAccount.timezone !== 'UTC'
          ? apiAccount.timezone
          : 'Asia/Karachi',
      );
    } else {
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

  useEffect(() => {
    if (ttsProvider === 'edge') void loadVoices();
  }, [ttsProvider, loadVoices]);

  function applyLanguage(next: string) {
    setLanguage(next);
    const defaults = defaultVoiceForLanguage(next);
    setVoiceLocale(defaults.locale);
    if (ttsProvider === 'edge') {
      setVoice(defaults.voiceId);
    }
  }

  function setPostsPerDay(raw: string) {
    setMaxPerDay(raw);
    const n = Number(raw) || 1;
    setPostTimes((prev) => normalizeTimes(n, prev));
  }

  function setPostTimeAt(index: number, value: string) {
    setPostTimes((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function toggleScheduleDay(dayId: string) {
    setScheduleDays((prev) =>
      prev.includes(dayId) ? prev.filter((d) => d !== dayId) : [...prev, dayId],
    );
  }

  function composePayload() {
    return {
      language,
      answers: styleAnswers,
      animationReferencePrompt,
      thumbnailReferencePrompt,
      titleTemplate,
      descriptionTemplate,
      writingStyle,
      narrationStyle,
      contentType,
      voiceNotes,
    };
  }

  async function generateMasterPrompt() {
    setGeneratingPrompt(true);
    try {
      const res = await api.post<ComposeMasterPromptResponse>(
        '/ai/compose-master-prompt',
        composePayload(),
      );
      setMasterPrompt(res.masterPrompt);
      setWritingStyle(res.writingStyle);
      setNarrationStyle(res.narrationStyle);
      setMasterPromptOverridden(true);
      if (res.tags?.length) setTags(res.tags.join(', '));
      toast(
        res.source === 'ai'
          ? 'Master prompt & tags generated with AI'
          : 'Master prompt generated (system style — AI polish unavailable)',
        'success',
      );
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not generate prompt', 'error');
    } finally {
      setGeneratingPrompt(false);
    }
  }

  async function generateTags() {
    setGeneratingTags(true);
    try {
      const res = await api.post<ComposeMasterPromptResponse>('/ai/compose-master-prompt', {
        ...composePayload(),
        localOnly: false,
      });
      if (res.tags?.length) {
        setTags(res.tags.join(', '));
        toast(
          res.source === 'ai' ? 'Default tags generated with AI' : 'Default tags generated locally',
          'success',
        );
      } else {
        toast('No tags returned — fill the questionnaire and try again', 'info');
      }
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not generate tags', 'error');
    } finally {
      setGeneratingTags(false);
    }
  }

  async function previewVoice() {
    if (ttsProvider !== 'edge') {
      toast('Preview is available for Edge Neural voices', 'info');
      return;
    }
    setPreviewing(true);
    try {
      const res = await api.post<{ mimeType: string; audioBase64: string }>('/ai/tts/preview', {
        voiceId: voice,
        rate: voiceRate,
        pitch: voicePitch,
        volume: voiceVolume,
      });
      const audio = new Audio(`data:${res.mimeType};base64,${res.audioBase64}`);
      await audio.play();
      toast('Playing voice preview', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Preview failed', 'error');
    } finally {
      setPreviewing(false);
    }
  }

  async function save() {
    if (!real) {
      toast('Demo account — connect a real account to persist changes.', 'info');
      return;
    }
    const posts = Math.max(1, Math.min(50, Number(maxPerDay) || 1));
    const times = normalizeTimes(posts, postTimes);
    const bad = times.find((t) => !TIME_RE.test(t));
    if (bad) {
      toast(`Invalid post time "${bad}" — use HH:MM (24h).`, 'error');
      return;
    }
    if (scheduleCadence === 'SPECIFIC_DAYS' && scheduleDays.length === 0) {
      toast('Select at least one weekday for specific-days scheduling.', 'error');
      return;
    }
    setSaving(true);
    try {
      const existingSched = (real.profile?.schedulingPrefs ?? {}) as Record<string, unknown>;
      const styleProfile = styleProfileFromState(styleAnswers, masterPromptOverridden);
      await api.patch(`/accounts/${id}`, { contentType, dramasEnabled, timezone });
      await api.patch(`/accounts/${id}/profile`, {
        masterPrompt,
        writingStyle,
        narrationStyle,
        styleProfile,
        language,
        voiceSettings: {
          provider: ttsProvider,
          voiceId: voice,
          locale: voiceLocale,
          rate: voiceRate,
          pitch: voicePitch,
          volume: voiceVolume,
          language,
          backgroundBedPercent: clampBackgroundBedPercent(backgroundBedPercent),
        },
        titleTemplate,
        descriptionTemplate,
        thumbnailReferencePrompt,
        animationReferencePrompt,
        defaultTags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        aiLabelDefault: aiLabel,
        approvalPolicy: { scriptGate },
        schedulingPrefs: {
          ...existingSched,
          cadence: scheduleCadence,
          perDay: posts,
          maxPerDay: posts,
          times,
          minGapMin: (Number(minGap) || 0) * 60,
          randomizeMinutes: Math.max(0, Math.min(720, Number(randomizeMinutes) || 0)),
          ...(scheduleCadence === 'SPECIFIC_DAYS'
            ? { days: scheduleDays }
            : { days: [] }),
          defaultScheduleMode,
          defaultCrosspostAccountIds: defaultCrosspostIds,
          defaultVisibility,
          defaultCategory: defaultCategory.trim() || undefined,
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
          title="1. Content pipeline"
          description="Which workspace tabs and pipelines this account uses"
        />
        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <Field label="Content type">
            <Select value={contentType} onChange={(e) => setContentType(e.target.value as ContentType)}>
              <option value="AI">AI content</option>
              <option value="REPURPOSED">Repurposed content</option>
              <option value="MIXED">Both (mixed)</option>
            </Select>
          </Field>
          <Field label="Output language">
            <Select value={language} onChange={(e) => applyLanguage(e.target.value)}>
              {contentLanguageSelectOptions(language).map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {contentLanguageOptionLabel(lang)}
                </option>
              ))}
            </Select>
          </Field>
          <p className="sm:col-span-2 text-xs text-zinc-500">
            Voiceover, dialogues, on-screen text, and publish title / description / tags use this
            language. Ideas, stories, and image / video prompts stay in English. Saving also picks
            a matching Edge Neural voice (you can still change the specific voice below).
          </p>
          <div className="sm:col-span-2">
            <Toggle
              checked={dramasEnabled}
              onChange={setDramasEnabled}
              label="Enable AI drama series (adds the Dramas tab)"
            />
            <p className="mt-1 text-xs text-zinc-500">
              Ideas generation is on AI and Mixed accounts only. Dramas works on any content type.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="2. Brand & master prompt"
          description="Questionnaire + guidelines → one master brief injected into every AI task"
        />
        <div className="space-y-4 p-4">
          <StyleQuestionnaire
            answers={styleAnswers}
            animationReferencePrompt={animationReferencePrompt}
            masterPrompt={masterPrompt}
            writingStyle={writingStyle}
            narrationStyle={narrationStyle}
            showAdvanced={showAdvancedStyles}
            generating={generatingPrompt}
            onAnswersChange={setStyleAnswers}
            onAnimationReferenceChange={setAnimationReferencePrompt}
            onMasterPromptChange={setMasterPrompt}
            onWritingStyleChange={setWritingStyle}
            onNarrationStyleChange={setNarrationStyle}
            onOverrideChange={setMasterPromptOverridden}
            onShowAdvancedChange={setShowAdvancedStyles}
            onGeneratePrompt={generateMasterPrompt}
          />
          <Field label="Thumbnail reference prompt">
            <Textarea
              value={thumbnailReferencePrompt}
              onChange={(e) => setThumbnailReferencePrompt(e.target.value)}
              rows={4}
              placeholder="e.g. High-contrast close-up face, bold yellow title text top-left, dark vignette, cinematic rim light…"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Included when you generate the master prompt; also used for package thumbnail prompts.
            </p>
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="3. Publish metadata"
          description="Default title, description, and tags applied to posts on this account"
        />
        <div className="space-y-4 p-4">
          <Field label="Title template">
            <Input
              value={titleTemplate}
              onChange={(e) => setTitleTemplate(e.target.value)}
              placeholder="{{hook}} — {{topic}}"
            />
          </Field>
          <Field label="Description template">
            <Textarea
              value={descriptionTemplate}
              onChange={(e) => setDescriptionTemplate(e.target.value)}
              rows={3}
              placeholder="{{description}} — {{default-content}}"
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Use placeholders like {'{{description}}'} and {'{{default-content}}'} for AI-filled
              vs fixed channel copy.
            </p>
          </Field>
          <div className="space-y-2">
            <Field label="Default tags (comma-separated)">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void generateTags()}
                disabled={generatingTags || generatingPrompt}
              >
                {generatingTags ? 'Generating…' : 'Generate tags'}
              </Button>
              <span className="text-[11px] text-zinc-500">
                Also filled when you generate the master prompt.
              </span>
            </div>
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
          title="4. Approval policy"
          description="Human review gates before voiceover / publish"
        />
        <div className="p-4">
          <Toggle
            checked={scriptGate}
            onChange={setScriptGate}
            label="Require manual approval of AI-rewritten scripts before voiceover"
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="5. Daily posting schedule"
          description="Posts per day, weekdays, and time slots used for “next free slot”"
        />
        <div className="space-y-4 p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Account timezone">
              <Input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                list="scp-timezones"
                placeholder="Asia/Karachi"
              />
              <datalist id="scp-timezones">
                {[
                  'Asia/Karachi',
                  'UTC',
                  'America/Los_Angeles',
                  'America/Denver',
                  'America/Chicago',
                  'America/New_York',
                  'Europe/London',
                  'Europe/Paris',
                  'Asia/Dubai',
                  'Asia/Kolkata',
                  'Asia/Singapore',
                  'Australia/Sydney',
                ].map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
              <p className="mt-1 text-[11px] text-zinc-500">
                Default is Asia/Karachi. Post times below are wall-clock in this timezone (not UTC).
              </p>
            </Field>
            <Field label="Randomize slot (± minutes)">
              <Input
                type="number"
                min={0}
                max={720}
                value={randomizeMinutes}
                onChange={(e) => setRandomizeMinutes(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-zinc-500">
                0 = exact time. Use a small value (e.g. 10) to vary slightly around each slot.
              </p>
            </Field>
          </div>

          <Field label="Cadence">
            <Select
              value={scheduleCadence}
              onChange={(e) => setScheduleCadence(e.target.value as ScheduleCadence)}
            >
              <option value="PER_DAY">Every day</option>
              <option value="SPECIFIC_DAYS">Specific days</option>
            </Select>
          </Field>

          {scheduleCadence === 'SPECIFIC_DAYS' && (
            <div>
              <span className="mb-1.5 block text-xs font-medium text-zinc-700">Posting days</span>
              <div className="flex flex-wrap gap-1.5">
                {WEEKDAYS.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleScheduleDay(d.id)}
                    className={cn(
                      'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
                      scheduleDays.includes(d.id)
                        ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                        : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50',
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-zinc-500">
                Slots are only planned on selected weekdays (account timezone).
              </p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Posts per day">
              <Input
                type="number"
                min={1}
                max={50}
                value={maxPerDay}
                onChange={(e) => setPostsPerDay(e.target.value)}
              />
            </Field>
            <Field label="Minimum gap between posts (hours)">
              <Input type="number" min={0} value={minGap} onChange={(e) => setMinGap(e.target.value)} />
            </Field>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-zinc-700">
              Post times{scheduleCadence === 'SPECIFIC_DAYS' ? ' (on selected days)' : ' (each day)'}
            </p>
            <p className="text-[11px] text-zinc-500">
              One time slot per post. Times use 24-hour HH:MM in this account’s timezone.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {postTimes.map((time, index) => (
                <Field key={`post-time-${index}`} label={`Post ${index + 1}`}>
                  <Input
                    type="time"
                    value={time}
                    onChange={(e) => setPostTimeAt(index, e.target.value)}
                  />
                </Field>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="6. Voice"
          description="Default Edge Neural TTS voice (falls back to Kokoro → Gemini → OpenAI)"
        />
        <div className="space-y-4 p-4">
          {ttsStatus && (
            <p className={`text-xs ${ttsStatus.startsWith('Edge TTS ready') ? 'text-emerald-700' : 'text-amber-700'}`}>
              {ttsStatus}
            </p>
          )}
          <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-zinc-700">
                Background music / ambience
              </span>
              <span className="text-xs font-semibold tabular-nums text-zinc-800">
                {backgroundBedPercent}%
              </span>
            </div>
            <input
              type="range"
              min={1}
              max={100}
              step={1}
              value={backgroundBedPercent}
              onChange={(e) =>
                setBackgroundBedPercent(clampBackgroundBedPercent(e.target.value))
              }
              className="w-full accent-indigo-600"
              aria-label="Background music and ambience level"
            />
            <p className="text-[11px] text-zinc-500">
              1% = almost silent bed · 100% = same level as the voiceover. Apply with
              Re-render on existing videos (does not re-run TTS).
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="TTS provider">
              <Select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)}>
                <option value="edge">Edge Neural (default)</option>
                <option value="kokoro">Kokoro (self-hosted)</option>
                <option value="gemini">Gemini TTS</option>
                <option value="openai">OpenAI TTS</option>
              </Select>
            </Field>
            {ttsProvider === 'edge' ? (
              <Field label="Voice locale">
                <Select
                  value={voiceLocale}
                  onChange={(e) => {
                    setVoiceLocale(e.target.value);
                    const first = voices.find((v) => v.locale === e.target.value);
                    if (first) setVoice(first.shortName);
                  }}
                >
                  {localeOptions.length === 0 ? (
                    <option value={voiceLocale}>{voiceLocale}</option>
                  ) : (
                    localeOptions.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))
                  )}
                </Select>
              </Field>
            ) : (
              <Field label="Voice id">
                <Input value={voice} onChange={(e) => setVoice(e.target.value)} />
              </Field>
            )}
          </div>
          {ttsProvider === 'edge' && (
            <>
              <Field label="Voice">
                <Select
                  value={voice}
                  onChange={(e) => setVoice(e.target.value)}
                  disabled={voicesLoading}
                >
                  {filteredVoices.length === 0 ? (
                    <option value={voice}>{voice}</option>
                  ) : (
                    filteredVoices.map((v) => (
                      <option key={v.shortName} value={v.shortName}>
                        {v.label}
                      </option>
                    ))
                  )}
                </Select>
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label="Rate">
                  <Input value={voiceRate} onChange={(e) => setVoiceRate(e.target.value)} placeholder="+0%" />
                </Field>
                <Field label="Pitch">
                  <Input value={voicePitch} onChange={(e) => setVoicePitch(e.target.value)} placeholder="+0Hz" />
                </Field>
                <Field label="Volume">
                  <Input value={voiceVolume} onChange={(e) => setVoiceVolume(e.target.value)} placeholder="+0%" />
                </Field>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void previewVoice()} disabled={previewing}>
                  {previewing ? 'Generating…' : 'Preview voice'}
                </Button>
                <Button type="button" onClick={() => void loadVoices()}>
                  Refresh voices
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="7. Publish timing & crosspost"
          description="Defaults when you upload a finished idea or manual video"
        />
        <div className="space-y-4 p-4">
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs font-medium text-zinc-700">When to publish</legend>
            {(
              [
                ['QUEUE_SLOT', 'Next free slot', "Uses this account's schedule rules above"],
                ['NOW', 'Publish now (immediately)', 'Dispatches after Review Approve'],
              ] as const
            ).map(([value, label, hint]) => (
              <label
                key={value}
                className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs hover:border-zinc-300"
              >
                <input
                  type="radio"
                  name="default-schedule-mode"
                  checked={defaultScheduleMode === value}
                  onChange={() => setDefaultScheduleMode(value)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium text-zinc-800">{label}</span>
                  <span className="block text-[11px] text-zinc-500">{hint}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <div className="rounded-md border border-zinc-200 bg-zinc-50/80 p-3 space-y-3">
            <p className="text-xs font-medium text-zinc-800">
              {real?.platform === 'YOUTUBE'
                ? 'YouTube publish defaults'
                : real?.platform === 'TIKTOK'
                  ? 'TikTok publish defaults'
                  : real?.platform === 'FACEBOOK'
                    ? 'Facebook publish defaults'
                    : 'Platform publish defaults'}
            </p>
            <p className="text-[11px] text-zinc-500">
              Same controls on every channel — mapped to each platform’s native options at publish
              time (YouTube privacy/category, TikTok privacy, Facebook Reel visibility).
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Visibility">
                <Select
                  value={defaultVisibility}
                  onChange={(e) =>
                    setDefaultVisibility(e.target.value as 'PUBLIC' | 'UNLISTED' | 'PRIVATE')
                  }
                >
                  <option value="PUBLIC">Public</option>
                  <option value="UNLISTED">Unlisted</option>
                  <option value="PRIVATE">Private / friends</option>
                </Select>
              </Field>
              <Field label="YouTube category ID">
                <Input
                  value={defaultCategory}
                  onChange={(e) => setDefaultCategory(e.target.value)}
                  placeholder="22"
                  disabled={real?.platform === 'FACEBOOK' || real?.platform === 'TIKTOK'}
                />
                <p className="mt-1 text-[11px] text-zinc-500">
                  Used for YouTube (22 = People & Blogs). Ignored on Facebook/TikTok.
                </p>
              </Field>
            </div>
          </div>

          <CrosspostAccountPicker
            primaryAccountId={id}
            selectedIds={defaultCrosspostIds}
            onChange={setDefaultCrosspostIds}
            disabled={!real}
          />

          <p className="text-xs text-zinc-500">
            Connect another platform from Accounts to crosspost. Shared title/description are used;
            each platform enforces its own limits. Review still approves before any target publishes.
          </p>
        </div>
      </Card>

      {real && (
        <Card className="border-red-200">
          <CardHeader
            title="Delete this account"
            description="Soft-deletes the connection. Content and ideas stay in the database but the account disappears from the UI."
          />
          <div className="px-4 pb-4">
            <Button
              variant="danger"
              disabled={saving}
              onClick={() => {
                if (
                  !confirm(
                    `Delete account “${real.name}”? It will be disconnected and hidden.`,
                  )
                ) {
                  return;
                }
                void (async () => {
                  try {
                    await deleteAccount(id);
                    toast('Account deleted', 'success');
                    window.location.href = '/accounts';
                  } catch (err) {
                    toast(err instanceof Error ? err.message : 'Failed to delete account', 'error');
                  }
                })();
              }}
            >
              Delete account
            </Button>
          </div>
        </Card>
      )}

      <div className="flex justify-end gap-2">
        <Button onClick={() => void load()}>Discard</Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save channel profile'}
        </Button>
      </div>
    </div>
  );
}
