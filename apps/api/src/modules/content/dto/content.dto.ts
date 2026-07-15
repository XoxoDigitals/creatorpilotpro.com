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
