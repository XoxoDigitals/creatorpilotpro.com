'use client';

import { useRef, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { manualPublish } from '@/lib/api-data';

type Mode = 'QUEUE_SLOT' | 'NOW';

/**
 * Manual upload → publish (docs/06 §2). Creates a content item, streams the file
 * into the hot tier as its FINAL asset, then schedules a publish target for the
 * account (next free slot, or immediately).
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
  const [mode, setMode] = useState<Mode>('QUEUE_SLOT');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle('');
    setFile(null);
    setMode('QUEUE_SLOT');
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
      await manualPublish({ title: title.trim(), file, accountId, scheduleMode: mode });
      toast(
        mode === 'NOW' ? 'Uploaded — publishing now' : 'Uploaded — scheduled to the next free slot',
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
      description="Publishes to this account via its configured connection."
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

        <fieldset className="space-y-2">
          <span className="block font-medium text-zinc-700">When to publish</span>
          {(
            [
              ['QUEUE_SLOT', 'Next free slot', "Uses this account's schedule rules"],
              ['NOW', 'Immediately', 'Dispatches as soon as the worker picks it up'],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 px-3 py-2 hover:border-zinc-300"
            >
              <input
                type="radio"
                name="mode"
                checked={mode === value}
                onChange={() => setMode(value)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-zinc-800">{label}</span>
                <span className="block text-xs text-zinc-500">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </div>
    </Modal>
  );
}
