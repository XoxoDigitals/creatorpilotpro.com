import { z } from 'zod';

export const createContentSchema = z.object({
  title: z.string().min(1).max(300),
  type: z.enum(['REPURPOSED', 'WORKER_PRODUCED', 'DRAMA_EPISODE', 'MANUAL_UPLOAD']).default('MANUAL_UPLOAD'),
});
export type CreateContentDto = z.infer<typeof createContentSchema>;

export const rejectContentSchema = z.object({
  reason: z.string().max(500).optional(),
});
export type RejectContentDto = z.infer<typeof rejectContentSchema>;

/** Owner edits to AI-generated publish metadata before schedule. */
export const updatePublishMetadataSchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).default(''),
  tags: z.array(z.string().min(1).max(100)).max(30).default([]),
});
export type UpdatePublishMetadataDto = z.infer<typeof updatePublishMetadataSchema>;

/** Re-render FINAL from existing VO; optional per-video bed level. */
export const rerenderContentSchema = z.object({
  backgroundBedPercent: z.number().int().min(1).max(100).optional(),
});
export type RerenderContentDto = z.infer<typeof rerenderContentSchema>;

/** Inline save of the narration script on the AI pipeline panel. */
export const updateScriptSchema = z
  .object({
    script: z.string().min(1).max(50000).optional(),
    /** Switch the active variant (explainer / styleB / styleC) without rewriting copy. */
    selectedScriptId: z.string().min(1).max(40).optional(),
  })
  .refine((d) => Boolean(d.script?.trim() || d.selectedScriptId?.trim()), {
    message: 'script or selectedScriptId is required',
  });
export type UpdateScriptDto = z.infer<typeof updateScriptSchema>;

/** Instruction-driven rewrite of the current narration script (preview; not saved until PATCH). */
export const rewriteScriptSchema = z.object({
  instruction: z.string().min(1).max(2000),
  /** Optional unsaved draft; otherwise the stored script is used. */
  script: z.string().min(1).max(50000).optional(),
});
export type RewriteScriptDto = z.infer<typeof rewriteScriptSchema>;
