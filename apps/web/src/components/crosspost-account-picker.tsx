'use client';

/**
 * Multi-select of sibling SocialAccounts for crossposting.
 * Each selected account becomes its own PublishTarget (POST /publish targets[]).
 * Connect still creates one SocialAccount per platform; this UI fans out at schedule time.
 */
import { useEffect, useState } from 'react';
import { getAccountsView, type AccountsResult } from '@/lib/api-data';
import type { Account, Platform } from '@/lib/domain-types';

function platformLabel(platform: Platform): string {
  switch (platform) {
    case 'YOUTUBE':
      return 'YouTube';
    case 'FACEBOOK':
      return 'Facebook';
    case 'TIKTOK':
      return 'TikTok';
    default:
      return platform;
  }
}

export function CrosspostAccountPicker({
  primaryAccountId,
  selectedIds,
  onChange,
  disabled = false,
}: {
  /** Account that owns the content workspace (always included as a destination). */
  primaryAccountId: string;
  /** Extra destination account ids (siblings), not including the primary. */
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [siblings, setSiblings] = useState<Account[]>([]);
  const [demo, setDemo] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getAccountsView().then((r: AccountsResult) => {
      if (cancelled) return;
      setDemo(r.demo);
      setSiblings(r.accounts.filter((a) => a.id !== primaryAccountId && !a.paused));
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [primaryAccountId]);

  if (!loaded || demo || siblings.length === 0) {
    if (loaded && !demo && siblings.length === 0) {
      return (
        <p className="text-xs text-zinc-500">
          To crosspost, connect another platform channel from Accounts (e.g. Facebook
          alongside YouTube). Each channel is a separate connection; select extras here when
          scheduling.
        </p>
      );
    }
    return null;
  }

  function toggle(id: string) {
    if (disabled) return;
    if (selectedIds.includes(id)) onChange(selectedIds.filter((x) => x !== id));
    else onChange([...selectedIds, id]);
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="mb-1 block text-xs font-medium text-zinc-700">Also post to…</legend>
      <p className="text-[11px] text-zinc-500">
        Saved as this channel’s default destinations. Title and description are shared; each
        platform applies its own limits when publishing.
      </p>
      <ul className="space-y-1.5">
        {siblings.map((a) => {
          const checked = selectedIds.includes(a.id);
          return (
            <label
              key={a.id}
              className="flex cursor-pointer items-start gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs hover:border-zinc-300"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(a.id)}
                className="mt-0.5"
              />
              <span className="min-w-0">
                <span className="block font-medium text-zinc-800">
                  {a.name}
                  <span className="ml-1.5 font-normal text-zinc-500">
                    · {platformLabel(a.platform)}
                  </span>
                </span>
                {a.handle ? (
                  <span className="block truncate text-[11px] text-zinc-500">{a.handle}</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** Primary + extras, deduped, primary first. */
export function destinationAccountIds(
  primaryAccountId: string,
  extraIds: string[],
): string[] {
  const seen = new Set<string>([primaryAccountId]);
  const out = [primaryAccountId];
  for (const id of extraIds) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
