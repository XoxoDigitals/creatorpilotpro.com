'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  emptyStyleProfileAnswers,
  defaultVoiceForLanguage,
  contentLanguageSelectOptions,
  contentLanguageOptionLabel,
  edgeVoiceTone,
  DEFAULT_BACKGROUND_BED_PERCENT,
  clampBackgroundBedPercent,
  DEFAULT_TRIM_START_MS,
  DEFAULT_RENDER_SETTINGS,
  renderSettingsFromVoiceSettings,
  clampTrimStartMs,
  TTS_EMOTIONS,
  TTS_EMOTION_LABELS,
  parseTtsEmotion,
  type StyleProfileAnswers,
  type LockedCharacter,
  type TtsEmotion,
  type CaptionTemplateId,
  type ColorFilterPreset,
  type HookTextSource,
  type OverlayPosition,
  type RenderSettings,
  CAPTION_TEMPLATES,
  CAPTION_TEMPLATE_PICKER,
  OVERLAY_POSITIONS,
  OVERLAY_POSITION_LABELS,
  CAPTION_COLOR_MODES,
  CAPTION_COLOR_MODE_LABELS,
  YOUTUBE_CATEGORIES,
  YOUTUBE_COUNTRIES,
  CONTENT_LANGUAGES,
  type CaptionColorMode,
} from '@scp/shared';
import { Card, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Field, Input, Select, Textarea, Toggle } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import {
  StyleQuestionnaire,
  answersFromProfile,
  styleProfileFromState,
} from '@/components/style-questionnaire';
import { CrosspostAccountPicker } from '@/components/crosspost-account-picker';
import { api, apiUpload, ApiError } from '@/lib/api';
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

