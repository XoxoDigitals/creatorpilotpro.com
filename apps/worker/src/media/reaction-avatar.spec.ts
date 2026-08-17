import { describe, expect, it } from 'vitest';
import { dialogueOverlayEnableExpr, reactionAvatarOverlayXy } from './ffmpeg.js';
import { ffmpegKeyColor, reactionAvatarNobgCachePath } from './rembg-avatar.js';
import {
  bridgeSpeakingGaps,
  pickReactionAvatarSource,
  reactionAvatarLayers,
  reactionAvatarSourceTrimSec,
  resolveReactionAvatarSpeakingRanges,
  speakingRangesFromSubtitleCues,
  sumSpeakingDurations,
  REACTION_AVATAR_FALLBACK_LEAD_IN_SEC,
  REACTION_AVATAR_HOLD_GAP_SEC,
} from './reaction-avatar-timing.js';

describe('pickReactionAvatarSource', () => {
  it('prefers the silent still over lip-sync so the face stays on in silence', () => {
    expect(
      pickReactionAvatarSource({
        enabled: true,
        assetPath: 'accounts/a/silent.png',
        lipSyncAssetPath: 'accounts/a/talk.mp4',
      }),
    ).toEqual({ rel: 'accounts/a/silent.png', kind: 'silent' });
  });

  it('falls back to lip-sync when no silent asset exists', () => {
    expect(
      pickReactionAvatarSource({
        enabled: true,
        lipSyncAssetPath: 'accounts/a/talk.mp4',
      }),
    ).toEqual({ rel: 'accounts/a/talk.mp4', kind: 'lip-sync' });
  });

  it('returns both silent and lip-sync paths when uploaded', () => {
    expect(
      reactionAvatarLayers({
        enabled: true,
        assetPath: 'accounts/a/silent.png',
        lipSyncAssetPath: 'accounts/a/talk.mp4',
      }),
    ).toEqual({
      silentRel: 'accounts/a/silent.png',
      lipSyncRel: 'accounts/a/talk.mp4',
    });
  });

  it('returns null when disabled or empty', () => {
    expect(pickReactionAvatarSource({ enabled: false, assetPath: 'x.png' })).toBeNull();
    expect(pickReactionAvatarSource({ enabled: true })).toBeNull();
  });
});

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
    expect(reactionAvatarOverlayXy('br')).toEqual({ x: 'W-w-36', y: 'H-h-108' });
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

  it('uses distinct chromakey cache suffixes', () => {
    expect(reactionAvatarNobgCachePath('/a/reaction-avatar.jpg', 'chromakey')).toBe(
      '/a/reaction-avatar.nobg-ck.png',
    );
    expect(reactionAvatarNobgCachePath('/a/clip.mp4', 'chromakey')).toBe('/a/clip.nobg-ck.webm');
  });

  it('tags shorter video trims in the cache path', () => {
    expect(reactionAvatarNobgCachePath('/a/clip.mp4', 'rembg', 3)).toBe('/a/clip.nobg-t3.webm');
    expect(reactionAvatarNobgCachePath('/a/clip.mp4', 'rembg', 8)).toBe('/a/clip.nobg.webm');
  });
});

describe('ffmpegKeyColor', () => {
  it('normalizes hex to 0xRRGGBB', () => {
    expect(ffmpegKeyColor('#00B140')).toBe('0x00B140');
    expect(ffmpegKeyColor('00FF00')).toBe('0x00FF00');
    expect(ffmpegKeyColor('bad')).toBe('0x00B140');
  });
});

