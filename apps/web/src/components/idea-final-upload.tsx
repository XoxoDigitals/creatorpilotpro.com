'use client';

/**
 * Owner upload gate for an AI idea package. The creative package only produces
 * scripts, narration and prompts — the owner produces the video elsewhere and
 * brings back two files. Both must land before the account can start the next
 * package (enforced again server-side in IdeasService).
 */
import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';
import {
  contentMediaUrl,
  contentThumbnailUrl,
  getApiAccount,
  getContentMediaInfo,
  publishDefaultsFromProfile,
  uploadIdeaFinishedVideo,
} from '@/lib/api-data';
import { MediaEmbed } from '@/components/media-embed';
import type { Idea } from '@/lib/domain-types';

const VIDEO_EXTENSIONS = ['mp4', 'mov', 'webm', 'm4v'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
const VIDEO_ACCEPT = 'video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v';
const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
const MAX_VIDEO_BYTES = 4 * 1024 * 1024 * 1024;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

type ScheduleMode = 'NOW' | 'QUEUE_SLOT';
type Phase = 'idle' | 'video' | 'thumbnail' | 'finishing' | 'failed';

function extensionOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}

function validateVideo(file: File): string | null {
  if (!VIDEO_EXTENSIONS.includes(extensionOf(file.name))) {
    return `Use an MP4, MOV, WebM or M4V video — "${file.name}" is not one of those.`;
  }
  if (file.size === 0) return 'That video file is empty.';
  if (file.size > MAX_VIDEO_BYTES) {
    return `Video is ${formatBytes(file.size)}; the limit is 4 GB.`;
  }
  return null;
}

