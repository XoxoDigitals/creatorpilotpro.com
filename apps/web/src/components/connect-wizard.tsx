'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Route } from 'next';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { Field, Input, Select, Toggle } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ContentType, Platform } from '@/lib/domain-types';

type Mode = 'OAUTH' | 'MANUAL';

/** Scheduling preferences carried to the connect endpoints (mirrors the API dto). */
interface SchedulingPrefs {
  cadence: 'PER_DAY' | 'SPECIFIC_DAYS';
  perDay?: number;
  days?: string[];
  times: string[];
  randomizeMinutes?: number;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const PLATFORMS: { id: Platform; label: string; note: string }[] = [
  { id: 'YOUTUBE', label: 'YouTube', note: 'Channel — direct upload via your Google Cloud project.' },
  { id: 'FACEBOOK', label: 'Facebook Page', note: 'Reels via your Meta app (Business Manager supported).' },
  { id: 'TIKTOK', label: 'TikTok', note: 'Account — DIRECT_POST via TikTok Content Posting API.' },
];

const CONTENT_TYPES: { id: ContentType; label: string; note: string }[] = [
  { id: 'AI', label: 'AI content', note: 'Unlocks Ideas — research reference channels, generate ideas & creative packages, then upload your finished video.' },
  { id: 'REPURPOSED', label: 'Repurposed content', note: 'Unlocks Sources + Review — watched profiles and bulk imports.' },
  { id: 'MIXED', label: 'Both', note: 'Full workspace: Sources, Review, and Ideas (AI package + owner upload).' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Connect wizard (Phase 9): platform → content type (+ dramas) → schedule → authorize.
 * All accounts publish through native platform APIs — no more PostQued bridge.
 */
export function ConnectWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [mode, setMode] = useState<Mode>('OAUTH');
  const [manualName, setManualName] = useState('');
  const [manualHandle, setManualHandle] = useState('');
  const [manualExternalId, setManualExternalId] = useState('');
  const [submittingManual, setSubmittingManual] = useState(false);
  const [contentType, setContentType] = useState<ContentType | null>(null);
  const [dramasEnabled, setDramasEnabled] = useState(false);
  const [cadence, setCadence] = useState<'PER_DAY' | 'SPECIFIC_DAYS'>('PER_DAY');
  const [perDay, setPerDay] = useState('1');
  const [days, setDays] = useState<string[]>(['Mon', 'Wed', 'Fri']);
  const [times, setTimes] = useState('18:00');
  const [randomize, setRandomize] = useState(true);

  function reset() {
    setStep(0);
    setPlatform(null);
    setMode('OAUTH');
    setManualName('');
    setManualHandle('');
    setManualExternalId('');
    setSubmittingManual(false);
    setContentType(null);
    setDramasEnabled(false);
    setCadence('PER_DAY');
    setPerDay('1');
    setDays(['Mon', 'Wed', 'Fri']);
    setTimes('18:00');
    setRandomize(true);
  }
  function close() { reset(); onClose(); }

  function toSchedulingPrefs(): SchedulingPrefs {
    const parsedTimes = times.split(',').map((t) => t.trim()).filter((t) => TIME_RE.test(t));
    const prefs: SchedulingPrefs = { cadence, times: parsedTimes };
    if (cadence === 'PER_DAY') prefs.perDay = Number(perDay) || 1;
    else prefs.days = days;
    if (randomize) prefs.randomizeMinutes = 45;
    return prefs;
  }

  function ownAppStartUrl(provider: 'google' | 'meta' | 'tiktok'): string {
    const params = new URLSearchParams({
      contentType: contentType ?? 'AI',
      dramasEnabled: String(dramasEnabled),
      schedulingPrefs: JSON.stringify(toSchedulingPrefs()),
    });
    return `/api/v1/accounts/connect/${provider}/start?${params.toString()}`;
  }

  const TOTAL = 4;
  const canNext =
    (step === 0 && platform) ||
    (step === 1 && contentType) ||
    step === 2;

  async function submitManual() {
    if (!platform || !contentType || !manualName.trim()) return;
    setSubmittingManual(true);
    try {
      const acct = await api.post<{ id: string }>('/accounts/connect/manual', {
        platform,
        name: manualName.trim(),
        handle: manualHandle.trim() || undefined,
        externalId: manualExternalId.trim() || undefined,
        contentType,
        dramasEnabled,
        schedulingPrefs: toSchedulingPrefs(),
      });
      toast('Manual account connected', 'success');
      close();
      const dest =
        contentType === 'AI' || contentType === 'MIXED'
          ? `/accounts/${acct.id}/ideas?onboard=refs`
          : `/accounts/${acct.id}`;
      router.push(dest as Route);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to connect', 'error');
      setSubmittingManual(false);
    }
  }

  function finalButton() {
    if (mode === 'MANUAL') {
      return (
        <Button
          variant="primary"
          disabled={!manualName.trim() || submittingManual}
          onClick={submitManual}
        >
          {submittingManual ? 'Connecting…' : 'Connect manually'}
        </Button>
      );
    }
    if (platform === 'YOUTUBE') {
      return (
        <Button variant="primary" onClick={() => window.location.assign(ownAppStartUrl('google'))}>
          Connect with Google
        </Button>
      );
    }
    if (platform === 'FACEBOOK') {
      return (
        <Button variant="primary" onClick={() => window.location.assign(ownAppStartUrl('meta'))}>
          Continue with Meta
        </Button>
      );
    }
    if (platform === 'TIKTOK') {
      return (
        <Button variant="primary" onClick={() => window.location.assign(ownAppStartUrl('tiktok'))}>
          Connect with TikTok
        </Button>
      );
    }
    return (
      <Button variant="primary" onClick={close}>Done</Button>
    );
  }

  const scheduleSummary = cadence === 'PER_DAY' ? `${perDay}/day` : days.join('/');

  return (
    <Modal
      open={open}
      onClose={close}
      title="Connect an account"
      description={`Step ${step + 1} of ${TOTAL}`}
      footer={
        <>
          {step > 0
            ? <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>Back</Button>
            : <Button variant="ghost" onClick={close}>Cancel</Button>}
          {step < TOTAL - 1
            ? <Button variant="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Continue</Button>
            : finalButton()}
        </>
      }
    >
      {step === 0 && (
        <div className="space-y-3">
          <div className="flex rounded-md border border-zinc-300 bg-white p-0.5">
            <button
              type="button"
              onClick={() => setMode('OAUTH')}
              className={cn(
                'flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors',
                mode === 'OAUTH' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-800',
              )}
            >
              OAuth (auto-publish)
            </button>
            <button
              type="button"
              onClick={() => setMode('MANUAL')}
              className={cn(
                'flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors',
                mode === 'MANUAL' ? 'bg-indigo-600 text-white' : 'text-zinc-500 hover:text-zinc-800',
              )}
            >
              Manual (upload by hand)
            </button>
          </div>
          <p className="text-xs text-zinc-500">
            {mode === 'OAUTH'
              ? 'The pipeline uploads to the platform for you via the platform API.'
              : 'The pipeline renders the final video — you download it and upload to the platform yourself.'}
          </p>
          <p className="pt-1 text-sm text-zinc-500">Which platform is this account on?</p>
          {PLATFORMS.map((p) => (
            <OptionButton
              key={p.id}
              selected={platform === p.id}
              onClick={() => setPlatform(p.id)}
              icon={<PlatformIcon platform={p.id} size={22} />}
              label={p.label}
              note={p.note}
            />
          ))}
          <p className="pt-2 text-xs text-zinc-500">
            Want the same content on multiple platforms? Connect each channel as its own
            account, then choose default crosspost destinations under that channel’s{' '}
            <b>Settings → Publish timing & crosspost</b>.
          </p>
          {mode === 'OAUTH' && (
            <p className="pt-1 text-xs text-zinc-400">
              App credentials (Google, Meta, TikTok) are managed once in <b>Settings → Platform Apps</b>.
            </p>
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-2">
          <p className="mb-2 text-sm text-zinc-500">
            Content type decides which workspace tabs this account exposes.
          </p>
          {CONTENT_TYPES.map((c) => (
            <OptionButton
              key={c.id}
              selected={contentType === c.id}
              onClick={() => setContentType(c.id)}
              label={c.label}
              note={c.note}
            />
          ))}
          <div className="mt-3 rounded-lg border border-zinc-200 px-3 py-3">
            <Toggle
              checked={dramasEnabled}
              onChange={setDramasEnabled}
              label="Enable AI drama series for this account"
            />
            <p className="mt-1 pl-11 text-xs text-zinc-500">
              Adds the Dramas tab — episodic AI stories with consistent characters. You can change this later.
            </p>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-500">
            How often should this account publish? The scheduler fills these slots automatically.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cadence">
              <Select value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}>
                <option value="PER_DAY">Every day</option>
                <option value="SPECIFIC_DAYS">Specific days</option>
              </Select>
            </Field>
            {cadence === 'PER_DAY' ? (
              <Field label="Videos per day">
                <Input type="number" min={1} max={10} value={perDay} onChange={(e) => setPerDay(e.target.value)} />
              </Field>
            ) : (
              <div>
                <span className="mb-1 block text-xs font-medium text-zinc-600">Days</span>
                <div className="flex flex-wrap gap-1">
                  {WEEKDAYS.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))}
                      className={cn(
                        'rounded-md border px-2 py-1.5 text-xs font-medium transition-colors',
                        days.includes(d)
                          ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                          : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50',
                      )}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Field label="Post time(s) — comma-separated, account timezone">
            <Input value={times} onChange={(e) => setTimes(e.target.value)} placeholder="18:00, 21:30" />
          </Field>
          <Toggle
            checked={randomize}
            onChange={setRandomize}
            label="Randomize within ±45 minutes of each time (looks more organic)"
          />
        </div>
      )}

      {step === 3 && mode === 'MANUAL' && platform && (
        <div className="space-y-3">
          <div className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-xs text-indigo-800">
            The pipeline will render the final video for this <b>{platform}</b> account. You'll download it and upload to the platform yourself, then click <b>Mark published</b> on the target.
          </div>
          <Field label="Channel / Page name">
            <Input
              value={manualName}
              onChange={(e) => setManualName(e.target.value)}
              placeholder="e.g. Mindful Minutes"
              autoFocus
            />
          </Field>
          <Field label="Handle (optional)">
            <Input
              value={manualHandle}
              onChange={(e) => setManualHandle(e.target.value)}
              placeholder="@mindfulminutes"
            />
          </Field>
          <Field label="External ID (optional — helps if you connect the same account via OAuth later)">
            <Input
              value={manualExternalId}
              onChange={(e) => setManualExternalId(e.target.value)}
              placeholder="UCxxxxxxxxxxxxxxxxxxxxxx or page id"
            />
          </Field>
        </div>
      )}

      {step === 3 && mode === 'OAUTH' && platform === 'YOUTUBE' && (
        <OwnAppNotice
          platform="YOUTUBE"
          title="Authorize with your Google app"
          body="You'll be sent to Google to grant your Cloud project access to the channel, then returned here."
          summary={{ contentType, dramasEnabled, scheduleSummary, times, randomize }}
        />
      )}

      {step === 3 && mode === 'OAUTH' && platform === 'FACEBOOK' && (
        <OwnAppNotice
          platform="FACEBOOK"
          title="Authorize with your Meta app"
          body="You'll be sent to Facebook to grant your app access, then returned to pick which Page to connect."
          summary={{ contentType, dramasEnabled, scheduleSummary, times, randomize }}
        />
      )}

      {step === 3 && mode === 'OAUTH' && platform === 'TIKTOK' && (
        <OwnAppNotice
          platform="TIKTOK"
          title="Authorize with your TikTok app"
          body="You'll be sent to TikTok to grant your app the video.upload + video.publish scopes, then returned here."
          summary={{ contentType, dramasEnabled, scheduleSummary, times, randomize }}
        />
      )}
    </Modal>
  );
}

function platformPolicyHref(platform: Platform): string {
  if (platform === 'YOUTUBE') return '/legal/youtube-api';
  return '/legal/platforms';
}

function OwnAppNotice({
  platform, title, body, summary,
}: {
  platform: Platform;
  title: string;
  body: string;
  summary: {
    contentType: ContentType | null;
    dramasEnabled: boolean;
    scheduleSummary: string;
    times: string;
    randomize: boolean;
  };
}) {
  return (
    <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 px-4 py-8 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm">
        <PlatformIcon platform={platform} size={24} />
      </div>
      <p className="text-sm font-medium text-zinc-700">{title}</p>
      <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
        {body} Your choices — {summary.contentType?.toLowerCase()} content
        {summary.dramasEnabled ? ' + dramas' : ''}, {summary.scheduleSummary} at {summary.times}
        {summary.randomize ? ' (randomized)' : ''} — travel through the handshake and are saved with the account.
      </p>
      <p className="mx-auto mt-3 max-w-sm text-xs text-zinc-500">
        By continuing you authorize platform access as described in our{' '}
        <a href={platformPolicyHref(platform)} className="underline hover:text-zinc-700" target="_blank" rel="noopener noreferrer">
          {platform === 'YOUTUBE' ? 'YouTube API Limited Use' : 'platform disclosures'}
        </a>
        ,{' '}
        <a href="/legal/privacy" className="underline hover:text-zinc-700" target="_blank" rel="noopener noreferrer">
          Privacy Policy
        </a>
        , and{' '}
        <a href="/legal/data-deletion" className="underline hover:text-zinc-700" target="_blank" rel="noopener noreferrer">
          data deletion
        </a>{' '}
        page.
      </p>
    </div>
  );
}

function OptionButton({
  selected, onClick, icon, label, note,
}: {
  selected: boolean;
  onClick: () => void;
  icon?: React.ReactNode;
  label: string;
  note: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
        selected
          ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500'
          : 'border-zinc-200 hover:bg-zinc-50',
      )}
    >
      {icon}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-zinc-900">{label}</span>
        <span className="block text-xs text-zinc-500">{note}</span>
      </span>
    </button>
  );
}
