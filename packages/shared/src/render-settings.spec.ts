import { describe, expect, it } from 'vitest';
import {
  buildFinalVideoFilterChain,
  finalVideoEffectsEnabled,
  resolveTrimStartMs,
  clampTrimStartMs,
  parseRenderSettings,
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

describe('buildFinalVideoFilterChain', () => {
  const base = { ...DEFAULT_RENDER_SETTINGS };

  it('returns empty when all effects off', () => {
    expect(
      buildFinalVideoFilterChain({
        settings: base,
        subtitlePath: '/tmp/vo.srt',
      }),
    ).toBe('');
    expect(finalVideoEffectsEnabled(base, '/tmp/vo.srt')).toBe(false);
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
    expect(captionForceStyle({ enabled: true, preset: 'bottom' })).toContain('Alignment=2');
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
        colorFilter: { enabled: true, preset: 'cool' },
      },
    });
    expect(s.trimStartMs).toBe(750);
    expect(s.flipHorizontal.enabled).toBe(true);
    expect(s.burnCaptions.preset).toBe('karaoke');
    expect(s.colorFilter.preset).toBe('cool');
  });
});
