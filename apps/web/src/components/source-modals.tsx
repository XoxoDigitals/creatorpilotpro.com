'use client';

import { useState } from 'react';
import { extractVideoUrls } from '@scp/shared';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { bulkImportSources } from '@/lib/api-data';

const inputClass =
  'w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-indigo-500';

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

  const urls = extractVideoUrls(text);

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
      description="Paste share text or a list of links — video URLs are detected automatically. Each is downloaded once and queued for review."
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
            placeholder={'Paste Kwai/share text, or one URL per line'}
            className={`${inputClass} font-mono text-xs`}
          />
          <span className="mt-1 block text-xs text-zinc-500">
            {text.trim() && urls.length === 0
              ? 'No video URLs found — include an http(s) link (Kwai, YouTube, …).'
              : `${urls.length} URL${urls.length === 1 ? '' : 's'} detected`}
          </span>
          {urls.length > 0 ? (
            <ul className="mt-2 max-h-32 list-disc overflow-auto rounded-md border border-zinc-200 bg-zinc-50 px-5 py-2 font-mono text-xs text-zinc-700">
              {urls.map((u) => (
                <li key={u} className="truncate" title={u}>
                  {u}
                </li>
              ))}
            </ul>
          ) : null}
        </label>
      </div>
    </Modal>
  );
}
