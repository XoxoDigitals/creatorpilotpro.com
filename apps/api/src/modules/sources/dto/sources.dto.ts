import { z } from 'zod';

/** Create a watched source (docs/04 §1). GENERIC_URL is used for bulk-import batches. */
export const createSourceSchema = z.object({
  type: z.enum(['KUAISHOU_PROFILE', 'GENERIC_URL']),
  url: z.string().min(1).max(2000),
  label: z.string().max(200).optional(),
  checkIntervalMin: z.number().int().min(15).max(10_080).optional(),
  trimStartMs: z.number().int().min(0).max(60_000).optional(),
  targetAccountId: z.string().min(1).optional(),
});
export type CreateSourceDto = z.infer<typeof createSourceSchema>;

/** Patch a watched source. `status` only toggles between ACTIVE/PAUSED (ERROR is worker-set). */
export const patchSourceSchema = z
  .object({
    label: z.string().max(200).optional(),
    status: z.enum(['ACTIVE', 'PAUSED']).optional(),
    checkIntervalMin: z.number().int().min(15).max(10_080).optional(),
    trimStartMs: z.number().int().min(0).max(60_000).optional(),
    targetAccountId: z.string().min(1).nullable().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update.',
  });
export type PatchSourceDto = z.infer<typeof patchSourceSchema>;

/**
 * Bulk URL import (docs/04 §1, FR-B2). Creates one PAUSED GENERIC_URL source
 * (a "batch") and a SourceVideo per URL, then enqueues each for download.
 */
export const bulkImportSchema = z.object({
  urls: z.array(z.string().min(1).max(2000)).min(1).max(500),
  label: z.string().max(200).optional(),
  targetAccountId: z.string().min(1).optional(),
});
export type BulkImportDto = z.infer<typeof bulkImportSchema>;

/** Set/clear the rights note gating a repurposed item's approval (docs/04 §3). */
export const setRightsSchema = z.object({
  rightsNote: z.string().min(1).max(2000),
});
export type SetRightsDto = z.infer<typeof setRightsSchema>;
