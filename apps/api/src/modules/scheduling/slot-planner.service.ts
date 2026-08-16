import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/** schedulingPrefs shape written by the connect wizard (docs/11 §1). */
interface SchedulingPrefs {
  cadence?: 'PER_DAY' | 'SPECIFIC_DAYS';
  perDay?: number;
  days?: string[];
  times?: string[];
  randomizeMinutes?: number;
  maxPerDay?: number;
  minGapMin?: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
};

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_TIMES = ['18:00'];
const PLAN_HORIZON_DAYS = 60;

/**
 * The tz offset (ms) to add to a wall-clock-as-UTC instant to get the true UTC
 * instant for that wall time in `timeZone`. Uses Intl only (no date library);
 * DST edge minutes are approximate — acceptable for Phase 1b (docs/06 §3).
 */
function tzOffsetMs(atUtc: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(atUtc)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return asUtc - atUtc.getTime();
}

/** Build the UTC instant for a given wall-clock date+time in a timezone. */
function zonedWallTimeToUtc(y: number, m: number, d: number, hh: number, mm: number, tz: string): Date {
  const guess = Date.UTC(y, m, d, hh, mm);
  const offset = tzOffsetMs(new Date(guess), tz);
  return new Date(guess - offset);
}

/** Calendar Y/M/D (month 0-based) of an instant as seen in `timeZone`. */
function localYmd(at: Date, timeZone: string): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) parts[p.type] = p.value;
  return {
    y: Number(parts.year),
    m: Number(parts.month) - 1,
    d: Number(parts.day),
  };
}

/** Weekday index (0=Sun..6=Sat) of an instant as seen in `timeZone`. */
function localWeekday(at: Date, timeZone: string): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
    .format(at)
    .slice(0, 3)
    .toLowerCase();
  return WEEKDAY_INDEX[short] ?? at.getUTCDay();
}

function addCalendarDays(y: number, m: number, d: number, add: number): { y: number; m: number; d: number } {
  const utc = new Date(Date.UTC(y, m, d + add));
  return { y: utc.getUTCFullYear(), m: utc.getUTCMonth(), d: utc.getUTCDate() };
}

@Injectable()
export class SlotPlannerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Expand an account's schedulingPrefs into the next `count` concrete future
   * publish instants (docs/06 §3 Layer 1). Randomized windows are fixed at
   * generation time so a slot doesn't drift. Respects perDay/maxPerDay, minGapMin,
   * cadence (daily vs specific weekdays), account timezone, and already-booked targets.
   */
  async nextSlots(accountId: string, count: number): Promise<Date[]> {
    const account = await this.prisma.client.socialAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      include: { profile: true },
    });
    if (!account) throw new NotFoundException('Account not found.');

    const prefs = (account.profile?.schedulingPrefs ?? {}) as SchedulingPrefs;
    const tz = account.timezone || 'Asia/Karachi';
    const times = (prefs.times ?? DEFAULT_TIMES)
      .map((t) => t.trim())
      .filter((t) => HHMM_RE.test(t))
      .sort();
    const effectiveTimes = times.length > 0 ? times : DEFAULT_TIMES;

    const perDayCap = Math.min(prefs.perDay ?? effectiveTimes.length, prefs.maxPerDay ?? 50);
    const minGapMs = (prefs.minGapMin ?? 0) * 60_000;
    // Default 0 — old wizard default of 45 made 17:30 look like ~10:42 in US timezones.
    const jitterMax = Math.max(0, prefs.randomizeMinutes ?? 0);
    const useWeekdays = prefs.cadence === 'SPECIFIC_DAYS';
    const allowedDays = new Set(
      (prefs.days ?? [])
        .map((d) => WEEKDAY_INDEX[d.slice(0, 3).toLowerCase()])
        .filter((n): n is number => n != null),
    );

    const now = Date.now();
    const occupied = await this.prisma.client.publishTarget.findMany({
      where: {
        accountId,
        status: { in: ['PENDING', 'SCHEDULED', 'PUBLISHING'] },
        scheduledAt: { not: null, gte: new Date(now - 60_000) },
      },
      select: { scheduledAt: true },
    });
    const occupiedMs = occupied
      .map((o) => o.scheduledAt?.getTime())
      .filter((t): t is number => typeof t === 'number');

    const slots: Date[] = [];
    const todayLocal = localYmd(new Date(), tz);

    for (let dayOffset = 0; dayOffset < PLAN_HORIZON_DAYS && slots.length < count; dayOffset += 1) {
      const day = addCalendarDays(todayLocal.y, todayLocal.m, todayLocal.d, dayOffset);
      const noonProbe = zonedWallTimeToUtc(day.y, day.m, day.d, 12, 0, tz);
      if (useWeekdays && allowedDays.size > 0 && !allowedDays.has(localWeekday(noonProbe, tz))) {
        continue;
      }

      let placedToday = 0;
      for (const time of effectiveTimes) {
        if (placedToday >= perDayCap || slots.length >= count) break;
        const hh = Number(time.slice(0, 2));
        const mm = Number(time.slice(3, 5));
        let instant = zonedWallTimeToUtc(day.y, day.m, day.d, hh, mm, tz);
        if (jitterMax > 0) {
          // Centered ±jitter (wizard copy said ±N), not forward-only.
          const delta = Math.floor(Math.random() * (jitterMax * 2 + 1)) - jitterMax;
          instant = new Date(instant.getTime() + delta * 60_000);
        }
        if (instant.getTime() <= now) continue;

        const conflictsOccupied = occupiedMs.some(
          (t) => Math.abs(t - instant.getTime()) < Math.max(minGapMs, 60_000),
        );
        if (conflictsOccupied) continue;

        const prev = slots[slots.length - 1];
        if (prev && instant.getTime() - prev.getTime() < minGapMs) continue;

        slots.push(instant);
        occupiedMs.push(instant.getTime());
        placedToday += 1;
      }
    }

    return slots.slice(0, count);
  }
}
