import { describe, expect, it } from 'vitest';
import {
  buildFinalVideoFilterChain,
  buildFinalVideoFilterFallbacks,
  finalVideoEffectsEnabled,
  resolveTrimStartMs,
  clampTrimStartMs,
  parseRenderSettings,
  shortenToHookWords,
  resolveHookOverlayText,
  buildHookTextVariants,
  DEFAULT_TRIM_START_MS,
  DEFAULT_RENDER_SETTINGS,
  captionForceStyle,
  colorFilterExpr,
  letterboxVertical9x16Filter,
  shouldForceVertical9x16,
  normalizeYoutubeFormat,
  VERTICAL_9x16_WIDTH,
  VERTICAL_9x16_HEIGHT,
} from './render-settings.js';

describe('resolveTrimStartMs', () => {
  it('prefers account trim over source trim', () => {
    expect(resolveTrimStartMs({ accountTrimMs: 800, sourceTrimMs: 200 })).toBe(800);
  });

  it('falls back to source then default 500', () => {
    expect(resolveTrimStartMs({ accountTrimMs: null, sourceTrimMs: 300 })).toBe(300);
    expect(resolveTrimStartMs({ accountTrimMs: null, sourceTrimMs: null })).toBe(
      DEFAULT_TRIM_START_MS,
    );
  });

  it('clamps out-of-range values', () => {
    expect(clampTrimStartMs(-10)).toBe(0);
    expect(clampTrimStartMs(999_999)).toBe(60_000);
  });
});

describe('hook text', () => {
  it('shortens titles to a few uppercase words', () => {
    expect(shortenToHookWords('Worker Finds Hidden Wall Safe During Demo', 3, 1)).toBe(
      'WORKER FINDS HIDDEN',
    );
  });

  it('wraps longer hooks onto 2 lines when maxLines allows', () => {
    expect(shortenToHookWords('Worker Finds Hidden Wall Safe During Demo', 6, 2)).toBe(
      'WORKER FINDS HIDDEN\nWALL SAFE DURING',
    );
  });

  it('builds distinct short and longer options from AI + title', () => {
    const opts = buildHookTextVariants({
      title: 'Worker Finds Hidden Wall Safe During Demo',
      overlayHooks: ['HIDDEN SAFE', 'SECRET REVEALED', 'WAIT FOR IT', 'HIDDEN SAFE'],
      variantHooks: ['You will not believe this find'],
      maxWords: 8,
      maxOptions: 6,
    });
    expect(opts.length).toBeGreaterThanOrEqual(3);
    expect(opts.length).toBeLessThanOrEqual(6);
    expect(new Set(opts.map((o) => o.text)).size).toBe(opts.length);
  });

  it('resolves custom vs title vs selected options', () => {
    expect(
      resolveHookOverlayText(
        { enabled: true, source: 'custom', customText: 'wait for it', maxWords: 3, maxLines: 1, position: 'top' },
        'Long Title Here',
      ),
    ).toBe('WAIT FOR IT');
    expect(
      resolveHookOverlayText(
        { enabled: true, source: 'title', maxWords: 2, maxLines: 1, position: 'top' },
        'Hidden Safe Revealed Live',
      ),
    ).toBe('HIDDEN SAFE');
    expect(
      resolveHookOverlayText(
        { enabled: true, source: 'options', maxWords: 3, maxLines: 1, position: 'top' },
        'Hidden Safe Revealed Live',
        'SECRET WALL',
      ),
    ).toBe('SECRET WALL');
    expect(
      resolveHookOverlayText(
        { enabled: false, source: 'title', maxWords: 3, maxLines: 1, position: 'top' },
        'Anything',
      ),
    ).toBeNull();
  });
});

