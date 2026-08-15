import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_READY_BUFFER_DAYS,
  downloadSlotsAvailable,
  estimatePendingDownloadEtas,
  resolvePostsPerDay,
} from '@scp/shared';

describe('resolvePostsPerDay', () => {
  it('prefers maxPerDay then perDay then times length', () => {
    expect(resolvePostsPerDay({ maxPerDay: 3, perDay: 5 })).toBe(3);
    expect(resolvePostsPerDay({ perDay: 4 })).toBe(4);
    expect(resolvePostsPerDay({ times: ['09:00', '13:00', '18:00'] })).toBe(3);
    expect(resolvePostsPerDay({})).toBe(1);
  });

  it('clamps to 1..50', () => {
    expect(resolvePostsPerDay({ perDay: 0 })).toBe(1);
    expect(resolvePostsPerDay({ perDay: 999 })).toBe(50);
  });
});

describe('downloadSlotsAvailable', () => {
  it('holds when ~2 days of content are already ready', () => {
    expect(downloadSlotsAvailable({ postsPerDay: 3, ready: 6, inFlight: 0 })).toBe(0);
    expect(downloadSlotsAvailable({ postsPerDay: 3, ready: 5, inFlight: 1 })).toBe(0);
  });

  it('releases about 1 day when under the buffer', () => {
    expect(downloadSlotsAvailable({ postsPerDay: 3, ready: 0, inFlight: 0 })).toBe(3);
    expect(downloadSlotsAvailable({ postsPerDay: 3, ready: 4, inFlight: 0 })).toBe(2);
    expect(DOWNLOAD_READY_BUFFER_DAYS).toBe(2);
  });
});

describe('estimatePendingDownloadEtas', () => {
  it('marks free slots as next drip and later rows by day', () => {
    const now = new Date('2026-08-15T15:00:00');
    const map = estimatePendingDownloadEtas({
      pendingIdsOldestFirst: ['a', 'b', 'c', 'd', 'e', 'f'],
      postsPerDay: 3,
      ready: 4,
      inFlight: 0,
      now,
    });
    // freeNow = min(6-4, 3) = 2
    expect(map.get('a')?.label).toContain('Next drip');
    expect(map.get('b')?.label).toContain('Next drip');
    expect(map.get('c')?.label).toContain('tomorrow');
    expect(map.get('f')?.position).toBe(6);
  });
});