function validateThumbnail(file: File): string | null {
  if (!IMAGE_EXTENSIONS.includes(extensionOf(file.name))) {
    return `Use a JPG, PNG or WebP image — "${file.name}" is not one of those.`;
  }
  if (file.size === 0) return 'That image file is empty.';
  if (file.size > MAX_IMAGE_BYTES) {
    return `Thumbnail is ${formatBytes(file.size)}; the limit is 15 MB.`;
  }
  return null;
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div className="space-y-1" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-[11px] text-zinc-600">
        <span>{label}</span>
        <span>{percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
        <div
          className="h-full rounded-full bg-indigo-600 transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export function IdeaFinalUpload({
  idea,
  accountId,
  defaultTitle,
  demo = false,
  onUploaded,
}: {
  idea: Idea;
  accountId: string;
  defaultTitle: string;
  demo?: boolean;
  onUploaded: () => void | Promise<void>;
}) {
  const toast = useToast();
  const videoInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const [video, setVideo] = useState<File | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [thumbError, setThumbError] = useState<string | null>(null);
  const [title, setTitle] = useState(defaultTitle);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>('QUEUE_SLOT');
  const [crosspostIds, setCrosspostIds] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>('idle');
  const [videoPercent, setVideoPercent] = useState(0);
  const [thumbPercent, setThumbPercent] = useState(0);
  const [failure, setFailure] = useState<string | null>(null);
  const [scheduleWarning, setScheduleWarning] = useState<string | null>(null);
  const [videoEmbedUrl, setVideoEmbedUrl] = useState<string | null>(null);
  const [thumbEmbedUrl, setThumbEmbedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    void getApiAccount(accountId).then((account) => {
      if (cancelled || !account) return;
      const defaults = publishDefaultsFromProfile(account.profile);
      setScheduleMode(defaults.scheduleMode);
      setCrosspostIds(defaults.crosspostAccountIds.filter((id) => id !== accountId));
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, demo]);

  useEffect(() => {
    if (!idea.contentItemId || !idea.hasFinalVideo) {
      setVideoEmbedUrl(null);
      setThumbEmbedUrl(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      getContentMediaInfo(idea.contentItemId),
      idea.hasThumbnail
        ? getContentMediaInfo(idea.contentItemId, 'thumbnail')
        : Promise.resolve(null),
    ]).then(([video, thumb]) => {
      if (cancelled) return;
      setVideoEmbedUrl(video.mode === 'embed' ? video.embedUrl : null);
      setThumbEmbedUrl(thumb?.mode === 'embed' ? thumb.embedUrl : null);
    }).catch(() => {
      if (!cancelled) {
        setVideoEmbedUrl(null);
        setThumbEmbedUrl(null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [idea.contentItemId, idea.hasFinalVideo, idea.hasThumbnail]);

  const busy = phase === 'video' || phase === 'thumbnail' || phase === 'finishing';
  const complete = idea.hasFinalVideo && idea.hasThumbnail;
  const partial = !complete && (idea.hasFinalVideo || idea.hasThumbnail);

  const thumbnailPreview = useMemo(
    () => (thumbnail ? URL.createObjectURL(thumbnail) : null),
    [thumbnail],
  );
  useEffect(() => {
    return () => {
      if (thumbnailPreview) URL.revokeObjectURL(thumbnailPreview);
    };
  }, [thumbnailPreview]);

  function pickVideo(file: File | null) {
    setFailure(null);
    if (!file) {
      setVideo(null);
      setVideoError(null);
      return;
    }
    const error = validateVideo(file);
    setVideoError(error);
    setVideo(error ? null : file);
  }

  function pickThumbnail(file: File | null) {
    setFailure(null);
    if (!file) {
      setThumbnail(null);
      setThumbError(null);
      return;
    }
    const error = validateThumbnail(file);
    setThumbError(error);
    setThumbnail(error ? null : file);
  }

  async function submit() {
    if (!video || !thumbnail || busy) return;
    if (demo) {
      toast('Demo mode — connect a real account to upload finished videos.', 'info');
      return;
    }
    setFailure(null);
    setScheduleWarning(null);
    setVideoPercent(0);
    setThumbPercent(0);
    setPhase('video');
    try {
      const result = await uploadIdeaFinishedVideo({
        ideaId: idea.id,
        accountId,
        additionalAccountIds: crosspostIds,
        title: title.trim() || undefined,
        file: video,
        thumbnail,
        scheduleMode,
        onVideoProgress: (percent) => {
          setVideoPercent(percent);
          if (percent >= 100) setPhase('thumbnail');
        },
        onThumbnailProgress: (percent) => {
          setThumbPercent(percent);
          if (percent >= 100) setPhase('finishing');
        },
      });
      if (result.scheduled) {
        const n = 1 + crosspostIds.length;
        const dest = n > 1 ? ` (${n} channels)` : '';
        toast(
          scheduleMode === 'NOW'
            ? `Final package queued for Review — Approve to publish${dest}.`
            : `Final package queued for Review — Approve to allow the scheduled publish${dest}.`,
          'success',
        );
      } else {
        setScheduleWarning(result.scheduleError);
        toast('Assets stored, but scheduling failed. Schedule it manually.', 'error');
      }
      setVideo(null);
      setThumbnail(null);
      if (videoInputRef.current) videoInputRef.current.value = '';
      if (thumbInputRef.current) thumbInputRef.current.value = '';
      setPhase('idle');
      await onUploaded();
    } catch (error) {
      setPhase('failed');
      const message =
        error instanceof ApiError || error instanceof Error
          ? error.message
          : 'Upload failed. Please try again.';
      setFailure(message);
      toast(message, 'error');
    }
  }

  if (complete) {
    return (
      <section className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-800">
            Final assets uploaded
          </h4>
          <Link
            href={`/accounts/${accountId}/review` as Route}
            className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500"
          >
            Open Review
          </Link>
        </div>
        <p className="mb-3 text-xs text-emerald-900">
          This package is in the Review queue. Approve it there before it can publish.
          You can also start generation on the next idea.
        </p>
        {idea.contentItemId ? (
          <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Final video
              </p>
              <MediaEmbed
                kind="video"
                embedUrl={videoEmbedUrl}
                streamUrl={contentMediaUrl(idea.contentItemId)}
                className="aspect-video w-full rounded-md border border-zinc-200 bg-black"
              />
              {!videoEmbedUrl && (
                <a
                  href={contentMediaUrl(idea.contentItemId)}
                  download
                  className="mt-1 inline-flex text-[11px] font-medium text-indigo-600 hover:underline"
                >
                  Download final video
                </a>
              )}
              {videoEmbedUrl && (
                <a
                  href={videoEmbedUrl.replace('/preview', '/view')}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex text-[11px] font-medium text-indigo-600 hover:underline"
                >
                  Open in Google Drive
                </a>
              )}
            </div>
            <div>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                Thumbnail
              </p>
              <MediaEmbed
                kind="image"
                embedUrl={thumbEmbedUrl}
                streamUrl={contentThumbnailUrl(idea.contentItemId)}
                className="w-full rounded-md border border-zinc-200 object-cover"
                title="Uploaded thumbnail"
              />
            </div>
          </div>
        ) : (
          <p className="text-xs text-emerald-900">
            Both files are stored for this idea.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-indigo-900">
        Upload final assets
      </h4>
      <p className="mt-1 text-xs text-zinc-600">
        Produce the video from the package above, then upload the finished video and its
        thumbnail. Both are required — the next idea stays locked until they are stored.
      </p>

      {partial && (
        <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {idea.hasFinalVideo
            ? 'A final video is already stored but the thumbnail is missing. Select both files and upload again.'
            : 'A thumbnail is already stored but the final video is missing. Select both files and upload again.'}
        </p>
      )}

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-700">
            Final video <span className="text-red-600">*</span>
          </span>
          <input
            ref={videoInputRef}
            type="file"
            accept={VIDEO_ACCEPT}
            disabled={busy}
            onChange={(event) => pickVideo(event.target.files?.[0] ?? null)}
            className="w-full text-xs text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-100"
          />
          <span className="mt-1 block text-[11px] text-zinc-500">
            MP4, MOV, WebM or M4V · up to 4 GB
          </span>
          {video && (
            <span className="mt-1 block text-[11px] font-medium text-zinc-700">
              Selected: {video.name} ({formatBytes(video.size)})
            </span>
          )}
          {videoError && (
            <span className="mt-1 block text-[11px] font-medium text-red-600">{videoError}</span>
          )}
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-700">
            Thumbnail image <span className="text-red-600">*</span>
          </span>
          <input
            ref={thumbInputRef}
            type="file"
            accept={IMAGE_ACCEPT}
            disabled={busy}
            onChange={(event) => pickThumbnail(event.target.files?.[0] ?? null)}
            className="w-full text-xs text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-zinc-700 hover:file:bg-zinc-100"
          />
          <span className="mt-1 block text-[11px] text-zinc-500">
            JPG, PNG or WebP · up to 15 MB
          </span>
          {thumbnail && (
            <span className="mt-1 block text-[11px] font-medium text-zinc-700">
              Selected: {thumbnail.name} ({formatBytes(thumbnail.size)})
            </span>
          )}
          {thumbError && (
            <span className="mt-1 block text-[11px] font-medium text-red-600">{thumbError}</span>
          )}
        </label>

        {thumbnailPreview && (
          <img
            src={thumbnailPreview}
            alt="Thumbnail preview"
            className="h-24 w-auto rounded-md border border-zinc-200 object-cover"
          />
        )}

        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-700">Publish title</span>
          <input
            type="text"
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
            className="w-full rounded-md border border-zinc-300 px-3 py-1.5 text-sm outline-none focus:border-indigo-500"
          />
        </label>

        <p className="text-[11px] text-zinc-500">
          Publish timing and crosspost destinations come from{' '}
          <Link
            href={`/accounts/${accountId}/settings` as Route}
            className="font-medium text-indigo-700 underline-offset-2 hover:underline"
          >
            channel settings
          </Link>
          {crosspostIds.length > 0
            ? ` · also posting to ${crosspostIds.length} other channel${crosspostIds.length === 1 ? '' : 's'}`
            : ''}
          {` · ${scheduleMode === 'NOW' ? 'immediately after Review Approve' : 'next free slot'}`}
          .
        </p>

        {busy && (
          <div className="space-y-2 rounded-md border border-zinc-200 bg-white p-2">
            <ProgressBar percent={videoPercent} label="Uploading final video" />
            <ProgressBar percent={thumbPercent} label="Uploading thumbnail" />
            {phase === 'finishing' && (
              <p className="text-[11px] text-zinc-600">Linking assets and scheduling…</p>
            )}
          </div>
        )}

        {failure && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {failure}
          </p>
        )}

        {scheduleWarning && (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Files were stored and the idea is marked uploaded, but scheduling failed:{' '}
            {scheduleWarning}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={!video || !thumbnail || busy || demo}
            onClick={() => void submit()}
          >
            {busy ? 'Uploading…' : 'Upload final video and thumbnail'}
          </Button>
          {!busy && (!video || !thumbnail) && (
            <span className="text-[11px] text-zinc-500">
              Select both files to enable the upload.
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
