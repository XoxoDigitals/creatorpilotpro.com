import { z } from 'zod';
import { TaskTypeSchema } from '@scp/shared';

// ── Keys ────────────────────────────────────────────────────────────────────

export const createKeySchema = z.object({
  label: z.string().min(1).max(120),
  key: z.string().min(1).max(4000),
  priority: z.number().int().min(0).max(100000).optional(),
  limits: z.record(z.string(), z.unknown()).optional(),
});
export type CreateKeyDto = z.infer<typeof createKeySchema>;

export const setProviderEnabledSchema = z.object({ enabled: z.boolean() });
export type SetProviderEnabledDto = z.infer<typeof setProviderEnabledSchema>;

export const setKeyStatusSchema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) });
export type SetKeyStatusDto = z.infer<typeof setKeyStatusSchema>;

export const reorderKeySchema = z.object({ direction: z.enum(['up', 'down']) });
export type ReorderKeyDto = z.infer<typeof reorderKeySchema>;

// ── Prompt versions ─────────────────────────────────────────────────────────

export const createPromptVersionSchema = z.object({
  accountId: z.string().nullable().optional(),
  task: TaskTypeSchema,
  name: z.string().min(1).max(120),
  template: z.string().min(1).max(50000),
  schemaHint: z.unknown().optional(),
});
export type CreatePromptVersionDto = z.infer<typeof createPromptVersionSchema>;

export const setPromptActiveSchema = z.object({ isActive: z.boolean() });
export type SetPromptActiveDto = z.infer<typeof setPromptActiveSchema>;

// ── Playground ──────────────────────────────────────────────────────────────

export const playgroundSchema = z.object({
  task: TaskTypeSchema,
  model: z.string().min(1).max(200),
  system: z.string().max(50000).optional(),
  input: z.union([z.string(), z.record(z.string(), z.unknown())]),
  promptVersion: z.number().int().min(1).optional(),
  styleVersion: z.number().int().min(1).optional(),
  skipCache: z.boolean().optional(),
});
export type PlaygroundDto = z.infer<typeof playgroundSchema>;

// ── Usage stats ─────────────────────────────────────────────────────────────

export const usageStatsQuerySchema = z.object({
  providerId: z.string().optional(),
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
});
export type UsageStatsQueryDto = z.infer<typeof usageStatsQuerySchema>;

// ── Edge Neural TTS voices ──────────────────────────────────────────────────

export const ttsPreviewSchema = z.object({
  voiceId: z.string().min(1).max(120).default('en-US-AriaNeural'),
  text: z.string().min(1).max(500).optional(),
  rate: z.string().max(32).optional(),
  pitch: z.string().max(32).optional(),
  volume: z.string().max(32).optional(),
});
export type TtsPreviewDto = z.infer<typeof ttsPreviewSchema>;

// ── Compose channel master prompt ───────────────────────────────────────────

export const composeMasterPromptSchema = z.object({
  language: z.string().min(2).max(16).default('en'),
  answers: z.record(z.string(), z.unknown()),
  animationReferencePrompt: z.string().max(50000).optional(),
  thumbnailReferencePrompt: z.string().max(20000).optional(),
  titleTemplate: z.string().max(500).optional(),
  descriptionTemplate: z.string().max(5000).optional(),
  writingStyle: z.string().max(5000).optional(),
  narrationStyle: z.string().max(5000).optional(),
  contentType: z.string().max(32).optional(),
  /** Freeform voice / TTS notes (provider, voice id, locale, rate). */
  voiceNotes: z.string().max(2000).optional(),
  /** When true, skip the LLM polish and return the deterministic system-style compose. */
  localOnly: z.boolean().optional(),
});
export type ComposeMasterPromptDto = z.infer<typeof composeMasterPromptSchema>;
