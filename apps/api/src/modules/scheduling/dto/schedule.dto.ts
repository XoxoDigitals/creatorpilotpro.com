import { z } from 'zod';

const timeWindowSchema = z.object({
  start: z.string(),
  end: z.string(),
  randomize: z.boolean().optional(),
});

export const createSlotSchema = z.object({
  accountId: z.string().min(1),
  rule: z.record(z.string(), z.unknown()).default({}),
  timeWindows: z.array(timeWindowSchema).default([]),
  active: z.boolean().default(true),
});
export type CreateSlotDto = z.infer<typeof createSlotSchema>;

export const patchSlotSchema = z.object({
  rule: z.record(z.string(), z.unknown()).optional(),
  timeWindows: z.array(timeWindowSchema).optional(),
  active: z.boolean().optional(),
});
export type PatchSlotDto = z.infer<typeof patchSlotSchema>;
