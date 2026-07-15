'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { Avatar } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';
import { Field, Input, Select, Toggle } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { cn } from '@/lib/cn';
import { api, ApiError } from '@/lib/api';
import type { ConnectionMethod, ContentType, Platform } from '@/lib/domain-types';

/** A PostQued integration available to import (GET /accounts/connect/postqued/available). */
interface AvailableIntegration {
  pqAccountId: string;
  platform: Platform;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
}

/** Scheduling preferences carried to the connect endpoints (mirrors the API dto). */
interface SchedulingPrefs {
  cadence: 'PER_DAY' | 'SPECIFIC_DAYS';
  perDay?: number;
  days?: string[];
  times: string[];
  randomizeMinutes?: number;
}

/** HH:mm in 24h form (e.g. 18:00, 09:30). */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const PLATFORMS: { id: Platform; label: string; note: string }[] = [
  { id: 'YOUTUBE', label: 'YouTube', note: 'Channel — publish via PostQued or your own Google app' },
  { id: 'FACEBOOK', label: 'Facebook Page', note: 'Reels via your Meta app (Business Manager supported)' },
  { id: 'TIKTOK', label: 'TikTok', note: 'Account — publish via PostQued or your own TikTok app' },
];

const METHODS: Record<Platform, { id: ConnectionMethod; label: string; note: string }[]> = {
  YOUTUBE: [
    {
      id: 'POSTQUED',
      label: 'Via PostQued (recommended)',
      note: 'No upload quota limits, no Google app verification. Analytics still syncs read-only from Google.',
    },
    {
      id: 'OWN_APP',
      label: 'Your own Google app',
      note: 'Direct uploads through your Google Cloud project — subject to YouTube API quota (~6 uploads/day/project by default).',
    },
  ],
  FACEBOOK: [
    {
      id: 'OWN_APP',
      label: 'Your Meta app',
      note: 'Facebook Login for Business — Reels publishing with page or system-user tokens.',
    },
  ],
  TIKTOK: [
    {
      id: 'POSTQUED',
      label: 'Via PostQued (recommended)',
      note: 'Fastest path — accounts you connected in the PostQued dashboard import here.',
    },
    {
      id: 'OWN_APP',
      label: 'Your own TikTok app',
      note: 'TikTok Content Posting API — requires your app to pass TikTok’s audit first.',
    },
  ],
};

