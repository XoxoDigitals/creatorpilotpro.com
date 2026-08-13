import { describe, expect, it } from 'vitest';
import {
  buildChannelPerformanceMemory,
  computeDeterministicPerformance,
  fingerprintVideos,
  formatChannelPerformanceForPrompt,
  summarizePerformanceForUi,
} from './channel-performance.js';

const sample = [
  {
    videoId: 'a',
    title: 'Why Did This Secret Disappear Overnight?',
    views: 500_000,
    publishedAt: new Date('2026-06-01'),
  },
  {
    videoId: 'b',
    title: '7 Shocking Truths Nobody Told You',
    views: 420_000,
    publishedAt: new Date('2026-05-15'),
  },
  {
    videoId: 'c',
    title: 'Update',
    views: 800,
    publishedAt: new Date('2025-01-01'),
  },
  {
    videoId: 'd',
    title: 'How Mystery Channels Grow Fast',
    views: 310_000,
    publishedAt: new Date('2026-07-01'),
  },
  {
    videoId: 'e',
    title: 'Random vlog',
    views: 1_200,
    publishedAt: new Date('2024-01-01'),
  },
];

describe('channel-performance', () => {
  it('fingerprints stably and changes when views change', () => {
    const a = fingerprintVideos(sample);
    const b = fingerprintVideos(sample);
    expect(a).toBe(b);
    const changed = fingerprintVideos([
      ...sample.slice(0, 4),
      { ...sample[4]!, views: 9_999 },
    ]);
    expect(changed).not.toBe(a);
  });

  it('ranks top videos with recency adjustment and extracts patterns', () => {
    const signals = computeDeterministicPerformance(sample, new Date('2026-08-05'));
    expect(signals.sampleSize).toBe(5);
    expect(signals.topVideos.length).toBeGreaterThan(0);
    expect(signals.topVideos[0]!.views).toBeGreaterThan(1000);
    expect(signals.titlePatternsTop.questionRate).toBeGreaterThan(0);
    expect(signals.winningTopics.length).toBeGreaterThan(0);
  });

  it('builds memory and formats prompt without copying raw JSON', () => {
    const memory = buildChannelPerformanceMemory(sample, null, false, new Date('2026-08-05'));
    expect(memory.version).toBe(1);
    expect(memory.aiAvailable).toBe(false);
    const prompt = formatChannelPerformanceForPrompt('Zem TV', memory);
    expect(prompt).toContain('Zem TV');
    expect(prompt).toContain('fresh original');
    expect(prompt).not.toContain('"version"');

    const ui = summarizePerformanceForUi(memory);
    expect(ui.sampleSize).toBe(5);
    expect(ui.summary.length).toBeGreaterThan(10);
    expect(ui.topExamples.length).toBeGreaterThan(0);
  });
});
