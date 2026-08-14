/**
 * Generate English summaries for non-English voiceover scripts (owner readability).
 * Failures are non-fatal — callers keep the localized script either way.
 */
import {
  TaskType,
  needsEnglishVoiceoverSummary,
  englishVoiceoverSummarySystemPrompt,
  englishVoiceoverSummariesBatchSystemPrompt,
  extractEnglishSummaryText,
  parseEnglishSummariesBatch,
  languageDisplayName,
} from '@scp/shared';
import {
  cacheKeyFor,
  hashText,
  type AIRouter,
} from '@scp/ai-providers';
import { z } from 'zod';

const batchSchema = z.object({
  summaries: z.array(
    z.object({
      id: z.string(),
      englishSummary: z.string(),
    }),
  ),
});

export async function summarizeVoiceoverInEnglish(
  router: AIRouter,
  opts: {
    script: string;
    language: string;
    contentItemId?: string;
    ideaId?: string;
  },
): Promise<string> {
  if (!needsEnglishVoiceoverSummary(opts.language)) return '';
  const script = opts.script.trim();
  if (!script) return '';

  try {
    const result = await router.run({
      task: TaskType.NARRATION_REWRITE as any,
      model: '',
      maxTokens: 1024,
      system: englishVoiceoverSummarySystemPrompt(opts.language),
      input: {
        kind: 'text',
        text: JSON.stringify({
          sourceLanguage: languageDisplayName(opts.language),
          spokenScript: script,
          instruction: 'Write a concise English summary of this voiceover for the channel owner.',
        }),
      },
      cacheKey: cacheKeyFor({
        task: TaskType.NARRATION_REWRITE as any,
        model: 'english-vo-summary-v1',
        promptVersion: 1,
        styleVersion: 1,
        inputContentHash: hashText(`en-sum:${opts.language}:${script}`),
      }),
      contentItemId: opts.contentItemId,
    });
    return extractEnglishSummaryText(result.output);
  } catch (err) {
    console.warn(
      `[worker:en-summary] single summary failed:`,
      err instanceof Error ? err.message : err,
    );
    return '';
  }
}

export async function summarizeVoiceoverVariantsInEnglish(
  router: AIRouter,
  opts: {
    variants: { id: string; script: string }[];
    language: string;
    contentItemId?: string;
  },
): Promise<Map<string, string>> {
  const empty = new Map<string, string>();
  if (!needsEnglishVoiceoverSummary(opts.language)) return empty;
  const variants = opts.variants
    .map((v) => ({ id: v.id.trim(), script: v.script.trim() }))
    .filter((v) => v.id && v.script);
  if (variants.length === 0) return empty;

  if (variants.length === 1) {
    const only = variants[0]!;
    const summary = await summarizeVoiceoverInEnglish(router, {
      script: only.script,
      language: opts.language,
      contentItemId: opts.contentItemId,
    });
    return summary ? new Map([[only.id, summary]]) : empty;
  }

  try {
    const result = await router.run({
      task: TaskType.NARRATION_REWRITE as any,
      model: '',
      maxTokens: 2048,
      system: englishVoiceoverSummariesBatchSystemPrompt(opts.language),
      input: {
        kind: 'text',
        text: JSON.stringify({
          sourceLanguage: languageDisplayName(opts.language),
          variants: variants.map((v) => ({ id: v.id, spokenScript: v.script })),
          instruction:
            'Write a concise English summary for each voiceover variant for the channel owner.',
        }),
      },
      schema: batchSchema,
      cacheKey: cacheKeyFor({
        task: TaskType.NARRATION_REWRITE as any,
        model: 'english-vo-summaries-batch-v1',
        promptVersion: 1,
        styleVersion: 1,
        inputContentHash: hashText(
          `en-sum-batch:${opts.language}:${variants.map((v) => `${v.id}:${v.script}`).join('|')}`,
        ),
      }),
      contentItemId: opts.contentItemId,
    });
    return parseEnglishSummariesBatch(
      result.output,
      variants.map((v) => v.id),
    );
  } catch (err) {
    console.warn(
      `[worker:en-summary] batch summary failed — falling back to per-variant:`,
      err instanceof Error ? err.message : err,
    );
    const map = new Map<string, string>();
    for (const v of variants) {
      const summary = await summarizeVoiceoverInEnglish(router, {
        script: v.script,
        language: opts.language,
        contentItemId: opts.contentItemId,
      });
      if (summary) map.set(v.id, summary);
    }
    return map;
  }
}
