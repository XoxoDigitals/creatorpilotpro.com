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
    expect(captionForceStyle({ enabled: true, preset: 'bottom_white' })).toContain('Alignment=2');
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
      },
    });
    expect(s.trimStartMs).toBe(750);
    expect(s.flipHorizontal.enabled).toBe(true);
    expect(s.burnCaptions.preset).toBe('karaoke_yellow');
    expect(s.hookText.enabled).toBe(true);
    expect(s.hookText.customText).toBe('WAIT FOR IT');
    expect(s.colorFilter.preset).toBe('cool');
  });
});
