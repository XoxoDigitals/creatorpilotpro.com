import { z } from 'zod';

/** Create a drama series (Phase 4). Triggers bible generation on creation. */
export const createSeriesSchema = z.object({
  title: z.string().min(1).max(200),
  genre: z.string().min(1).max(100),
  theme: z.string().min(1).max(500),
  audience: z.string().min(1).max(200),
  episodeCount: z.number().int().min(1).max(100),
  episodeDurationSec: z.number().int().min(15).max(600).default(60),
  styleReferences: z.string().max(2000).optional(),
});
export type CreateSeriesDto = z.infer<typeof createSeriesSchema>;

/** Patch a drama series. Only allowed in PLANNING or BIBLE_READY status. */
export const patchSeriesSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    genre: z.string().min(1).max(100).optional(),
    theme: z.string().min(1).max(500).optional(),
    audience: z.string().min(1).max(200).optional(),
    episodeCount: z.number().int().min(1).max(100).optional(),
    episodeDurationSec: z.number().int().min(15).max(600).optional(),
    styleReferences: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update.',
  });
export type PatchSeriesDto = z.infer<typeof patchSeriesSchema>;