describe('buildFinalVideoFilterChain', () => {
  const base = { ...DEFAULT_RENDER_SETTINGS };

  it('returns empty vf when visual effects off (trim is applied via -ss separately)', () => {
    expect(
      buildFinalVideoFilterChain({
        settings: base,
        subtitlePath: '/tmp/vo.srt',
        hookOverlayText: 'HOOK',
      }),
    ).toBe('');
    // Default trimStartMs=500 still requires an effects pass for lead-in cut.
    expect(finalVideoEffectsEnabled(base, '/tmp/vo.srt', 'HOOK')).toBe(true);
    expect(
      finalVideoEffectsEnabled({ ...base, trimStartMs: 0 }, '/tmp/vo.srt', 'HOOK'),
    ).toBe(false);
  });

  it('includes hflip when flip enabled', () => {
    const vf = buildFinalVideoFilterChain({
      settings: {
        ...base,
        flipHorizontal: { enabled: true },
      },
    });
    expect(vf).toBe('hflip');
    expect(finalVideoEffectsEnabled({ ...base, flipHorizontal: { enabled: true } })).toBe(true);
  });

  it('includes color eq when filter enabled', () => {
    const vf = buildFinalVideoFilterChain({
      settings: {
        ...base,
        colorFilter: { enabled: true, preset: 'vivid' },
      },
    });
    expect(vf).toContain('eq=');
    expect(colorFilterExpr('vivid')).toContain('saturation');
  });

  it('burns subtitles only when enabled and path present', () => {
    const off = buildFinalVideoFilterChain({
      settings: {
        ...base,
        burnCaptions: { enabled: true, preset: 'bottom' },
      },
      subtitlePath: null,
    });
    expect(off).toBe('');

    const on = buildFinalVideoFilterChain({
      settings: {
        ...base,
        burnCaptions: { enabled: true, preset: 'bottom' },
      },
      subtitlePath: 'C:\\tmp\\voiceover.srt',
    });
    expect(on).toContain('subtitles=');
    expect(on).toContain('force_style=');
    expect(captionForceStyle({ enabled: true, preset: 'bottom_white' })).toContain('Alignment=8');
  });

  it('draws hook text with optional fontfile', () => {
    const vf = buildFinalVideoFilterChain({
      settings: {
        ...base,
        hookText: { enabled: true, source: 'title', maxWords: 3 },
        burnCaptions: { enabled: true, preset: 'bottom' },
      },
      subtitlePath: '/data/voiceover.srt',
      hookOverlayText: 'HIDDEN SAFE',
      fontFile: '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    });
    expect(vf).toContain("drawtext=text='HIDDEN SAFE'");
    expect(vf).toContain('fontfile=');
    expect(vf).toContain('subtitles=');
    expect(
      finalVideoEffectsEnabled(
        { ...base, trimStartMs: 0, hookText: { enabled: true, source: 'title', maxWords: 3 } },
        null,
        'HIDDEN SAFE',
      ),
    ).toBe(true);
  });

  it('builds progressive fallbacks without hook then without captions', () => {
    const fallbacks = buildFinalVideoFilterFallbacks({
      settings: {
        ...base,
        flipHorizontal: { enabled: true },
        hookText: { enabled: true, source: 'title', maxWords: 3 },
        burnCaptions: { enabled: true, preset: 'bottom' },
      },
      subtitlePath: '/data/voiceover.srt',
      hookOverlayText: 'HIDDEN SAFE',
    });
    expect(fallbacks[0]).toContain('drawtext=');
    expect(fallbacks[0]).toContain('subtitles=');
    expect(fallbacks[1]).not.toContain('drawtext=');
    expect(fallbacks[1]).toContain('subtitles=');
    expect(fallbacks[2]).toBe('hflip');
  });

  it('combines flip + color + captions', () => {
    const vf = buildFinalVideoFilterChain({
      settings: {
        ...base,
        flipHorizontal: { enabled: true },
        colorFilter: { enabled: true, preset: 'warm' },
        burnCaptions: { enabled: true, preset: 'center' },
      },
      subtitlePath: '/data/voiceover.srt',
    });
    expect(vf.startsWith('hflip,')).toBe(true);
    expect(vf).toContain('eq=');
    expect(vf).toContain('subtitles=');
  });

  it('letterboxes to 1080x1920 before overlays when forceVertical9x16', () => {
    const pad = letterboxVertical9x16Filter();
    expect(pad).toContain(`scale=${VERTICAL_9x16_WIDTH}:${VERTICAL_9x16_HEIGHT}:force_original_aspect_ratio=decrease`);
    expect(pad).toContain(`pad=${VERTICAL_9x16_WIDTH}:${VERTICAL_9x16_HEIGHT}:(ow-iw)/2:(oh-ih)/2:black`);
    expect(pad).toContain('setsar=1');

    const vf = buildFinalVideoFilterChain({
      settings: {
        ...base,
        flipHorizontal: { enabled: true },
      },
      forceVertical9x16: true,
      assPath: '/tmp/overlay.ass',
    });
    expect(vf.indexOf('hflip')).toBeLessThan(vf.indexOf('scale='));
    expect(vf.indexOf('pad=')).toBeLessThan(vf.indexOf('ass='));
    expect(finalVideoEffectsEnabled({ ...base, trimStartMs: 0 }, null, null, null, true)).toBe(
      true,
    );
  });
});

describe('shouldForceVertical9x16', () => {
  it('forces Facebook and TikTok always', () => {
    expect(shouldForceVertical9x16({ platform: 'FACEBOOK' })).toBe(true);
    expect(shouldForceVertical9x16({ platform: 'TIKTOK', youtubeFormat: 'LONG' })).toBe(true);
  });

  it('forces YouTube Short (default) but not Long', () => {
    expect(shouldForceVertical9x16({ platform: 'YOUTUBE' })).toBe(true);
    expect(shouldForceVertical9x16({ platform: 'YOUTUBE', youtubeFormat: 'SHORT' })).toBe(true);
    expect(shouldForceVertical9x16({ platform: 'YOUTUBE', youtubeFormat: 'LONG' })).toBe(false);
    expect(normalizeYoutubeFormat('long')).toBe('LONG');
  });

  it('does not force unknown platforms', () => {
    expect(shouldForceVertical9x16({ platform: null })).toBe(false);
  });
});

describe('parseRenderSettings', () => {
  it('reads nested renderSettings from voiceSettings-shaped objects', () => {
    const s = parseRenderSettings({
      renderSettings: {
        trimStartMs: 750,
        flipHorizontal: { enabled: true },
        burnCaptions: { enabled: true, preset: 'karaoke' },
        hookText: { enabled: true, source: 'custom', customText: 'WAIT FOR IT', maxWords: 3 },
        colorFilter: { enabled: true, preset: 'cool' },
        reactionAvatar: {
          enabled: true,
          removeBg: 'chromakey',
          chromakeyColor: '#00FF00',
        },
      },
    });
    expect(s.trimStartMs).toBe(750);
    expect(s.flipHorizontal.enabled).toBe(true);
    expect(s.burnCaptions.preset).toBe('karaoke_yellow');
    expect(s.hookText.enabled).toBe(true);
    expect(s.hookText.customText).toBe('WAIT FOR IT');
    expect(s.colorFilter.preset).toBe('cool');
    expect(s.reactionAvatar.removeBg).toBe('chromakey');
    expect(s.reactionAvatar.chromakeyColor).toBe('#00FF00');
  });

  it('defaults reactionAvatar removeBg to auto', () => {
    const s = parseRenderSettings({});
    expect(s.reactionAvatar.removeBg).toBe('auto');
    expect(s.reactionAvatar.chromakeyColor).toBe('#00B140');
  });
});
