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
  /** Channel default for idea/manual upload scheduling (override stays on Schedule page). */
  defaultScheduleMode: z.enum(['NOW', 'QUEUE_SLOT']).optional(),
  /** Sibling SocialAccount ids to always include as crosspost destinations. */
  defaultCrosspostAccountIds: z.array(z.string().min(1)).optional(),
  /** Default visibility for YouTube / TikTok / Facebook publishes. */
  defaultVisibility: z.enum(['PUBLIC', 'UNLISTED', 'PRIVATE']).optional(),
  /** YouTube category id (string) when publishing to YouTube. */
  defaultCategory: z.string().max(32).optional(),
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
    /** Structured brand questionnaire; see @scp/shared style-profile. */
    styleProfile: z.unknown().optional(),
    language: z.string().min(2).max(16).optional(),
    voiceSettings: z.record(z.string(), z.unknown()).optional(),
    titleTemplate: z.string().optional(),
    descriptionTemplate: z.string().optional(),
    thumbnailReferencePrompt: z.string().optional(),
    animationReferencePrompt: z.string().optional(),
    defaultTags: z.array(z.string()).optional(),
    aiLabelDefault: z.boolean().optional(),
    approvalPolicy: z.record(z.string(), z.unknown()).optional(),
    schedulingPrefs: schedulingPrefsSchema.optional(),
    /** Write-only OpenAI key for this channel (gpt-4o-mini-tts). Empty string clears. */
    openaiApiKey: z.string().max(4000).optional(),
  })
  .strict();
export type PatchProfileDto = z.infer<typeof patchProfileSchema>;

/**
 * POST /accounts/connect/manual — Phase 10. The Owner registers a channel/page
 * they will operate by hand: the pipeline still runs (ingest → AI → render →
 * metadata), the Owner downloads the final asset and uploads it themselves.
 * No OAuth handshake, no tokens stored.
 */
export const manualConnectSchema = z.object({
  platform: z.enum(PLATFORMS),
  name: z.string().min(1).max(120),
  handle: z.string().max(120).optional(),
  externalId: z.string().max(120).optional(),
  contentType: z.enum(CONTENT_TYPES).default('AI'),
  dramasEnabled: z.boolean().default(false),
  schedulingPrefs: schedulingPrefsSchema.optional(),
});
export type ManualConnectDto = z.infer<typeof manualConnectSchema>;

/**
 * POST /accounts/connect/meta — finish the page-picker step. Only the session
 * and chosen page id(s) travel here; wizard choices were carried through OAuth
 * into the pending session. Prefer `pageIds` (multi-select); `pageId` is kept
 * for older clients.
 */
export const metaConnectSchema = z
  .object({
    session: z.string().min(1),
    pageId: z.string().min(1).optional(),
    pageIds: z.array(z.string().min(1)).min(1).max(50).optional(),
    /** IANA timezone from the browser (e.g. America/Los_Angeles). */
    timezone: z.string().min(1).max(64).optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.pageIds?.length && !val.pageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Select at least one Facebook Page.',
        path: ['pageIds'],
      });
    }
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
