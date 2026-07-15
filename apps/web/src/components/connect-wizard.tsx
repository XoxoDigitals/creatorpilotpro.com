'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { PlatformIcon } from '@/components/ui/platform-icon';
import { cn } from '@/lib/cn';
import type { ContentType, Platform } from '@/lib/domain-types';

const PLATFORMS: { id: Platform; label: string; note: string }[] = [
  { id: 'YOUTUBE', label: 'YouTube', note: 'Channel via Google OAuth' },
  { id: 'FACEBOOK', label: 'Facebook Page', note: 'Page via Facebook Login' },
  { id: 'TIKTOK', label: 'TikTok', note: 'Account via PostQued' },
];

const CONTENT_TYPES: { id: ContentType; label: string; note: string }[] = [
  { id: 'AI', label: 'AI content', note: 'Unlocks Ideas + Dramas — original content generated from research.' },
  { id: 'REPURPOSED', label: 'Repurposed content', note: 'Unlocks Sources + Review — watched profiles and bulk imports.' },
  { id: 'MIXED', label: 'Both', note: 'Full workspace: Sources, Ideas, Dramas, and Review.' },
];

/** 3-step connect wizard (docs/11 §1.2). Auth step is a Phase 1 placeholder. */
export function ConnectWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [contentType, setContentType] = useState<ContentType | null>(null);

  function reset() {
    setStep(0);
    setPlatform(null);
    setContentType(null);
  }
  function close() {
    reset();
    onClose();
  }

  const canNext = (step === 0 && platform) || (step === 1 && contentType);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Connect an account"
      description={`Step ${step + 1} of 3`}
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
          {step < 2 ? (
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
            <button
              key={p.id}
              onClick={() => setPlatform(p.id)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-3 text-left transition-colors',
                platform === p.id
                  ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500'
                  : 'border-zinc-200 hover:bg-zinc-50',
              )}
            >
              <PlatformIcon platform={p.id} size={22} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-zinc-900">{p.label}</span>
                <span className="block text-xs text-zinc-500">{p.note}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-2">
          <p className="mb-2 text-sm text-zinc-500">
            Content type decides which workspace tabs this account exposes.
          </p>
          {CONTENT_TYPES.map((c) => (
            <button
              key={c.id}
              onClick={() => setContentType(c.id)}
              className={cn(
                'w-full rounded-lg border px-3 py-3 text-left transition-colors',
                contentType === c.id
                  ? 'border-indigo-500 bg-indigo-50/60 ring-1 ring-indigo-500'
                  : 'border-zinc-200 hover:bg-zinc-50',
              )}
            >
              <span className="block text-sm font-medium text-zinc-900">{c.label}</span>
              <span className="block text-xs text-zinc-500">{c.note}</span>
            </button>
          ))}
        </div>
      )}

      {step === 2 && (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-zinc-50/60 px-4 py-8 text-center">
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-white shadow-sm">
            {platform && <PlatformIcon platform={platform} size={24} />}
          </div>
          <p className="text-sm font-medium text-zinc-700">Authorization arrives in Phase 1</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-zinc-500">
            The {platform?.toLowerCase()} OAuth / PostQued handshake wires up here. Your selection
            ({contentType?.toLowerCase()} content) is saved as{' '}
            <code className="rounded bg-zinc-200 px-1 text-[11px]">social_accounts.contentType</code>{' '}
            when the migration lands.
          </p>
        </div>
      )}
    </Modal>
  );
}
