import { describe, expect, it } from 'vitest';
import { resolvePackageResumeStage } from './package-resume';

describe('resolvePackageResumeStage', () => {
  const base = {
    script: 'Hello world narration.',
    voiceoverStatus: 'READY' as string,
    voiceoverLocalPath: '/data/ideas/x/tts/voiceover.wav',
    timedTranscript: [{ startMs: 0, endMs: 1000, text: 'Hello' }],
    packageStageError: null as string | null,
  };

  it('restarts from SCRIPT when there is no usable script', () => {
    expect(resolvePackageResumeStage(null)).toBe('SCRIPT');
    expect(resolvePackageResumeStage({ ...base, script: '   ' })).toBe('SCRIPT');
  });

  it('uses error prefixes when present', () => {
    expect(
      resolvePackageResumeStage({
        ...base,
        packageStageError: 'Script stage failed: boom',
        script: '',
      }),
    ).toBe('SCRIPT');
    expect(
      resolvePackageResumeStage({
        ...base,
        packageStageError: 'Voice stage failed: boom',
        voiceoverStatus: 'FAILED',
        voiceoverLocalPath: null,
      }),
    ).toBe('VOICE');
    expect(
      resolvePackageResumeStage({
        ...base,
        packageStageError: 'Transcript stage failed: boom',
      }),
    ).toBe('TRANSCRIPT');
    expect(
      resolvePackageResumeStage({
        ...base,
        packageStageError: 'Visuals stage failed: boom',
      }),
    ).toBe('VISUALS');
  });

  it('falls back to artifacts for ambiguous errors', () => {
    expect(
      resolvePackageResumeStage({
        ...base,
        packageStageError: 'MASTER_KEY not configured',
        voiceoverStatus: 'NONE',
        voiceoverLocalPath: null,
        timedTranscript: [],
      }),
    ).toBe('VOICE');
    expect(
      resolvePackageResumeStage({
        ...base,
        packageStageError: 'MASTER_KEY not configured',
        timedTranscript: [],
      }),
    ).toBe('TRANSCRIPT');
    expect(
      resolvePackageResumeStage({
        ...base,
        packageStageError: 'MASTER_KEY not configured',
      }),
    ).toBe('VISUALS');
  });
});
