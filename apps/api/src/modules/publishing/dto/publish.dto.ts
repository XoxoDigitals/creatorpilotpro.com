import { z } from 'zod';

export const createPublishSchema = z.object({
  contentItemId: z.string().min(1),
  targets: z
    .array(
      z.object({
        accountId: z.string().min(1),
        scheduleMode: z.enum(['NOW', 'FIXED', 'QUEUE_SLOT', 'RANDOM_WINDOW']).default('QUEUE_SLOT'),
        scheduledAt: z.string().datetime().optional(),
        metadataOverride: z.record(z.string(), z.unknown()).optional(),
      }),
    )
    .min(1),
});
export type CreatePublishDto = z.infer<typeof createPublishSchema>;

export const patchTargetSchema = z
  .object({
    scheduledAt: z.string().datetime().optional(),
    cancel: z.boolean().optional(),
    /** Force immediate publish (sets NOW + scheduledAt=now and enqueues when ready). */
    publishNow: z.boolean().optional(),
  })
  .refine(
    (v) => v.scheduledAt !== undefined || v.cancel !== undefined || v.publishNow === true,
    { message: 'Provide scheduledAt, cancel, or publishNow.' },
  );
export type PatchTargetDto = z.infer<typeof patchTargetSchema>;
