import { z } from 'zod';

/**
 * Zod schemas for the accounts module (docs/03 Domain 2, docs/11 §1).
 * These mirror the web `domain-types.ts` contract; the wizard sends the same
 * shapes through the connect endpoints.
 */

export const PLATFORMS = ['YOUTUBE', 'FACEBOOK', 'TIKTOK'] as const;
export const CONTENT_TYPES = ['AI', 'REPURPOSED', 'MIXED'] as const;

/** Scheduling preferences (docs/11 §1 wizard schedule step). */
export const schedulingPrefsSchema = z.object({
  cadence: z.enum(['PER_DAY', 'SPECIFIC_DAYS']),
  perDay: z.number().int().min(1).max(50).optional(),
  days: z.array(z.string()).optional(),
  times: z.array(z.string()).default([]),
  randomizeMinutes: z.number().int().min(0).max(720).optional(),
  maxPerDay: z.number().int().min(1).max(50).optional(),
  minGapMin: z.number().int().min(0).optional(),
});
export type SchedulingPrefs = z.infer<typeof schedulingPrefsSchema>;

/** PATCH /accounts/:id — operational toggles only (docs mission §2). */
export const patchAccountSchema = z
  .object({
    contentType: z.enum(CONTENT_TYPES).optional(),
    dramasEnabled: z.boolean().optional(),
    paused: z.boolean().optional(),
    timezone: z.string().min(1).max(64).optional(),
    monetized: z.boolean().optional(),
  })
  .strict();
export type PatchAccountDto = z.infer<typeof patchAccountSchema>;

/** PATCH /accounts/:id/profile — channel profile editor (FR-G). */
export const patchProfileSchema = z
  .object({
    masterPrompt: z.string().optional(),
    writingStyle: z.string().optional(),
    narrationStyle: z.string().optional(),
    language: z.string().min(2).max(16).optional(),
    voiceSettings: z.record(z.string(), z.unknown()).optional(),
    titleTemplate: z.string().optional(),
    descriptionTemplate: z.string().optional(),
    defaultTags: z.array(z.string()).optional(),
    aiLabelDefault: z.boolean().optional(),
    approvalPolicy: z.record(z.string(), z.unknown()).optional(),
    schedulingPrefs: schedulingPrefsSchema.optional(),
  })
  .strict();
export type PatchProfileDto = z.infer<typeof patchProfileSchema>;

/** POST /accounts/connect/postqued — import a PostQued integration. */
export const postquedConnectSchema = z.object({
  pqAccountId: z.string().min(1),
  platform: z.enum(PLATFORMS),
  contentType: z.enum(CONTENT_TYPES).default('AI'),
  dramasEnabled: z.boolean().default(false),
  schedulingPrefs: schedulingPrefsSchema.optional(),
});
export type PostquedConnectDto = z.infer<typeof postquedConnectSchema>;

/**
 * POST /accounts/connect/meta — finish the page-picker step. Only the session
 * and the chosen page travel here; the wizard choices (content type, dramas,
 * schedule) were carried through the OAuth state into the pending session and
 * are applied server-side.
 */
export const metaConnectSchema = z.object({
  session: z.string().min(1),
  pageId: z.string().min(1),
});
export type MetaConnectDto = z.infer<typeof metaConnectSchema>;

/**
 * Wizard choices carried through an OAuth round-trip. Serialized into the signed
 * `state` (Google) or transient session (Meta) so the created account inherits
 * the wizard's content-type / dramas / schedule selections.
 */
export const wizardChoicesSchema = z.object({
  contentType: z.enum(CONTENT_TYPES).default('AI'),
  dramasEnabled: z.coerce.boolean().default(false),
  schedulingPrefs: schedulingPrefsSchema.optional(),
});
export type WizardChoices = z.infer<typeof wizardChoicesSchema>;

/** Parse a `schedulingPrefs` value that may arrive as a JSON string (query param). */
export function parseWizardQuery(raw: {
  contentType?: string;
  dramasEnabled?: string;
  schedulingPrefs?: string;
}): WizardChoices {
  let schedulingPrefs: unknown;
  if (raw.schedulingPrefs) {
    try {
      schedulingPrefs = JSON.parse(raw.schedulingPrefs);
    } catch {
      schedulingPrefs = undefined;
    }
  }
  return wizardChoicesSchema.parse({
    contentType: raw.contentType,
    dramasEnabled: raw.dramasEnabled,
    schedulingPrefs,
  });
}
