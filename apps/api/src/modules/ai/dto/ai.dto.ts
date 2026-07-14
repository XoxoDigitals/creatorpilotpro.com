import { z } from 'zod';

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
