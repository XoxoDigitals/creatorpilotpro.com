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

/** Weekday index (0=Sun..6=Sat) of an instant as seen in `timeZone`. */
function localWeekday(at: Date, timeZone: string): number {
  const short = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' })
    .format(at)
    .slice(0, 3)
    .toLowerCase();
  return WEEKDAY_INDEX[short] ?? at.getUTCDay();
}

@Injectable()
export class SlotPlannerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Expand an account's schedulingPrefs into the next `count` concrete future
   * publish instants (docs/06 §3 Layer 1). Randomized windows are fixed at
   * generation time so a slot doesn't drift. Respects perDay/maxPerDay, minGapMin,
   * cadence (daily vs specific weekdays), and the account timezone.
   */
  async nextSlots(accountId: string, count: number): Promise<Date[]> {
    const account = await this.prisma.client.socialAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      include: { profile: true },
    });
    if (!account) throw new NotFoundException('Account not found.');

    const prefs = (account.profile?.schedulingPrefs ?? {}) as SchedulingPrefs;
    const tz = account.timezone || 'UTC';
    const times = (prefs.times ?? DEFAULT_TIMES)
      .map((t) => t.trim())
      .filter((t) => HHMM_RE.test(t))
      .sort();
    const effectiveTimes = times.length > 0 ? times : DEFAULT_TIMES;

    const perDayCap = Math.min(prefs.perDay ?? effectiveTimes.length, prefs.maxPerDay ?? 50);
    const minGapMs = (prefs.minGapMin ?? 0) * 60_000;
    const jitterMax = Math.max(0, prefs.randomizeMinutes ?? 0);
    const useWeekdays = prefs.cadence === 'SPECIFIC_DAYS';
    const allowedDays = new Set(
      (prefs.days ?? [])
        .map((d) => WEEKDAY_INDEX[d.slice(0, 3).toLowerCase()])
        .filter((n): n is number => n != null),
    );

    const now = Date.now();
    const slots: Date[] = [];
    const cursor = new Date();

    for (let dayOffset = 0; dayOffset < PLAN_HORIZON_DAYS && slots.length < count; dayOffset += 1) {
      const day = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + dayOffset);
      // Weekday check is done against the account timezone's local day.
      if (useWeekdays && allowedDays.size > 0 && !allowedDays.has(localWeekday(day, tz))) {
        continue;
      }

      let placedToday = 0;
      for (const time of effectiveTimes) {
        if (placedToday >= perDayCap || slots.length >= count) break;
        const hh = Number(time.slice(0, 2));
        const mm = Number(time.slice(3, 5));
        let instant = zonedWallTimeToUtc(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm, tz);
        if (jitterMax > 0) {
          instant = new Date(instant.getTime() + Math.floor(Math.random() * jitterMax) * 60_000);
        }
        if (instant.getTime() <= now) continue; // strictly future
        const prev = slots[slots.length - 1];
        if (prev && instant.getTime() - prev.getTime() < minGapMs) continue;
        slots.push(instant);
        placedToday += 1;
      }
    }

    return slots.slice(0, count);
  }
}
