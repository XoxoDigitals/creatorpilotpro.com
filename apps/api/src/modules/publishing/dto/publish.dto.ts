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
    /** Re-queue a DRAFT/FAILED target for publish. */
    retry: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.scheduledAt !== undefined ||
      v.cancel !== undefined ||
      v.publishNow === true ||
      v.retry === true,
    { message: 'Provide scheduledAt, cancel, publishNow, or retry.' },
  );
export type PatchTargetDto = z.infer<typeof patchTargetSchema>;

/** Remove a publish target from our system and/or from the platform. */
export const removeTargetSchema = z
  .object({
    /** Soft-delete the content item in CreatorPilot (default true). */
    deleteFromSystem: z.boolean().default(true),
    /** Also DELETE the video on Facebook/YouTube/TikTok when still published. */
    deleteFromPlatform: z.boolean().default(false),
  })
  .refine((v) => v.deleteFromSystem || v.deleteFromPlatform, {
    message: 'Choose deleteFromSystem and/or deleteFromPlatform.',
  });
export type RemoveTargetDto = z.infer<typeof removeTargetSchema>;