describe('reaction avatar speaking / trim', () => {
  it('sums speaking durations', () => {
    expect(
      sumSpeakingDurations([
        { startSec: 1, endSec: 3 },
        { startSec: 10, endSec: 12.5 },
      ]),
    ).toBe(4.5);
  });

  it('maps subtitle cues to ranges', () => {
    expect(
      speakingRangesFromSubtitleCues([
        { startMs: 1000, endMs: 2500 },
        { startMs: 5000, endMs: 7000 },
      ]),
    ).toEqual([
      { startSec: 1, endSec: 2.5 },
      { startSec: 5, endSec: 7 },
    ]);
  });

  it('prefers dialogue ranges when showDuring=dialogue', () => {
    const r = resolveReactionAvatarSpeakingRanges({
      showDuring: 'dialogue',
      dialogueRanges: [{ startSec: 2, endSec: 4 }],
      subtitleCues: [{ startMs: 0, endMs: 9000 }],
      voEndSec: 20,
    });
    expect(r.source).toBe('dialogue');
    expect(r.ranges).toEqual([{ startSec: 2, endSec: 4 }]);
  });

  it('holds avatar across short inter-segment VO gaps', () => {
    const bridged = bridgeSpeakingGaps(
      [
        { startSec: 0, endSec: 1.0 },
        { startSec: 1.0 + 0.32, endSec: 2.5 },
      ],
      REACTION_AVATAR_HOLD_GAP_SEC,
    );
    expect(bridged).toEqual([{ startSec: 0, endSec: 2.5 }]);

    const r = resolveReactionAvatarSpeakingRanges({
      showDuring: 'dialogue',
      dialogueRanges: [
        { startSec: 0, endSec: 1 },
        { startSec: 1.32, endSec: 2.2 },
      ],
    });
    expect(r.source).toBe('dialogue');
    expect(r.ranges).toEqual([{ startSec: 0, endSec: 2.2 }]);

    const fromSubs = resolveReactionAvatarSpeakingRanges({
      showDuring: 'dialogue',
      dialogueRanges: [],
      subtitleCues: [
        { startMs: 0, endMs: 1000 },
        { startMs: 1320, endMs: 2500 },
      ],
    });
    expect(fromSubs.source).toBe('subtitle');
    expect(fromSubs.ranges).toEqual([{ startSec: 0, endSec: 2.5 }]);
  });

  it('does not bridge long silence in speaking-only mode', () => {
    const r = resolveReactionAvatarSpeakingRanges({
      showDuring: 'dialogue',
      dialogueRanges: [
        { startSec: 0, endSec: 1 },
        { startSec: 3.5, endSec: 4 },
      ],
    });
    expect(r.ranges).toEqual([
      { startSec: 0, endSec: 1 },
      { startSec: 3.5, endSec: 4 },
    ]);
  });

  it('falls back to subtitle then VO then lead-in', () => {
    expect(
      resolveReactionAvatarSpeakingRanges({
        showDuring: 'dialogue',
        dialogueRanges: [],
        subtitleCues: [{ startMs: 500, endMs: 1500 }],
      }).source,
    ).toBe('subtitle');

    expect(
      resolveReactionAvatarSpeakingRanges({
        showDuring: 'dialogue',
        dialogueRanges: [],
        voEndSec: 6.2,
        pictureSec: 30,
      }),
    ).toEqual({
      source: 'voiceover',
      ranges: [{ startSec: 0, endSec: 6.2 }],
    });

    const lead = resolveReactionAvatarSpeakingRanges({
      showDuring: 'dialogue',
      dialogueRanges: [],
      pictureSec: 40,
    });
    expect(lead.source).toBe('lead-in');
    expect(lead.ranges[0]?.endSec).toBe(REACTION_AVATAR_FALLBACK_LEAD_IN_SEC);
  });

  it('trims source to speaking total capped by clip length', () => {
    expect(
      reactionAvatarSourceTrimSec({
        speakingRanges: [
          { startSec: 0, endSec: 2 },
          { startSec: 5, endSec: 8 },
        ],
        clipDurationSec: 10,
      }),
    ).toBe(5);

    expect(
      reactionAvatarSourceTrimSec({
        speakingRanges: [{ startSec: 0, endSec: 20 }],
        clipDurationSec: 4,
      }),
    ).toBe(4);

    expect(
      reactionAvatarSourceTrimSec({
        speakingRanges: [{ startSec: 0, endSec: 20 }],
        maxSec: 8,
      }),
    ).toBe(8);
  });

  it('keeps avatar on for the full picture when showDuring=always', () => {
    const r = resolveReactionAvatarSpeakingRanges({
      showDuring: 'always',
      dialogueRanges: [{ startSec: 0, endSec: 1 }],
      voEndSec: 3,
      pictureSec: 12,
    });
    expect(r.source).toBe('always');
    expect(r.ranges).toEqual([{ startSec: 0, endSec: 12 }]);
  });

  it('builds enable expr from fallback speaking windows', () => {
    const { ranges } = resolveReactionAvatarSpeakingRanges({
      showDuring: 'dialogue',
      dialogueRanges: [],
      voEndSec: 3,
    });
    const expr = dialogueOverlayEnableExpr(ranges);
    expect(expr).toContain('between(t\\,0\\,3)');
  });
});
