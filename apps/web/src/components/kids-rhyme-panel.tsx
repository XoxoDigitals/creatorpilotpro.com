'use client';

import { useCallback, useEffect, useState } from 'react';
import { isKidsRhymePackage } from '@scp/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError, api, apiUpload } from '@/lib/api';
import { getApiAccount } from '@/lib/api-data';

export function KidsRhymePanel({
  accountId,
  onCreated,
}: {
  accountId: string;
  onCreated: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [enabled, setEnabled] = useState(false);
  const [topic, setTopic] = useState('');
  const [rhyme, setRhyme] = useState('');
  const [busy, setBusy] = useState<'gen' | 'save' | null>(null);

  const load = useCallback(async () => {
    const account = await getApiAccount(accountId);
    setEnabled(isKidsRhymePackage(account?.profile?.styleProfile));
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!enabled) return null;

  async function generateRhyme() {
    setBusy('gen');
    try {
      const generated = await api.post<{
        title: string;
        rhyme: string;
        hook: string;
        topicSummary: string;
      }>('/ai/generate-kids-rhyme', {
        topic: topic.trim() || undefined,
        durationSec: 60,
      });
      setRhyme(generated.rhyme);
      if (!topic.trim() && generated.title) setTopic(generated.title);
      toast('Rhyme written — edit it, then click Use pasted rhyme.', 'success');
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not generate rhyme', 'error');
    } finally {
      setBusy(null);
    }
  }

  async function savePastedRhyme() {
    const text = rhyme.trim();
    if (!text) {
      toast('Paste or generate a rhyme first.', 'error');
      return;
    }
    setBusy('save');
    try {
      const created = await api.post<{ title: string }>(
        `/accounts/${encodeURIComponent(accountId)}/ideas/rhyme`,
        {
          topic: topic.trim() || undefined,
          rhyme: text,
          videoDurationSec: 60,
          clipDurationSec: 10,
        },
      );
      toast(`Saved “${created.title}”. Upload the sung voice on the package below.`, 'success');
      setRhyme('');
      await onCreated();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Could not save rhyme', 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-indigo-100 bg-indigo-50/40 p-4">
      <div>
        <p className="text-sm font-semibold text-zinc-900">Kids rhyme</p>
        <p className="mt-0.5 text-[11px] text-zinc-600">
          We write a rhyme (or paste yours). You record/sing it, upload the voice, then we analyze
          the audio and fill visual prompts on this page.
        </p>
      </div>
      <Field label="Topic (optional)">
        <Input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. sleepy moon, counting kittens, rainy boots"
        />
      </Field>
      <Field label="Rhyme lyrics (optional if you click Generate)">
        <Textarea
          rows={6}
          value={rhyme}
          onChange={(e) => setRhyme(e.target.value)}
          placeholder="Paste your rhyme here, or leave blank and click Generate rhyme."
          className="font-mono text-[12px]"
        />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" disabled={busy !== null} onClick={() => void generateRhyme()}>
          {busy === 'gen' ? 'Writing rhyme…' : 'Generate rhyme'}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() => void savePastedRhyme()}
        >
          {busy === 'save' ? 'Saving…' : 'Use pasted rhyme'}
        </Button>
      </div>
    </div>
  );
}

export function OwnerVoiceUpload({
  ideaId,
  waiting,
  hasExisting = false,
  onUploaded,
}: {
  ideaId: string;
  waiting: boolean;
  hasExisting?: boolean;
  onUploaded: () => void | Promise<void>;
}) {
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const [selectedName, setSelectedName] = useState<string | null>(null);
  if (!waiting) return null;

  const inputId = `rhyme-sound-${ideaId}`;

  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <p className="font-medium">
        {hasExisting ? 'Replace sound / rhyme sound' : 'Upload sound / rhyme sound'}
      </p>
      <p className="mt-0.5 text-[11px] text-amber-800">
        MP3 / WAV / M4A. After upload we transcribe by time, then write visual prompts to the lyrics.
      </p>
      <label htmlFor={inputId} className="mt-2 block text-[11px] font-medium text-amber-900">
        Choose audio file
      </label>
      <input
        id={inputId}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg"
        disabled={uploading}
        className="mt-1 w-full max-w-md text-xs text-zinc-700 file:mr-3 file:rounded-md file:border file:border-zinc-300 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-100 disabled:opacity-55"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setSelectedName(file.name);
          setUploading(true);
          void apiUpload(`/ideas/${encodeURIComponent(ideaId)}/voiceover`, file)
            .then(() => {
              toast('Sound uploaded — transcribing by time and writing visual prompts…', 'success');
              return onUploaded();
            })
            .catch((err) => {
              toast(err instanceof ApiError ? err.message : 'Sound upload failed', 'error');
              setSelectedName(null);
            })
            .finally(() => setUploading(false));
        }}
      />
      {uploading ? (
        <p className="mt-1 text-[11px] font-medium text-amber-800">Uploading…</p>
      ) : selectedName ? (
        <p className="mt-1 text-[11px] font-medium text-amber-900">Selected: {selectedName}</p>
      ) : null}
    </div>
  );
}
