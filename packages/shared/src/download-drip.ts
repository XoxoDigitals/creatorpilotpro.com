/**
 * Shared helpers for pacing SourceVideo downloads by channel posts/day.
 * Worker dispatcher + API/UI ETA labels all use the same math.
 */

/** Keep about this many days of unpublished / in-pipeline content ready. */
export const DOWNLOAD_READY_BUFFER_DAYS = 2;
/** When under the buffer, release about this many days of downloads per tick. */
export const DOWNLOAD_DRIP_DAYS = 1;
/** Dispatcher interval used for “imminent” ETA labels. */
export const DOWNLOAD_DRIP_TICK_MS = 60_000;

export function resolvePostsPerDay(prefs: unknown): number {
  const row =
    prefs && typeof prefs === 'object' && !Array.isArray(prefs)
      ? (prefs as Record<string, unknown>)
      : {};
  const maxPerDay = typeof row.maxPerDay === 'number' && row.maxPerDay > 0 ? row.maxPerDay : null;
  const perDay = typeof row.perDay === 'number' && row.perDay > 0 ? row.perDay : null;
  const times = Array.isArray(row.times) ? row.times.length : 0;
  const raw = maxPerDay ?? perDay ?? (times > 0 ? times : 1);
  return Math.max(1, Math.min(50, Math.round(raw)));
}

export function downloadSlotsAvailable(opts: {
  postsPerDay: number;
  ready: number;
  inFlight: number;
  bufferDays?: number;
  dripDays?: number;
}): number {
  const bufferDays = opts.bufferDays ?? DOWNLOAD_READY_BUFFER_DAYS;
  const dripDays = opts.dripDays ?? DOWNLOAD_DRIP_DAYS;
  const readyCap = bufferDays * opts.postsPerDay;
  const dripBatch = dripDays * opts.postsPerDay;
  const slots = Math.max(0, readyCap - opts.ready - opts.inFlight);
  return Math.min(slots, dripBatch);
}

export interface PendingDownloadEta {
  /** 1-based place in the account PENDING queue (oldest first). */
  position: number;
  /** Estimated when this row may start downloading. */
  nextDownloadAt: Date;
  /** Short UI label. */
  label: string;
}

/**
 * Estimate next download times for PENDING videos (oldest first).
 * Immediate free slots → next dispatcher tick (~1 min). Further rows → ~1 day
 * of posts each time the ready buffer needs room (postsPerDay cadence).
 */
export function estimatePendingDownloadEtas(opts: {
  pendingIdsOldestFirst: string[];
  postsPerDay: number;
  ready: number;
  inFlight: number;
  now?: Date;
}): Map<string, PendingDownloadEta> {
  const now = opts.now ?? new Date();
  const freeNow = downloadSlotsAvailable({
    postsPerDay: opts.postsPerDay,
    ready: opts.ready,
    inFlight: opts.inFlight,
  });
  const drip = Math.max(1, opts.postsPerDay * DOWNLOAD_DRIP_DAYS);
  const out = new Map<string, PendingDownloadEta>();

  opts.pendingIdsOldestFirst.forEach((id, index) => {
    const position = index + 1;
    let nextDownloadAt: Date;
    let label: string;

    if (index < freeNow) {
      nextDownloadAt = new Date(now.getTime() + DOWNLOAD_DRIP_TICK_MS);
      label = position === 1 ? 'Next drip (~1 min)' : `Next drip · #${position}`;
    } else {
      const afterImmediate = index - freeNow;
      const batchIndex = Math.floor(afterImmediate / drip);
      const daysAhead = batchIndex + 1;
      nextDownloadAt = startOfLocalDay(now);
      nextDownloadAt.setDate(nextDownloadAt.getDate() + daysAhead);
      label =
        daysAhead === 1
          ? `Est. tomorrow · #${position}`
          : `Est. in ${daysAhead} days · #${position}`;
    }

    out.set(id, { position, nextDownloadAt, label });
  });

  return out;
}

function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function formatDownloadDripSummary(opts: {
  postsPerDay: number;
  ready: number;
  inFlight: number;
  pendingCount: number;
}): string {
  const cap = DOWNLOAD_READY_BUFFER_DAYS * opts.postsPerDay;
  const free = downloadSlotsAvailable(opts);
  if (opts.pendingCount === 0) {
    return `Ready ${opts.ready}/${cap} · ${opts.postsPerDay}/day · no queued downloads`;
  }
  if (free > 0) {
    return `Ready ${opts.ready}/${cap} · ${opts.postsPerDay}/day · next drip up to ${free} video(s) (~1 min)`;
  }
  return `Ready ${opts.ready}/${cap} · ${opts.postsPerDay}/day · waiting for pipeline room (${opts.pendingCount} queued)`;
}
