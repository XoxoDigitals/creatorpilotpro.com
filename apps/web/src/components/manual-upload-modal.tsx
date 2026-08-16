'use client';

import Link from 'next/link';
import type { Route } from 'next';
import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  CONTENT_LANGUAGES,
  contentLanguageOptionLabel,
  YOUTUBE_CATEGORIES,
  YOUTUBE_COUNTRIES,
} from '@scp/shared';
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
  const thumbRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagsText, setTagsText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [mode, setMode] = useState<ChannelScheduleMode>('QUEUE_SLOT');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'UNLISTED' | 'PRIVATE'>('PUBLIC');
  const [madeForKids, setMadeForKids] = useState(false);
  const [category, setCategory] = useState('22');
  const [language, setLanguage] = useState('en');
  const [country, setCountry] = useState('');
  const [crosspostIds, setCrosspostIds] = useState<string[]>([]);
  const [platform, setPlatform] = useState<string>('channel');
  const [busy, setBusy] = useState(false);

  const isYouTube = platform === 'YOUTUBE';
  const platformLabel =
    platform === 'YOUTUBE'
      ? 'YouTube'
      : platform === 'TIKTOK'
        ? 'TikTok'
        : platform === 'FACEBOOK'
          ? 'Facebook'
          : 'channel';

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void getApiAccount(accountId).then((account) => {
      if (cancelled || !account) return;
      const defaults = publishDefaultsFromProfile(account.profile);
      setMode(defaults.scheduleMode);
      setCrosspostIds(defaults.crosspostAccountIds.filter((id) => id !== accountId));
      setPlatform(account.platform);
      const sched = (account.profile?.schedulingPrefs ?? {}) as {
        defaultVisibility?: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';
        defaultCategory?: string;
        defaultMadeForKids?: boolean;
        defaultLanguage?: string;
        defaultRecordingCountry?: string;
      };
      if (sched.defaultVisibility) setVisibility(sched.defaultVisibility);
      if (sched.defaultCategory) setCategory(sched.defaultCategory);
      if (typeof sched.defaultMadeForKids === 'boolean') setMadeForKids(sched.defaultMadeForKids);
      if (sched.defaultLanguage) setLanguage(sched.defaultLanguage);
      else if (account.profile?.language) setLanguage(account.profile.language);
      if (sched.defaultRecordingCountry) setCountry(sched.defaultRecordingCountry);
      if (account.profile?.defaultTags?.length) {
        setTagsText(account.profile.defaultTags.join(', '));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [open, accountId]);

  const reset = () => {
    setTitle('');
    setDescription('');
    setTagsText('');
    setFile(null);
    setThumbnail(null);
    setMadeForKids(false);
    setCategory('22');
    setLanguage('en');
    setCountry('');
    if (fileRef.current) fileRef.current.value = '';
    if (thumbRef.current) thumbRef.current.value = '';
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
      const tags = tagsText
        .split(/[,#\n]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 30);
      await manualPublish({
        title: title.trim(),
        file,
        thumbnail: isYouTube ? thumbnail : null,
        accountId,
        additionalAccountIds: crosspostIds,
        scheduleMode: mode,
        metadataOverride: {
          description: description.trim() || undefined,
          visibility,
          ...(tags.length ? { tags } : {}),
          ...(isYouTube
            ? {
                category: category || undefined,
                madeForKids,
                defaultLanguage: language || 'en',
                defaultAudioLanguage: language || 'en',
                ...(country ? { recordingCountry: country } : {}),
              }
            : {}),
        },
      });
      const n = 1 + crosspostIds.length;
      const dest = n > 1 ? ` to ${n} channels` : '';
      toast(
        mode === 'NOW'
          ? `Uploaded — queued for Review, then publish now${dest}`
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
      title={`Upload to ${platformLabel}`}
      description={
        isYouTube
          ? 'YouTube Studio-style options — title, thumbnail, tags, audience, category, language, and when to post. Goes through Review before going live.'
          : 'Manual publish like the native apps — title, visibility, and when to post. Goes through Review before going live.'
      }
      footer={
        <div className="flex justify-end gap-2">
          <Button size="sm" onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Uploading…' : mode === 'NOW' ? 'Upload & publish now' : 'Upload & schedule'}
          </Button>
        </div>
      }
    >
      <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Morning motivation #42"
            maxLength={100}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-indigo-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">Description / caption</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            placeholder={
              isYouTube
                ? 'Full YouTube description (links, chapters, hashtags…)'
                : 'Optional caption (same field on YouTube, Facebook, and TikTok)'
            }
            className="w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-indigo-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">Tags</span>
          <input
            type="text"
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="comma-separated tags (e.g. diy, tiny home, renovation)"
            className="w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-indigo-500"
          />
        </label>

        <label className="block">
          <span className="mb-1 block font-medium text-zinc-700">Visibility</span>
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as 'PUBLIC' | 'UNLISTED' | 'PRIVATE')}
            className="w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-indigo-500"
          >
            <option value="PUBLIC">Public</option>
            <option value="UNLISTED">Unlisted</option>
            <option value="PRIVATE">Private / friends</option>
          </select>
        </label>

        {isYouTube && (
          <div className="space-y-3 rounded-md border border-zinc-200 bg-zinc-50/80 p-3">
            <p className="text-xs font-medium text-zinc-800">YouTube options</p>

            <label className="block">
              <span className="mb-1 block font-medium text-zinc-700">Custom thumbnail</span>
              <input
                ref={thumbRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => setThumbnail(e.target.files?.[0] ?? null)}
                className="w-full text-xs text-zinc-600 file:mr-3 file:rounded-md file:border-0 file:bg-zinc-100 file:px-3 file:py-1.5 file:text-xs file:font-medium hover:file:bg-zinc-200"
              />
              <span className="mt-1 block text-[11px] text-zinc-500">
                JPG/PNG/WebP. Channel must be verified for custom thumbnails.
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2">
              <input
                type="checkbox"
                checked={madeForKids}
                onChange={(e) => setMadeForKids(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-zinc-800">Made for kids</span>
                <span className="block text-[11px] text-zinc-500">
                  Declares the video as made for children (COPPA). Restricts comments and personalization.
                </span>
              </span>
            </label>

            <label className="block">
              <span className="mb-1 block font-medium text-zinc-700">Category</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-indigo-500"
              >
                {YOUTUBE_CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block font-medium text-zinc-700">Video language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-indigo-500"
                >
                  {CONTENT_LANGUAGES.map((lang) => (
                    <option key={lang.code} value={lang.code}>
                      {contentLanguageOptionLabel(lang)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-zinc-700">Recording country</span>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full rounded-md border border-zinc-300 px-3 py-2 outline-none focus:border-indigo-500"
                >
                  <option value="">Not set</option>
                  {YOUTUBE_COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        <fieldset className="space-y-1.5">
          <legend className="mb-1 block font-medium text-zinc-700">When to publish</legend>
          {(
            [
              ['NOW', 'Publish now', 'After Review Approve, post immediately'],
              ['QUEUE_SLOT', 'Next free slot', "Uses this account's daily schedule times"],
            ] as const
          ).map(([value, label, hint]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 px-3 py-2 hover:bg-zinc-50"
            >
              <input
                type="radio"
                name="manual-upload-mode"
                checked={mode === value}
                onChange={() => setMode(value)}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-zinc-800">{label}</span>
                <span className="block text-[11px] text-zinc-500">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

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
          Crosspost destinations come from{' '}
          <Link
            href={`/accounts/${accountId}/settings` as Route}
            className="font-medium text-indigo-700 underline-offset-2 hover:underline"
          >
            channel settings
          </Link>
          {crosspostIds.length > 0
            ? ` · also posting to ${crosspostIds.length} other channel${crosspostIds.length === 1 ? '' : 's'}`
            : ''}
          .
        </p>
      </div>
    </Modal>
  );
}
