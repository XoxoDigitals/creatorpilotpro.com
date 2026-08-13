'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  getApiAccount,
  manualPublish,
  publishDefaultsFromProfile,
  type ChannelScheduleMode,
} from '@/lib/api-data';

/**
 * Manual upload → publish (docs/06 §2). Creates a content item, streams the file
 * into the hot tier as its FINAL asset, then schedules publish target(s) using
 * this account's channel-settings defaults (timing + crosspost). Content stays
 * in REVIEW_PENDING.
 */
export function ManualUploadModal({
  open,
  onClose,
  accountId,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  onUploaded: () => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<ChannelScheduleMode>('QUEUE_SLOT');
  const [crosspostIds, setCrosspostIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getApiAccount(accountId).then((account) => {
      if (cancelled || !account) return;
      const defaults = publishDefaultsFromProfile(account.profile);
      setMode(defaults.scheduleMode);
      setCrosspostIds(defaults.crosspostAccountIds.filter((id) => id !== accountId));
    });
    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

  const reset = () => {
    setTitle('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async () => {
    if (!title.trim()) return toast('Give the upload a title.', 'error');
    if (!file) return toast('Choose a video file to upload.', 'error');
    setBusy(true);
    try {
      await manualPublish({
        title: title.trim(),
        file,
        accountId,
        additionalAccountIds: crosspostIds,
        scheduleMode: mode,
      });
      const n = 1 + crosspostIds.length;
      const dest = n > 1 ? ` to ${n} channels` : '';
      toast(
        mode === 'NOW'
          ? `Uploaded — queued for Review, then publish${dest}`
          : `Uploaded — queued for Review, then next free slot${dest}`,
        'success',
      );
      reset();
      onUploaded();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Upload a video"
      description="Publishes using this channel’s timing and crosspost defaults from Settings. Goes through Review before publish."
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Uploading…' : 'Upload & schedule'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Morning motivation #42"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-indigo-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">Video file</span>
          <input
            ref={fileRef}
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-xs text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-zinc-200"
          />
        </label>

        <p className="text-xs text-zinc-500">
          Timing and crosspost destinations come from{' '}
          <Link
            href={`/accounts/${accountId}/settings` as Route}
            className="font-medium text-indigo-700 underline-offset-2 hover:underline"
          >
            channel settings
          </Link>
          {crosspostIds.length > 0
            ? ` · also posting to ${crosspostIds.length} other channel${crosspostIds.length === 1 ? '' : 's'}`
            : ''}
          {` · ${mode === 'NOW' ? 'immediately after Review Approve' : 'next free slot'}`}
          .
        </p>
      </div>
    </Modal>
  );
}
