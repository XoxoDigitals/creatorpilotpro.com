import { z } from 'zod';

/**
 * AI task types routed through provider chains (docs/05 §2).
 * Feature code never names a provider directly — only a TaskType.
 */
export const TaskType = {
  VIDEO_ANALYSIS: 'VIDEO_ANALYSIS',
  NARRATION_REWRITE: 'NARRATION_REWRITE',
  METADATA: 'METADATA',
  AB_SUGGESTIONS: 'AB_SUGGESTIONS',
  IDEA_GENERATION: 'IDEA_GENERATION',
  BRIEF_GENERATION: 'BRIEF_GENERATION',
  DRAMA_BIBLE: 'DRAMA_BIBLE',
  DRAMA_EPISODE: 'DRAMA_EPISODE',
  TTS: 'TTS',
  TRANSCRIBE: 'TRANSCRIBE',
} as const;

export type TaskType = (typeof TaskType)[keyof typeof TaskType];

export const TaskTypeSchema = z.enum([
  'VIDEO_ANALYSIS',
  'NARRATION_REWRITE',
  'METADATA',
  'AB_SUGGESTIONS',
  'IDEA_GENERATION',
  'BRIEF_GENERATION',
  'DRAMA_BIBLE',
  'DRAMA_EPISODE',
  'TTS',
  'TRANSCRIBE',
]);

export const AI_PROVIDER_KIND = ['TEXT', 'TTS', 'MULTIMODAL'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KIND)[number];
