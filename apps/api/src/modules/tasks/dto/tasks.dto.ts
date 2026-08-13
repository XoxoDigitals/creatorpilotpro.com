import { z } from 'zod';

export const createTaskSchema = z
  .object({
    briefId: z.string().cuid().optional(),
    episodeId: z.string().cuid().optional(),
    workerId: z.string().cuid(),
    accountId: z.string().cuid(),
    title: z.string().min(1).max(500),
  })
  .refine((d) => (d.briefId ? !d.episodeId : !!d.episodeId), {
    message: 'Exactly one of briefId or episodeId must be provided.',
  });
export type CreateTaskDto = z.infer<typeof createTaskSchema>;

export const assignTaskSchema = z.object({
  workerId: z.string().cuid(),
});
export type AssignTaskDto = z.infer<typeof assignTaskSchema>;

export const revisionSchema = z.object({
  note: z.string().min(1).max(2000),
});
export type RevisionDto = z.infer<typeof revisionSchema>;

export const taskListQuerySchema = z.object({
  status: z
    .enum(['ASSIGNED', 'IN_PROGRESS', 'UPLOADED', 'REVISION_REQUESTED', 'DONE'])
    .optional(),
  workerId: z.string().cuid().optional(),
  accountId: z.string().cuid().optional(),
});
export type TaskListQueryDto = z.infer<typeof taskListQuerySchema>;
