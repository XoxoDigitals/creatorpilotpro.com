'use client';

import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { addWatchedProfile, bulkImportSources } from '@/lib/api-data';

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-indigo-500';

/**
 * Add a watched Kuaishou profile (docs/04 §1). The watcher polls it every
 * `checkIntervalHours`; new videos flow into this account's review queue.
 */
export function AddWatchedProfileModal({
  open,
  onClose,
  accountId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [hours, setHours] = useState(6);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setUrl('');
    setLabel('');
    setHours(6);
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async () => {
    if (!url.trim()) return toast('Enter the profile URL to watch.', 'error');
    setBusy(true);
    try {
      await addWatchedProfile({
        url: url.trim(),
        label: label.trim() || undefined,
        checkIntervalHours: hours,
        targetAccountId: accountId,
      });
      toast('Watched profile added — polling starts on the next cycle', 'success');
      reset();
      onDone();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not add source', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add watched profile"
      description="The watcher checks this profile on a schedule and queues new videos for review."
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Adding…' : 'Add profile'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">Profile URL</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://kuaishou.com/profile/…"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">Label (optional)</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. FailFactory"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">Check every</span>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={inputClass}>
            {[1, 3, 6, 12, 24, 48].map((h) => (
              <option key={h} value={h}>
                {h} hour{h === 1 ? '' : 's'}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  );
}

/**
 * Bulk-import a list of video URLs (docs/04 §1, FR-B2). Creates a paused batch
 * source; each URL is fetched once and queued for review.
 */
export function BulkImportModal({
  open,
  onClose,
  accountId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  accountId: string;
  onDone: () => void;
}) {
  const toast = useToast();
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const urls = text
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);

  const reset = () => {
    setText('');
    setLabel('');
  };
  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async () => {
    if (urls.length === 0) return toast('Paste at least one video URL.', 'error');
    setBusy(true);
    try {
      await bulkImportSources({
        urls,
        label: label.trim() || undefined,
        targetAccountId: accountId,
      });
      toast(`Importing ${urls.length} video${urls.length === 1 ? '' : 's'}`, 'success');
      reset();
      onDone();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not import URLs', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Bulk import URLs"
      description="One video per URL. Each is downloaded once and queued for review."
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Importing…' : `Import ${urls.length || ''} URL${urls.length === 1 ? '' : 's'}`.trim()}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">Batch label (optional)</span>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="e.g. July trending pack"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">Video URLs</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder={'One URL per line, or comma-separated'}
            className={`${inputClass} font-mono text-xs`}
          />
          <span className="mt-1 block text-xs text-zinc-500">
            {urls.length} URL{urls.length === 1 ? '' : 's'} detected
          </span>
        </label>
      </div>
    </Modal>
  );
}