function isReactionVideoAsset(mimeType?: string | null, assetPath?: string | null): boolean {
  if (mimeType && mimeType.toLowerCase().startsWith('video/')) return true;
  return /\.(mp4|webm|mov|m4v)$/i.test(assetPath ?? '');
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
  const [lockedCharacters, setLockedCharacters] = useState<LockedCharacter[]>([]);
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
  const [voiceEmotion, setVoiceEmotion] = useState<TtsEmotion>('default');
  const [backgroundBedPercent, setBackgroundBedPercent] = useState(DEFAULT_BACKGROUND_BED_PERCENT);
  const [voices, setVoices] = useState<EdgeVoice[]>([]);
  const [voicesLoading, setVoicesLoading] = useState(false);
  const [ttsStatus, setTtsStatus] = useState<string | null>(null);
  const [previewingVoiceId, setPreviewingVoiceId] = useState<string | null>(null);
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
  const [defaultMadeForKids, setDefaultMadeForKids] = useState(false);
  const [defaultPublishLanguage, setDefaultPublishLanguage] = useState('en');
  const [defaultRecordingCountry, setDefaultRecordingCountry] = useState('');
  const [renderSettings, setRenderSettings] = useState<RenderSettings>({ ...DEFAULT_RENDER_SETTINGS });
  const [settingsSection, setSettingsSection] = useState<
    | 'pipeline'
    | 'brand'
    | 'metadata'
    | 'approval'
    | 'schedule'
    | 'voice'
    | 'render'
    | 'publish'
    | 'danger'
  >('pipeline');

  const settingsTabs: { id: typeof settingsSection; label: string }[] = [
    { id: 'pipeline', label: 'Content pipeline' },
    { id: 'brand', label: 'Brand & prompt' },
    { id: 'metadata', label: 'Publish metadata' },
    { id: 'approval', label: 'Approval' },
    { id: 'schedule', label: 'Posting schedule' },
    { id: 'voice', label: 'Voice' },
    { id: 'render', label: 'Render effects' },
    { id: 'publish', label: 'Timing & crosspost' },
    ...(real ? [{ id: 'danger' as const, label: 'Delete' }] : []),
  ];

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
      voiceEmotion !== 'default' ? `emotion=${voiceEmotion}` : '',
    ].filter(Boolean);
    return parts.join(', ');
  }, [ttsProvider, voice, voiceLocale, voiceRate, voicePitch, voiceEmotion]);

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
        setLockedCharacters(fromProfile.lockedCharacters);
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
          emotion?: string;
          backgroundBedPercent?: number;
        } | null;
        const defaults = defaultVoiceForLanguage(p.language);
        setTtsProvider(voiceCfg?.provider || defaults.provider);
        setVoice(voiceCfg?.voiceId || defaults.voiceId);
        setVoiceLocale(voiceCfg?.locale || defaults.locale);
        if (voiceCfg?.rate) setVoiceRate(voiceCfg.rate);
        if (voiceCfg?.pitch) setVoicePitch(voiceCfg.pitch);
        if (voiceCfg?.volume) setVoiceVolume(voiceCfg.volume);
        setVoiceEmotion(parseTtsEmotion(voiceCfg?.emotion));
        setBackgroundBedPercent(
          clampBackgroundBedPercent(
            voiceCfg?.backgroundBedPercent ?? DEFAULT_BACKGROUND_BED_PERCENT,
          ),
        );
        setRenderSettings(renderSettingsFromVoiceSettings(p.voiceSettings));
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
          defaultMadeForKids?: boolean;
          defaultLanguage?: string;
          defaultRecordingCountry?: string;
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
        if (typeof sched?.defaultMadeForKids === 'boolean') {
          setDefaultMadeForKids(sched.defaultMadeForKids);
        }
        setDefaultPublishLanguage(sched?.defaultLanguage || p.language || 'en');
        setDefaultRecordingCountry(sched?.defaultRecordingCountry ?? '');
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
      lockedCharacters,
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

  async function previewVoice(voiceId: string) {
    if (ttsProvider !== 'edge') {
      toast('Preview is available for Edge Neural voices', 'info');
      return;
    }
    setPreviewingVoiceId(voiceId);
    try {
      const res = await api.post<{ mimeType: string; audioBase64: string }>('/ai/tts/preview', {
        voiceId,
        rate: voiceRate,
        pitch: voicePitch,
        volume: voiceVolume,
        emotion: voiceEmotion,
      });
      const audio = new Audio(`data:${res.mimeType};base64,${res.audioBase64}`);
      await audio.play();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Preview failed', 'error');
    } finally {
      setPreviewingVoiceId(null);
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
      const styleProfile = styleProfileFromState(styleAnswers, masterPromptOverridden, lockedCharacters);
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
          emotion: voiceEmotion,
          language,
          backgroundBedPercent: clampBackgroundBedPercent(backgroundBedPercent),
          renderSettings: {
            trimStartMs: clampTrimStartMs(renderSettings.trimStartMs),
            burnCaptions: {
              enabled: renderSettings.burnCaptions.enabled,
              preset: renderSettings.burnCaptions.preset,
              position: renderSettings.burnCaptions.position ?? 'center',
              colorMode: renderSettings.burnCaptions.colorMode ?? 'dark',
              ...(renderSettings.burnCaptions.fontSize != null
                ? { fontSize: renderSettings.burnCaptions.fontSize }
                : {}),
            },
            hookText: {
              enabled: renderSettings.hookText.enabled,
              source: renderSettings.hookText.source,
              maxWords: renderSettings.hookText.maxWords ?? 8,
              maxLines: renderSettings.hookText.maxLines ?? 2,
              position: renderSettings.hookText.position ?? 'top',
              ...(renderSettings.hookText.customText?.trim()
                ? { customText: renderSettings.hookText.customText.trim() }
                : {}),
              ...(renderSettings.hookText.fontSize != null
                ? { fontSize: renderSettings.hookText.fontSize }
                : {}),
            },
            flipHorizontal: { enabled: renderSettings.flipHorizontal.enabled },
            colorFilter: {
              enabled: renderSettings.colorFilter.enabled,
              preset: renderSettings.colorFilter.preset,
            },
            reactionAvatar: {
              enabled: renderSettings.reactionAvatar?.enabled ?? false,
              shape: renderSettings.reactionAvatar?.shape ?? 'circle',
              corner: renderSettings.reactionAvatar?.corner ?? 'br',
              sizePercent: renderSettings.reactionAvatar?.sizePercent ?? 22,
              showDuring: renderSettings.reactionAvatar?.showDuring ?? 'always',
              removeBg: renderSettings.reactionAvatar?.removeBg ?? 'auto',
              chromakeyColor: renderSettings.reactionAvatar?.chromakeyColor ?? '#00B140',
              chromakeySimilarity: renderSettings.reactionAvatar?.chromakeySimilarity ?? 0.3,
              chromakeyBlend: renderSettings.reactionAvatar?.chromakeyBlend ?? 0.1,
              ...(renderSettings.reactionAvatar?.assetPath
                ? { assetPath: renderSettings.reactionAvatar.assetPath }
                : {}),
              ...(renderSettings.reactionAvatar?.fileName
                ? { fileName: renderSettings.reactionAvatar.fileName }
                : {}),
              ...(renderSettings.reactionAvatar?.mimeType
                ? { mimeType: renderSettings.reactionAvatar.mimeType }
                : {}),
              ...(renderSettings.reactionAvatar?.lipSyncAssetPath
                ? { lipSyncAssetPath: renderSettings.reactionAvatar.lipSyncAssetPath }
                : {}),
              ...(renderSettings.reactionAvatar?.lipSyncFileName
                ? { lipSyncFileName: renderSettings.reactionAvatar.lipSyncFileName }
                : {}),
              ...(renderSettings.reactionAvatar?.lipSyncMimeType
                ? { lipSyncMimeType: renderSettings.reactionAvatar.lipSyncMimeType }
                : {}),
            },
          },
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
          defaultMadeForKids,
          defaultLanguage: defaultPublishLanguage || undefined,
          defaultRecordingCountry: defaultRecordingCountry.trim() || undefined,
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
      <div className="w-full space-y-6">
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      {!real && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Demo account — Save is illustrative. Connect a real account to persist a channel profile.
        </div>
      )}

      <nav className="flex gap-1 overflow-x-auto border-b border-zinc-200">
        {settingsTabs.map((tab) => {
          const active = settingsSection === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setSettingsSection(tab.id)}
              className={cn(
                '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-indigo-600 font-medium text-indigo-700'
                  : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800',
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>

      {settingsSection === 'pipeline' && (
      <Card>
        <CardHeader
          title="Content pipeline"
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
      )}

      {settingsSection === 'brand' && (
      <Card>
        <CardHeader
          title="Brand & structured master prompt"
          description="Audio mode first, then niche, visuals, and story. Generate a numbered master brief (hooks, visual DNA, mixed VO timeline) that you can edit and save."
        />
        <div className="space-y-4 p-4">
          <StyleQuestionnaire
            answers={styleAnswers}
            lockedCharacters={lockedCharacters}
            animationReferencePrompt={animationReferencePrompt}
            masterPrompt={masterPrompt}
            writingStyle={writingStyle}
            narrationStyle={narrationStyle}
            showAdvanced={showAdvancedStyles}
            generating={generatingPrompt}
            onAnswersChange={setStyleAnswers}
            onLockedCharactersChange={setLockedCharacters}
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
      )}

      {settingsSection === 'metadata' && (
      <Card>
        <CardHeader
          title="Publish metadata"
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
      )}

      {settingsSection === 'approval' && (
      <Card>
        <CardHeader
          title="Approval policy"
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
      )}

      {settingsSection === 'schedule' && (
      <Card>
        <CardHeader
          title="Daily posting schedule"
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
      )}

      {settingsSection === 'voice' && (
      <Card>
        <CardHeader
          title="Voice"
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
              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-zinc-700">Voice</span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void loadVoices()}
                    disabled={voicesLoading}
                  >
                    {voicesLoading ? 'Refreshing…' : 'Refresh voices'}
                  </Button>
                </div>
                <p className="mb-2 text-[11px] text-zinc-500">
                  Click a row to select. Play previews that voice with current rate / pitch / volume.
                </p>
                <div
                  role="listbox"
                  aria-label="Edge Neural voices"
                  aria-busy={voicesLoading}
                  className="max-h-64 overflow-y-auto rounded-md border border-zinc-200 bg-white"
                >
                  {voicesLoading && filteredVoices.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-zinc-500">Loading voices…</p>
                  ) : filteredVoices.length === 0 ? (
                    <p className="px-3 py-4 text-center text-xs text-zinc-500">
                      No voices for {voiceLocale || 'this locale'}. Try Refresh voices.
                    </p>
                  ) : (
                    filteredVoices.map((v) => {
                      const selected = voice === v.shortName;
                      const isPreviewing = previewingVoiceId === v.shortName;
                      const tone = edgeVoiceTone(v.shortName);
                      const meta = [v.gender, v.locale].filter(Boolean).join(' · ') || v.shortName;
                      return (
                        <div
                          key={v.shortName}
                          role="option"
                          aria-selected={selected}
                          tabIndex={0}
                          onClick={() => setVoice(v.shortName)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setVoice(v.shortName);
                            }
                          }}
                          className={cn(
                            'flex cursor-pointer items-center gap-2 border-b border-zinc-100 px-3 py-2 last:border-b-0',
                            'hover:bg-zinc-50 focus:outline-none focus-visible:bg-indigo-50/60',
                            selected && 'bg-indigo-50 hover:bg-indigo-50',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p
                              className={cn(
                                'truncate text-sm text-zinc-800',
                                selected && 'font-medium text-indigo-800',
                              )}
                            >
                              {v.name || v.label}
                            </p>
                            <p className="flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                              <span className="truncate">{meta}</span>
                              {tone && (
                                <Badge tone="neutral" className="px-1.5 py-0 text-[10px] font-medium">
                                  {tone}
                                </Badge>
                              )}
                            </p>
                          </div>
                          {selected && (
                            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-indigo-600">
                              Selected
                            </span>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            variant={selected ? 'primary' : 'secondary'}
                            className="shrink-0"
                            disabled={previewingVoiceId !== null}
                            aria-label={`Preview ${v.name || v.shortName}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              void previewVoice(v.shortName);
                            }}
                          >
                            {isPreviewing ? 'Playing…' : 'Play'}
                          </Button>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
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
              <Field label="Fallback emotion">
                <Select
                  value={voiceEmotion}
                  onChange={(e) => setVoiceEmotion(parseTtsEmotion(e.target.value))}
                >
                  {TTS_EMOTIONS.map((id) => (
                    <option key={id} value={id}>
                      {TTS_EMOTION_LABELS[id]}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Used when a spoken line has no situation tag. Scripts pick emotion per beat
                  (sad on loss, excited on a reveal, angry on conflict). Preview uses this
                  fallback.
                </p>
              </Field>
            </>
          )}
        </div>
      </Card>
      )}

      {settingsSection === 'render' && (
      <Card>
        <CardHeader
          title="Video render effects"
          description="Each option is off until you enable it. Applied on Re-render / new renders (start trim also applies on ingest)."
        />
        <div className="space-y-4 p-4">
          <Field label="Cut start of video (ms)">
            <Input
              type="number"
              min={0}
              max={60000}
              step={100}
              value={renderSettings.trimStartMs}
              onChange={(e) =>
                setRenderSettings((s) => ({
                  ...s,
                  trimStartMs: clampTrimStartMs(e.target.value || DEFAULT_TRIM_START_MS),
                }))
              }
            />
            <p className="mt-1 text-[11px] text-zinc-500">
              Default {DEFAULT_TRIM_START_MS} ms (0.5s). Drops the first frames on ingest / manual
              normalize.
            </p>
          </Field>

          <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50/80 p-3">
            <Toggle
              checked={renderSettings.burnCaptions.enabled}
              onChange={(v) =>
                setRenderSettings((s) => ({
                  ...s,
                  burnCaptions: { ...s.burnCaptions, enabled: v },
                }))
              }
              label="Burn captions (dialogue / voiceover lines)"
            />
            {renderSettings.burnCaptions.enabled && (
              <>
                <Field label="Default caption template">
                  <Select
                    value={renderSettings.burnCaptions.preset}
                    onChange={(e) =>
                      setRenderSettings((s) => ({
                        ...s,
                        burnCaptions: {
                          ...s.burnCaptions,
                          preset: e.target.value as CaptionTemplateId,
                        },
                      }))
                    }
                  >
                    {CAPTION_TEMPLATE_PICKER.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                    {/* Keep legacy values selectable if already saved */}
                    {!CAPTION_TEMPLATE_PICKER.some((t) => t.id === renderSettings.burnCaptions.preset) &&
                      CAPTION_TEMPLATES.filter(
                        (t) => t.id === renderSettings.burnCaptions.preset,
                      ).map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.label} (legacy)
                        </option>
                      ))}
                  </Select>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Per-video choice on the AI tab overrides this. Always burned as max 2 lines.
                  </p>
                </Field>
                <Field label="Caption position">
                  <Select
                    value={renderSettings.burnCaptions.position ?? 'center'}
                    onChange={(e) =>
                      setRenderSettings((s) => ({
                        ...s,
                        burnCaptions: {
                          ...s.burnCaptions,
                          position: e.target.value as OverlayPosition,
                        },
                      }))
                    }
                  >
                    {OVERLAY_POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {OVERLAY_POSITION_LABELS[p]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Caption text color">
                  <Select
                    value={renderSettings.burnCaptions.colorMode ?? 'dark'}
                    onChange={(e) =>
                      setRenderSettings((s) => ({
                        ...s,
                        burnCaptions: {
                          ...s.burnCaptions,
                          colorMode: e.target.value as CaptionColorMode,
                        },
                      }))
                    }
                  >
                    {CAPTION_COLOR_MODES.map((m) => (
                      <option key={m} value={m}>
                        {CAPTION_COLOR_MODE_LABELS[m]}
                      </option>
                    ))}
                  </Select>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Light text for dark footage; dark text for bright footage. Per-video override on
                    the AI tab.
                  </p>
                </Field>
              </>
            )}
          </div>

          <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50/80 p-3">
            <Toggle
              checked={renderSettings.hookText.enabled}
              onChange={(v) =>
                setRenderSettings((s) => ({
                  ...s,
                  hookText: { ...s.hookText, enabled: v },
                }))
              }
              label="Hook text (1–2 lines, top attention phrase)"
            />
            {renderSettings.hookText.enabled && (
              <div className="space-y-3">
                <Field label="Hook source">
                  <Select
                    value={renderSettings.hookText.source}
                    onChange={(e) =>
                      setRenderSettings((s) => ({
                        ...s,
                        hookText: {
                          ...s.hookText,
                          source: e.target.value as HookTextSource,
                        },
                      }))
                    }
                  >
                    <option value="options">Pick at script approval (short + longer options)</option>
                    <option value="title">Always from video title</option>
                    <option value="custom">Fixed custom hook text</option>
                  </Select>
                </Field>
                {renderSettings.hookText.source === 'custom' && (
                  <Field label="Custom hook (use Enter for a 2nd line)">
                    <Input
                      value={renderSettings.hookText.customText ?? ''}
                      onChange={(e) =>
                        setRenderSettings((s) => ({
                          ...s,
                          hookText: { ...s.hookText, customText: e.target.value },
                        }))
                      }
                      placeholder="e.g. TRASH TO TREASURE"
                      maxLength={96}
                    />
                  </Field>
                )}
                <Field label="Max words">
                  <Select
                    value={String(renderSettings.hookText.maxWords ?? 8)}
                    onChange={(e) =>
                      setRenderSettings((s) => ({
                        ...s,
                        hookText: {
                          ...s.hookText,
                          maxWords: Math.max(2, Math.min(12, Number(e.target.value) || 8)),
                        },
                      }))
                    }
                  >
                    <option value="3">3 words</option>
                    <option value="4">4 words</option>
                    <option value="5">5 words</option>
                    <option value="6">6 words</option>
                    <option value="8">8 words</option>
                    <option value="10">10 words</option>
                    <option value="12">12 words</option>
                  </Select>
                </Field>
                <Field label="Max lines">
                  <Select
                    value={String(renderSettings.hookText.maxLines ?? 2)}
                    onChange={(e) =>
                      setRenderSettings((s) => ({
                        ...s,
                        hookText: {
                          ...s.hookText,
                          maxLines: Math.max(1, Math.min(3, Number(e.target.value) || 2)),
                        },
                      }))
                    }
                  >
                    <option value="1">1 line</option>
                    <option value="2">2 lines</option>
                    <option value="3">3 lines</option>
                  </Select>
                </Field>
                <Field label="Hook position">
                  <Select
                    value={renderSettings.hookText.position ?? 'top'}
                    onChange={(e) =>
                      setRenderSettings((s) => ({
                        ...s,
                        hookText: {
                          ...s.hookText,
                          position: e.target.value as OverlayPosition,
                        },
                      }))
                    }
                  >
                    {OVERLAY_POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {OVERLAY_POSITION_LABELS[p]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <p className="text-[11px] text-zinc-500">
                  {renderSettings.hookText.source === 'options'
                    ? 'On the AI tab, pick a short or longer (4+ words / 2-line) phrase. Separate from captions.'
                    : 'Big bold attention text — separate from dialogue captions.'}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/80 p-3">
            <Toggle
              checked={renderSettings.reactionAvatar?.enabled ?? false}
              onChange={(v) =>
                setRenderSettings((s) => ({
                  ...s,
                  reactionAvatar: {
                    ...(s.reactionAvatar ?? DEFAULT_RENDER_SETTINGS.reactionAvatar),
                    enabled: v,
                  },
                }))
              }
              label="Reaction avatar (corner PiP)"
            />
            <p className="text-[11px] text-zinc-500">
              Upload a silent face photo/clip and an optional lip-sync talking-head video (MP4 / WebM
              / MOV). ffmpeg overlays the lip-sync clip when present (else the silent asset) in the
              corner during speaking windows — not ML lip-sync, just PiP. Only plays during speaking;
              unused clip tail is cut. If dialogue timing is missing, falls back to VO/subtitle cues,
              else a short lead-in (~5s). Background removal uses rembg when installed, or ffmpeg
              chromakey for green-screen clips (no Python required).
            </p>
            {renderSettings.reactionAvatar?.enabled && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-start gap-3">
                  {renderSettings.reactionAvatar.assetPath ? (
                    isReactionVideoAsset(
                      renderSettings.reactionAvatar.mimeType,
                      renderSettings.reactionAvatar.assetPath,
                    ) ? (
                      <video
                        src={`/api/v1/accounts/${id}/reaction-avatar?t=${encodeURIComponent(renderSettings.reactionAvatar.assetPath)}`}
                        className="h-20 w-20 rounded-full border border-zinc-200 object-cover bg-zinc-100"
                        muted
                        loop
                        playsInline
                        autoPlay
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/v1/accounts/${id}/reaction-avatar?t=${encodeURIComponent(renderSettings.reactionAvatar.assetPath)}`}
                        alt="Silent reaction avatar"
                        className="h-20 w-20 rounded-full border border-zinc-200 object-cover bg-zinc-100"
                      />
                    )
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-zinc-300 bg-white text-[10px] text-zinc-400">
                      No silent
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-[11px] font-medium text-zinc-600">Silent face / clip</p>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
                      className="block w-full text-xs text-zinc-600"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file || !id) return;
                        void (async () => {
                          try {
                            const next = await apiUpload<{
                              profile?: { voiceSettings?: unknown };
                            }>(`/accounts/${id}/reaction-avatar`, file);
                            const vs = next.profile?.voiceSettings;
                            setRenderSettings(renderSettingsFromVoiceSettings(vs));
                            toast('Silent reaction avatar uploaded', 'success');
                          } catch (err) {
                            toast(
                              err instanceof ApiError ? err.message : 'Avatar upload failed',
                              'error',
                            );
                          }
                        })();
                      }}
                    />
                    {renderSettings.reactionAvatar.assetPath && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void (async () => {
                            try {
                              const next = await api.del<{
                                profile?: { voiceSettings?: unknown };
                              }>(`/accounts/${id}/reaction-avatar/silent`);
                              setRenderSettings(
                                renderSettingsFromVoiceSettings(next.profile?.voiceSettings),
                              );
                              toast('Silent avatar removed', 'success');
                            } catch (err) {
                              toast(
                                err instanceof ApiError ? err.message : 'Remove failed',
                                'error',
                              );
                            }
                          })();
                        }}
                      >
                        Remove silent
                      </Button>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap items-start gap-3 border-t border-zinc-200 pt-3">
                  {renderSettings.reactionAvatar.lipSyncAssetPath ? (
                    <video
                      src={`/api/v1/accounts/${id}/reaction-avatar/lip-sync?t=${encodeURIComponent(renderSettings.reactionAvatar.lipSyncAssetPath)}`}
                      className="h-20 w-20 rounded-full border border-zinc-200 object-cover bg-zinc-100"
                      muted
                      loop
                      playsInline
                      autoPlay
                    />
                  ) : (
                    <div className="flex h-20 w-20 items-center justify-center rounded-full border border-dashed border-zinc-300 bg-white text-center text-[10px] text-zinc-400">
                      No lip-sync
                    </div>
                  )}
                  <div className="min-w-0 flex-1 space-y-2">
                    <p className="text-[11px] font-medium text-zinc-600">
                      Lip-sync / talking-head video
                    </p>
                    <input
                      type="file"
                      accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
                      className="block w-full text-xs text-zinc-600"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file || !id) return;
                        void (async () => {
                          try {
                            const next = await apiUpload<{
                              profile?: { voiceSettings?: unknown };
                            }>(`/accounts/${id}/reaction-avatar/lip-sync`, file);
                            const vs = next.profile?.voiceSettings;
                            setRenderSettings(renderSettingsFromVoiceSettings(vs));
                            toast('Lip-sync clip uploaded', 'success');
                          } catch (err) {
                            toast(
                              err instanceof ApiError ? err.message : 'Lip-sync upload failed',
                              'error',
                            );
                          }
                        })();
                      }}
                    />
                    {renderSettings.reactionAvatar.lipSyncAssetPath && (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          void (async () => {
                            try {
                              const next = await api.del<{
                                profile?: { voiceSettings?: unknown };
                              }>(`/accounts/${id}/reaction-avatar/lip-sync`);
                              setRenderSettings(
                                renderSettingsFromVoiceSettings(next.profile?.voiceSettings),
                              );
                              toast('Lip-sync clip removed', 'success');
                            } catch (err) {
                              toast(
                                err instanceof ApiError ? err.message : 'Remove failed',
                                'error',
                              );
                            }
                          })();
                        }}
                      >
                        Remove lip-sync
                      </Button>
                    )}
                    <p className="text-[10px] text-zinc-500">
                      Preferred during dialogue when set. Falls back to the silent asset. Keep clips
                      short (remove-bg processes up to ~8s on the worker).
                    </p>
                  </div>
                </div>
                <p className="text-[10px] text-zinc-500">
                  rembg = ML cutout (optional Python). Chromakey = ffmpeg green-screen keying —
                  works without rembg when you film on a green backdrop. Preview shows the original
                  upload; remove-bg runs on render.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Background removal">
                    <Select
                      value={renderSettings.reactionAvatar.removeBg ?? 'auto'}
                      onChange={(e) =>
                        setRenderSettings((s) => ({
                          ...s,
                          reactionAvatar: {
                            ...(s.reactionAvatar ?? DEFAULT_RENDER_SETTINGS.reactionAvatar),
                            removeBg: e.target.value as 'auto' | 'rembg' | 'chromakey' | 'off',
                          },
                        }))
                      }
                    >
                      <option value="auto">Auto (rembg → chromakey)</option>
                      <option value="rembg">rembg only</option>
                      <option value="chromakey">Chromakey (green screen)</option>
                      <option value="off">Off (keep original bg)</option>
                    </Select>
                  </Field>
                  <Field label="Chromakey color">
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        className="h-9 w-12 cursor-pointer rounded border border-zinc-200 bg-white p-1"
                        value={
                          /^#[0-9A-Fa-f]{6}$/.test(
                            renderSettings.reactionAvatar.chromakeyColor ?? '',
                          )
                            ? (renderSettings.reactionAvatar.chromakeyColor as string)
                            : '#00B140'
                        }
                        onChange={(e) =>
                          setRenderSettings((s) => ({
                            ...s,
                            reactionAvatar: {
                              ...(s.reactionAvatar ?? DEFAULT_RENDER_SETTINGS.reactionAvatar),
                              chromakeyColor: e.target.value.toUpperCase(),
                            },
                          }))
                        }
                        disabled={
                          (renderSettings.reactionAvatar.removeBg ?? 'auto') === 'off' ||
                          (renderSettings.reactionAvatar.removeBg ?? 'auto') === 'rembg'
                        }
                      />
                      <Input
                        className="font-mono text-xs"
                        value={renderSettings.reactionAvatar.chromakeyColor ?? '#00B140'}
                        onChange={(e) =>
                          setRenderSettings((s) => ({
                            ...s,
                            reactionAvatar: {
                              ...(s.reactionAvatar ?? DEFAULT_RENDER_SETTINGS.reactionAvatar),
                              chromakeyColor: e.target.value.trim() || '#00B140',
                            },
                          }))
                        }
                        disabled={
                          (renderSettings.reactionAvatar.removeBg ?? 'auto') === 'off' ||
                          (renderSettings.reactionAvatar.removeBg ?? 'auto') === 'rembg'
                        }
                      />
                    </div>
                  </Field>
                  <Field label="Shape">
                    <Select
                      value={renderSettings.reactionAvatar.shape ?? 'circle'}
                      onChange={(e) =>
                        setRenderSettings((s) => ({
                          ...s,
                          reactionAvatar: {
                            ...(s.reactionAvatar ?? DEFAULT_RENDER_SETTINGS.reactionAvatar),
                            shape: e.target.value as 'circle' | 'square' | 'rounded',
                          },
                        }))
                      }
                    >
                      <option value="circle">Circle</option>
                      <option value="rounded">Rounded</option>
                      <option value="square">Square (border)</option>
                    </Select>
                  </Field>
                  <Field label="Corner">
                    <Select
                      value={renderSettings.reactionAvatar.corner ?? 'br'}
                      onChange={(e) =>
                        setRenderSettings((s) => ({
                          ...s,
                          reactionAvatar: {
                            ...(s.reactionAvatar ?? DEFAULT_RENDER_SETTINGS.reactionAvatar),
                            corner: e.target.value as 'br' | 'bl' | 'tr' | 'tl',
                          },
                        }))
                      }
                    >
                      <option value="br">Bottom right</option>
                      <option value="bl">Bottom left</option>
                      <option value="tr">Top right</option>
                      <option value="tl">Top left</option>
                    </Select>
                  </Field>
                  <Field label="Size (% of width)">
                    <Select
                      value={String(renderSettings.reactionAvatar.sizePercent ?? 22)}
                      onChange={(e) =>
                        setRenderSettings((s) => ({
                          ...s,
                          reactionAvatar: {
                            ...(s.reactionAvatar ?? DEFAULT_RENDER_SETTINGS.reactionAvatar),
                            sizePercent: Number(e.target.value) || 22,
                          },
                        }))
                      }
                    >
                      <option value="16">16%</option>
                      <option value="20">20%</option>
                      <option value="22">22%</option>
                      <option value="26">26%</option>
                      <option value="30">30%</option>
                    </Select>
                  </Field>
                  <Field label="When to show">
                    <Select
                      value={renderSettings.reactionAvatar.showDuring ?? 'always'}
                      onChange={(e) =>
                        setRenderSettings((s) => ({
                          ...s,
                          reactionAvatar: {
                            ...(s.reactionAvatar ?? DEFAULT_RENDER_SETTINGS.reactionAvatar),
                            showDuring: e.target.value as 'dialogue' | 'always',
                          },
                        }))
                      }
                    >
                      <option value="always">Entire video</option>
                      <option value="dialogue">During speaking only</option>
                    </Select>
                  </Field>
                  <p className="text-[11px] text-zinc-500">
                    Entire video (default): PiP stays on through silence, VO gaps, and no-narration
                    clips. During speaking only hides it between dialogue windows.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-md border border-zinc-200 bg-zinc-50/80 p-3">
            <Toggle
              checked={renderSettings.flipHorizontal.enabled}
              onChange={(v) =>
                setRenderSettings((s) => ({
                  ...s,
                  flipHorizontal: { enabled: v },
                }))
              }
              label="Flip video horizontally (mirror)"
            />
          </div>

          <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50/80 p-3">
            <Toggle
              checked={renderSettings.colorFilter.enabled}
              onChange={(v) =>
                setRenderSettings((s) => ({
                  ...s,
                  colorFilter: { ...s.colorFilter, enabled: v },
                }))
              }
              label="Apply color filter"
            />
            {renderSettings.colorFilter.enabled && (
              <Field label="Filter preset">
                <Select
                  value={renderSettings.colorFilter.preset}
                  onChange={(e) =>
                    setRenderSettings((s) => ({
                      ...s,
                      colorFilter: {
                        ...s.colorFilter,
                        preset: e.target.value as ColorFilterPreset,
                      },
                    }))
                  }
                >
                  <option value="vivid">Vivid</option>
                  <option value="warm">Warm</option>
                  <option value="cool">Cool</option>
                  <option value="contrast">Contrast</option>
                  <option value="none">None</option>
                </Select>
              </Field>
            )}
          </div>
        </div>
      </Card>
      )}

      {settingsSection === 'publish' && (
      <Card>
        <CardHeader
          title="Publish timing & crosspost"
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
              <Field label="YouTube category">
                <Select
                  value={defaultCategory}
                  onChange={(e) => setDefaultCategory(e.target.value)}
                  disabled={real?.platform === 'FACEBOOK' || real?.platform === 'TIKTOK'}
                >
                  {YOUTUBE_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-[11px] text-zinc-500">
                  Used for YouTube uploads. Ignored on Facebook/TikTok.
                </p>
              </Field>
            </div>
            {real?.platform === 'YOUTUBE' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Made for kids (default)">
                  <Select
                    value={defaultMadeForKids ? 'yes' : 'no'}
                    onChange={(e) => setDefaultMadeForKids(e.target.value === 'yes')}
                  >
                    <option value="no">No — not made for kids</option>
                    <option value="yes">Yes — made for kids</option>
                  </Select>
                </Field>
                <Field label="Video language (default)">
                  <Select
                    value={defaultPublishLanguage}
                    onChange={(e) => setDefaultPublishLanguage(e.target.value)}
                  >
                    {CONTENT_LANGUAGES.map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {contentLanguageOptionLabel(lang)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Recording country (default)">
                  <Select
                    value={defaultRecordingCountry}
                    onChange={(e) => setDefaultRecordingCountry(e.target.value)}
                  >
                    <option value="">Not set</option>
                    {YOUTUBE_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}
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
      )}

      {settingsSection === 'danger' && real && (
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

      {settingsSection !== 'danger' && (
      <div className="flex justify-end gap-2">
        <Button onClick={() => void load()}>Discard</Button>
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save channel profile'}
        </Button>
      </div>
      )}
    </div>
  );
}
