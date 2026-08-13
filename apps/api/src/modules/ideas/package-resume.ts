export type PackageResumeStage = 'SCRIPT' | 'VOICE' | 'TRANSCRIPT' | 'VISUALS';

/**
 * Decide which pipeline stage to re-run after a FAILED package.
 * Prefer explicit stage prefixes on packageStageError; fall back to which
 * artifacts already exist on the brief.
 */
export function resolvePackageResumeStage(
  brief: {
    script: string | null;
    voiceoverStatus: string;
    voiceoverLocalPath: string | null;
    timedTranscript: unknown;
    packageStageError: string | null;
  } | null,
): PackageResumeStage {
  const err = brief?.packageStageError?.trim() ?? '';
  const script = brief?.script?.trim() ?? '';
  const hasScript = script.length > 0;
  const hasVoice =
    brief?.voiceoverStatus === 'READY' &&
    typeof brief.voiceoverLocalPath === 'string' &&
    brief.voiceoverLocalPath.length > 0;
  const timings = Array.isArray(brief?.timedTranscript) ? brief!.timedTranscript : [];
  const hasTranscript = timings.length > 0;

  if (/^script stage failed/i.test(err) || !hasScript) return 'SCRIPT';
  if (
    /^voice stage failed/i.test(err) ||
    /^empty narration/i.test(err) ||
    /^tts disabled/i.test(err)
  ) {
    return 'VOICE';
  }
  if (/^transcript stage failed/i.test(err)) return 'TRANSCRIPT';
  if (/^visuals stage failed/i.test(err)) return 'VISUALS';

  // Ambiguous errors (kill switch, MASTER_KEY, etc.): resume after last good artifact.
  if (!hasVoice) return 'VOICE';
  if (!hasTranscript) return 'TRANSCRIPT';
  return 'VISUALS';
}
