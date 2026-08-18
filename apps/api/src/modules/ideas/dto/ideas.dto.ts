import { z } from 'zod';

/** How many ideas to generate (default 50). Optional topicSeed steers topics. */
export const generateIdeasSchema = z.object({
  count: z.number().int().min(1).max(50).default(50).optional(),
  /** User-provided topic seed; empty/whitespace is treated as omitted. */
  topicSeed: z
    .string()
    .max(2000)
    .optional()
    .transform((v) => {
      const trimmed = v?.trim();
      return trimmed ? trimmed : undefined;
    }),
  /**
   * When true with topicSeed, generate one idea that uses the seed as the exact
   * title/topic (no invent-original-title expansion).
   */
  exactTopic: z.boolean().optional().default(false),
});
export type GenerateIdeasDto = z.infer<typeof generateIdeasSchema>;

/** Patch an idea's editable fields. At least one field must be provided. */
export const patchIdeaSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    angle: z.string().min(1).max(2000).optional(),
    hook: z.string().min(1).max(2000).optional(),
    topicSummary: z.string().max(4000).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update.',
  });
export type PatchIdeaDto = z.infer<typeof patchIdeaSchema>;

/** Optional rejection reason when rejecting an idea. */
export const rejectIdeaSchema = z.object({
  rejectionReason: z.string().max(2000).optional(),
});
export type RejectIdeaDto = z.infer<typeof rejectIdeaSchema>;

/**
 * Owner params before creative-package generation.
 * clipDurationSec is typically 8 / 10 / 15 / 30 for scene clips.
 */
export const generatePackageSchema = z.object({
  videoDurationSec: z.number().int().min(15).max(600),
  clipDurationSec: z.union([z.literal(8), z.literal(10), z.literal(15), z.literal(30)]),
});
export type GeneratePackageDto = z.infer<typeof generatePackageSchema>;

/** Upload finished video linked to an idea after package Done. */
export const uploadIdeaVideoSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  scheduleMode: z.enum(['NOW', 'QUEUE_SLOT']).default('QUEUE_SLOT'),
});
export type UploadIdeaVideoDto = z.infer<typeof uploadIdeaVideoSchema>;

/** Re-run one creative-package stage (script / voiceover / visuals). */
export const regeneratePackageSchema = z.object({
  stage: z.enum(['script', 'voiceover', 'visuals']),
});
export type RegeneratePackageDto = z.infer<typeof regeneratePackageSchema>;

/** Create a kids-rhyme package: generate or paste lyrics, then wait for owner voice. */
export const createRhymePackageSchema = z.object({
  topic: z.string().max(500).optional(),
  rhyme: z.string().max(8000).optional(),
  videoDurationSec: z.number().int().min(15).max(180).default(60),
  clipDurationSec: z.union([z.literal(8), z.literal(10), z.literal(15), z.literal(30)]).default(10),
});
export type CreateRhymePackageDto = z.infer<typeof createRhymePackageSchema>;
