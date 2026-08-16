import { describe, expect, it } from 'vitest';
import { dialogueOverlayEnableExpr, reactionAvatarOverlayXy } from './ffmpeg.js';
import { reactionAvatarNobgCachePath } from './rembg-avatar.js';

describe('dialogueOverlayEnableExpr', () => {
  it('builds OR of between() windows', () => {
    const expr = dialogueOverlayEnableExpr([
      { startSec: 1.2, endSec: 3.4 },
      { startSec: 10, endSec: 12.5 },
    ]);
    expect(expr).toContain('between(t\\,1.2\\,3.4)');
    expect(expr).toContain('between(t\\,10\\,12.5)');
    expect(expr?.includes('+')).toBe(true);
  });

  it('returns null for empty / invalid ranges', () => {
    expect(dialogueOverlayEnableExpr([])).toBeNull();
    expect(dialogueOverlayEnableExpr([{ startSec: 5, endSec: 5.01 }])).toBeNull();
  });
});

describe('reactionAvatarOverlayXy', () => {
  it('maps corners to overlay expressions', () => {
    expect(reactionAvatarOverlayXy('br')).toEqual({ x: 'W-w-36', y: 'H-h-36' });
    expect(reactionAvatarOverlayXy('tl', 20)).toEqual({ x: '20', y: '20' });
  });
});

describe('reactionAvatarNobgCachePath', () => {
  it('maps images to .nobg.png and videos to .nobg.webm', () => {
    expect(reactionAvatarNobgCachePath('/a/reaction-avatar.jpg')).toBe('/a/reaction-avatar.nobg.png');
    expect(reactionAvatarNobgCachePath('/a/reaction-avatar-lipsync.mp4')).toBe(
      '/a/reaction-avatar-lipsync.nobg.webm',
    );
  });
});
