import { z } from 'zod';

/**
 * Add a reference / competitor YouTube channel.
 * Prefer `urlOrHandle` (URL, @handle, or UC… id); legacy `youtubeChannelId`+`name` still accepted.
 */
export const createCompetitorSchema = z
  .object({
    urlOrHandle: z.string().min(1).max(500).optional(),
    youtubeChannelId: z.string().min(1).max(200).optional(),
    name: z.string().min(1).max(200).optional(),
    role: z.enum(['COMPETITOR', 'SOURCE']).default('COMPETITOR'),
    checkIntervalMin: z.number().int().min(60).max(10_080).default(1440),
  })
  .refine((v) => !!(v.urlOrHandle || v.youtubeChannelId), {
    message: 'Provide urlOrHandle or youtubeChannelId.',
  })
  .refine((v) => !(v.youtubeChannelId && !v.urlOrHandle) || !!v.name, {
    message: 'name is required when using youtubeChannelId without urlOrHandle.',
  });
export type CreateCompetitorDto = z.infer<typeof createCompetitorSchema>;

/** Patch a competitor channel. At least one field must be provided. */
export const patchCompetitorSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    checkIntervalMin: z.number().int().min(60).max(10_080).optional(),
    status: z.enum(['ACTIVE', 'PAUSED']).optional(),
    role: z.enum(['COMPETITOR', 'SOURCE']).optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Provide at least one field to update.',
  });
export type PatchCompetitorDto = z.infer<typeof patchCompetitorSchema>;

/** Query params for paginated competitor video listing. */
export const listCompetitorVideosQuerySchema = z.object({
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return 20;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? n : 20;
    })
    .pipe(z.number().int().min(1).max(50)),
  offset: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return 0;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
    })
    .pipe(z.number().int().min(0)),
  /** 1-based page; when set (and no cursor), overrides offset as (page-1)*limit. */
  page: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === '') return undefined;
      const n = typeof v === 'number' ? v : Number(v);
      return Number.isFinite(n) ? Math.floor(n) : undefined;
    })
    .pipe(z.number().int().min(1).optional()),
  /** Opaque cursor (base64url of {o: nextOffset}); when set, overrides offset/page. */
  cursor: z.string().min(1).max(500).optional(),
  sort: z
    .enum(['newest', 'views'])
    .optional()
    .transform((v) => v ?? 'newest'),
});
export type ListCompetitorVideosQuery = z.infer<typeof listCompetitorVideosQuerySchema>;
