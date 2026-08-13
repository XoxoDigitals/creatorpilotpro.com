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