const CONTENT_TYPES: { id: ContentType; label: string; note: string }[] = [
  { id: 'AI', label: 'AI content', note: 'Unlocks Ideas — original content generated from competitor research.' },
  { id: 'REPURPOSED', label: 'Repurposed content', note: 'Unlocks Sources + Review — watched profiles and bulk imports.' },
  { id: 'MIXED', label: 'Both', note: 'Full workspace: Sources, Review, and Ideas.' },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * Connect wizard: platform → connection method → content type (+ dramas) →
 * schedule → authorize. The final step wires each path to the real accounts API:
 * PostQued import, or an OAuth redirect for own-app Google/Meta (TikTok own-app
 * is audit-pending).
 */
export function ConnectWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [method, setMethod] = useState<ConnectionMethod | null>(null);
  const [contentType, setContentType] = useState<ContentType | null>(null);
  const [dramasEnabled, setDramasEnabled] = useState(false);
  // Schedule step
  const [cadence, setCadence] = useState<'PER_DAY' | 'SPECIFIC_DAYS'>('PER_DAY');
  const [perDay, setPerDay] = useState('1');
  const [days, setDays] = useState<string[]>(['Mon', 'Wed', 'Fri']);
  const [times, setTimes] = useState('18:00');
  const [randomize, setRandomize] = useState(true);
  // Final step — PostQued import
  const [pqLoading, setPqLoading] = useState(false);
  const [pqError, setPqError] = useState<string | null>(null);
  const [pqAvailable, setPqAvailable] = useState<AvailableIntegration[]>([]);
  const [pqSelected, setPqSelected] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  function reset() {
    setStep(0);
    setPlatform(null);
    setMethod(null);
    setContentType(null);
    setDramasEnabled(false);
    setCadence('PER_DAY');
    setPerDay('1');
    setDays(['Mon', 'Wed', 'Fri']);
    setTimes('18:00');
    setRandomize(true);
    setPqLoading(false);
    setPqError(null);
    setPqAvailable([]);
    setPqSelected(null);
    setImporting(false);
  }
  function close() {
    reset();
    onClose();
  }

  /** Build the API SchedulingPrefs from the step-3 form state. */
  function toSchedulingPrefs(): SchedulingPrefs {
    const parsedTimes = times
      .split(',')
      .map((t) => t.trim())
      .filter((t) => TIME_RE.test(t));
    const prefs: SchedulingPrefs = { cadence, times: parsedTimes };
    if (cadence === 'PER_DAY') prefs.perDay = Number(perDay) || 1;
    else prefs.days = days;
    if (randomize) prefs.randomizeMinutes = 45;
    return prefs;
  }

  // Load importable PostQued integrations when the PostQued path reaches step 4.
  useEffect(() => {
    if (step !== 4 || method !== 'POSTQUED' || !platform) return;
    let cancelled = false;
    setPqLoading(true);
    setPqError(null);
    setPqSelected(null);
    api
      .get<AvailableIntegration[]>(`/accounts/connect/postqued/available?platform=${platform}`)
      .then((rows) => {
        if (!cancelled) setPqAvailable(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setPqError(err instanceof ApiError ? err.message : 'Could not reach PostQued.');
        }
      })
      .finally(() => {
        if (!cancelled) setPqLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, method, platform]);

  async function importPostqued() {
    if (!pqSelected || !platform || !contentType) return;
    setImporting(true);
    try {
      const account = await api.post<{ id: string }>('/accounts/connect/postqued', {
        pqAccountId: pqSelected,
        platform,
        contentType,
        dramasEnabled,
        schedulingPrefs: toSchedulingPrefs(),
      });
      toast('Account imported from PostQued', 'success');
      close();
      router.push(`/accounts/${account.id}`);
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Import failed', 'error');
      setImporting(false);
    }
  }

  /** Top-level OAuth start URL for own-app Google/Meta (the API replies 302). */
  function ownAppStartUrl(provider: 'google' | 'meta'): string {
    const params = new URLSearchParams({
      contentType: contentType ?? 'AI',
      dramasEnabled: String(dramasEnabled),
      schedulingPrefs: JSON.stringify(toSchedulingPrefs()),
    });
    return `/api/v1/accounts/connect/${provider}/start?${params.toString()}`;
  }

  const TOTAL = 5;
  const canNext =
    (step === 0 && platform) ||
    (step === 1 && method) ||
    (step === 2 && contentType) ||
    step === 3;

  function finalButton() {
    if (method === 'POSTQUED') {
      return (
        <Button variant="primary" disabled={!pqSelected || importing} onClick={importPostqued}>
          {importing ? 'Importing…' : 'Import account'}
        </Button>
      );
    }
    if (method === 'OWN_APP' && platform === 'YOUTUBE') {
      return (
        <Button variant="primary" onClick={() => window.location.assign(ownAppStartUrl('google'))}>
          Connect with Google
        </Button>
      );
    }
    if (method === 'OWN_APP' && platform === 'FACEBOOK') {
      return (
        <Button variant="primary" onClick={() => window.location.assign(ownAppStartUrl('meta'))}>
          Continue with Meta
        </Button>
      );
    }
    // OWN_APP + TIKTOK — audit-pending, nothing to submit.
    return (
      <Button variant="primary" onClick={close}>
        Done
      </Button>
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
          {step > 0 ? (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              Back
            </Button>
          ) : (
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
          )}
          {step < TOTAL - 1 ? (
            <Button variant="primary" disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          ) : (
            finalButton()
          )}
        </>
      }
    >
      {step === 0 && (
        <div className="space-y-2">
          <p className="mb-2 text-sm text-zinc-500">Which platform is this account on?</p>
          {PLATFORMS.map((p) => (
            <OptionButton
              key={p.id}
              selected={platform === p.id}
              onClick={() => {
                setPlatform(p.id);
                setMethod(p.id === 'FACEBOOK' ? 'OWN_APP' : null);
              }}
              icon={<PlatformIcon platform={p.id} size={22} />}
              label={p.label}
              note={p.note}
            />
          ))}
        </div>
      )}

      {step === 1 && platform && (
        <div className="space-y-2">
          <p className="mb-2 text-sm text-zinc-500">How should this account connect?</p>
          {METHODS[platform].map((m) => (
            <OptionButton
              key={m.id}
              selected={method === m.id}
              onClick={() => setMethod(m.id)}
              label={m.label}
              note={m.note}
            />
          ))}
          <p className="pt-1 text-xs text-zinc-400">
            App credentials (PostQued key, Google/Meta/TikTok apps) are managed once in Settings →
            Platform Apps.
          </p>
        </div>
      )}

      {step === 2 && (
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
              Adds the Dramas tab — episodic AI stories with consistent characters. You can change
              this later in account settings.
            </p>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <p className="text-sm text-zinc-500">
            How often should this account publish? The scheduler fills these slots automatically.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Cadence">
              <Select
                value={cadence}
                onChange={(e) => setCadence(e.target.value as typeof cadence)}
              >
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
                      onClick={() =>
                        setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]))
                      }
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

      {step === 4 && method === 'POSTQUED' && (
        <div className="space-y-2">
          <p className="mb-2 text-sm text-zinc-500">
            Pick the PostQued account to import. Its {contentType?.toLowerCase()} pipeline
            {dramasEnabled ? ' + dramas' : ''} and {scheduleSummary} schedule are applied on import.
          </p>
          {pqLoading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-14 rounded-lg" />
              ))}
            </div>
          )}
          {!pqLoading && pqError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
              {pqError}
            </div>
          )}
          {!pqLoading && !pqError && pqAvailable.length === 0 && (
            <EmptyState
              title="No importable accounts"
              hint="Connect this account inside your PostQued dashboard first — it will then appear here to import."
            />
          )}
          {!pqLoading &&
            !pqError &&
            pqAvailable.map((a) => (
              <OptionButton
                key={a.pqAccountId}
                selected={pqSelected === a.pqAccountId}
                onClick={() => setPqSelected(a.pqAccountId)}
                icon={<Avatar name={a.displayName || a.username} src={a.avatarUrl} size="md" />}
                label={a.displayName || a.username}
                note={`@${a.username.replace(/^@/, '')}`}
              />
            ))}
        </div>
      )}

      {step === 4 && method === 'OWN_APP' && platform === 'YOUTUBE' && (
        <OwnAppNotice
          platform="YOUTUBE"
          title="Authorize with your Google app"
          body="You’ll be sent to Google to grant your Cloud project access to the channel, then returned here."
          summary={{ contentType, dramasEnabled, scheduleSummary, times, randomize }}
        />
      )}

      {step === 4 && method === 'OWN_APP' && platform === 'FACEBOOK' && (
        <OwnAppNotice
          platform="FACEBOOK"
          title="Authorize with your Meta app"
          body="You’ll be sent to Facebook to grant your app access, then returned to pick which Page to connect."
          summary={{ contentType, dramasEnabled, scheduleSummary, times, randomize }}
        />
      )}

      {step === 4 && method === 'OWN_APP' && platform === 'TIKTOK' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-6 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm">
            <PlatformIcon platform="TIKTOK" size={24} />
          </div>
          <p className="text-sm font-medium text-amber-900">Own-app TikTok is audit-pending</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-amber-800">
            Publishing through your own TikTok app needs the Content Posting API audit to pass first.
            Use the PostQued method for TikTok in the meantime.
          </p>
        </div>
      )}
    </Modal>
  );
}

function OwnAppNotice({
  platform,
  title,
  body,
  summary,
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
        {summary.randomize ? ' (randomized)' : ''} — travel through the handshake and are saved with
        the account.
      </p>
    </div>
  );
}

function OptionButton({
  selected,
  onClick,
  icon,
  label,
  note,
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
