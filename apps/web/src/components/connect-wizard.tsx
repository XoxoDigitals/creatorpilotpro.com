'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { Field, Input, Select, Toggle } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import type { ConnectionMethod, ContentType, Platform } from '@/lib/domain-types';

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
 * schedule → authorize. Selections are wired to the real accounts API in Phase 1.
 */
export function ConnectWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
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
  }
  function close() {
    reset();
    onClose();
  }

  const TOTAL = 5;
  const canNext =
    (step === 0 && platform) ||
    (step === 1 && method) ||
    (step === 2 && contentType) ||
    step === 3;

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
            <Button variant="primary" onClick={close}>
              Done
            </Button>
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

      {step === 4 && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 px-4 py-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm">
            {platform && <PlatformIcon platform={platform} size={24} />}
          </div>
          <p className="text-sm font-medium text-zinc-700">Authorization arrives in Phase 1</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
            {method === 'POSTQUED'
              ? 'Accounts you’ve connected inside PostQued will be importable here.'
              : 'The OAuth handshake with your own app credentials wires up here.'}{' '}
            Your choices — {contentType?.toLowerCase()} content
            {dramasEnabled ? ' + dramas' : ''},{' '}
            {cadence === 'PER_DAY' ? `${perDay}/day` : days.join('/')} at {times}
            {randomize ? ' (randomized)' : ''} — are saved with the account.
          </p>
        </div>
      )}
    </Modal>
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
