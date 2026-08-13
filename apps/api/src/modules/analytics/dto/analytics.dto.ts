import { z } from 'zod';

export const dateRangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type DateRangeDto = z.infer<typeof dateRangeSchema>;

export function parseDateRange(from?: string, to?: string): { from: Date; to: Date } {
  const now = new Date();
  const toDate = to ? new Date(to + 'T23:59:59.999Z') : now;
  const fromDate = from
    ? new Date(from + 'T00:00:00.000Z')
    : new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from: fromDate, to: toDate };
}
