/**
 * English summaries of non-English voiceover scripts so channel owners can
 * understand spoken narration without changing the localized VO itself.
 */
import { isEnglishContentLanguage, languageDisplayName } from './content-languages.js';

/** True when the channel output language is not English (summary should be generated/shown). */
export function needsEnglishVoiceoverSummary(language?: string | null): boolean {
  return !isEnglishContentLanguage(language);
}

/** System prompt for a single-script English summary (plain prose response). */
export function englishVoiceoverSummarySystemPrompt(sourceLanguage?: string | null): string {
  const lang = languageDisplayName(sourceLanguage);
  return `You write concise English summaries of short-form video voiceover scripts for Social Creator Pilot channel owners.
Keep these instructions in English.
The spoken script is written in ${lang}. Summarize what the narrator says in clear English so an English-speaking owner understands the content.
Do not invent facts that are not in the script. Prefer a faithful 2–5 sentence summary of the spoken meaning over a literal word-for-word translation.
Return ONLY the English summary as plain prose. No JSON, no markdown fences, no title, no commentary.`;
}

/** System prompt for summarizing several variants at once (JSON response). */
export function englishVoiceoverSummariesBatchSystemPrompt(sourceLanguage?: string | null): string {
  const lang = languageDisplayName(sourceLanguage);
  return `You write concise English summaries of short-form video voiceover scripts for Social Creator Pilot channel owners.
Keep these instructions in English.
Each spoken script is written in ${lang}. For every variant, summarize what that narrator says in clear English so an English-speaking owner understands the content.
Do not invent facts that are not in that variant's script. Prefer a faithful 2–5 sentence summary per variant over a literal word-for-word translation.
Return JSON only (no markdown fences) with shape:
{"summaries":[{"id":string,"englishSummary":string}]}
Include exactly one entry per input variant id.`;
}

/** Pull plain-text summary from model output (strips fences / quotes). */
export function extractEnglishSummaryText(output: unknown): string {
  if (output == null) return '';
  if (typeof output === 'object' && !Array.isArray(output)) {
    const row = output as Record<string, unknown>;
    for (const key of ['englishSummary', 'summary', 'text', 'script'] as const) {
      const v = row[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
  }
  let text = String(output).trim();
  if (!text) return '';
  const fenced = text.match(/^```(?:json|JSON|text)?\s*\r?\n?([\s\S]*?)\r?\n?```\s*$/);
  if (fenced?.[1]) text = fenced[1].trim();
  if (text.startsWith('{')) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      for (const key of ['englishSummary', 'summary', 'text'] as const) {
        const v = parsed[key];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
    } catch {
      /* plain prose */
    }
  }
  return text.replace(/^["']|["']$/g, '').trim();
}

/** Parse batch summaries keyed by variant id. */
export function parseEnglishSummariesBatch(
  output: unknown,
  expectedIds: string[],
): Map<string, string> {
  const map = new Map<string, string>();
  let rows: unknown[] = [];
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const summaries = (output as Record<string, unknown>).summaries;
    if (Array.isArray(summaries)) rows = summaries;
  } else if (typeof output === 'string') {
    const text = extractEnglishSummaryText(output);
    try {
      const parsed = JSON.parse(text.startsWith('{') ? text : String(output).trim()) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const summaries = (parsed as Record<string, unknown>).summaries;
        if (Array.isArray(summaries)) rows = summaries;
      } else if (Array.isArray(parsed)) {
        rows = parsed;
      }
    } catch {
      if (expectedIds.length === 1 && text) map.set(expectedIds[0]!, text);
      return map;
    }
  } else if (Array.isArray(output)) {
    rows = output;
  }

  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const o = row as Record<string, unknown>;
    const id = typeof o.id === 'string' ? o.id.trim() : '';
    const summary =
      typeof o.englishSummary === 'string'
        ? o.englishSummary.trim()
        : typeof o.summary === 'string'
          ? o.summary.trim()
          : '';
    if (id && summary) map.set(id, summary);
  }
  return map;
}
