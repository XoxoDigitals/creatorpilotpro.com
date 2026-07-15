import type { ChannelProfile, SocialAccount } from '@scp/db';

/**
 * Public (non-secret) API view of an account. NEVER includes `authPayload` or any
 * decrypted token (docs mission §SECURITY). The web `api-data.ts` maps this to
 * the `domain-types.ts` Account view (health/connection split, placeholder
 * metrics until Phase 6).
 */
export interface ChannelProfileView {
  masterPrompt: string;
  writingStyle: string;
  narrationStyle: string;
  language: string;
  voiceSettings: unknown;
  titleTemplate: string;
  descriptionTemplate: string;
  defaultTags: string[];
  aiLabelDefault: boolean;
  approvalPolicy: unknown;
  schedulingPrefs: unknown;
}

export interface AccountView {
  id: string;
  platform: SocialAccount['platform'];
  kind: SocialAccount['kind'];
  externalId: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  connectionStatus: SocialAccount['connectionStatus'];
  connectionMethod: SocialAccount['connectionMethod'];
  contentType: SocialAccount['contentType'];
  dramasEnabled: boolean;
  monetized: boolean;
  paused: boolean;
  timezone: string;
  tokenExpiresAt: string | null;
  createdAt: string;
  profile: ChannelProfileView | null;
}

export function toProfileView(p: ChannelProfile): ChannelProfileView {
  return {
    masterPrompt: p.masterPrompt,
    writingStyle: p.writingStyle,
    narrationStyle: p.narrationStyle,
    language: p.language,
    voiceSettings: p.voiceSettings,
    titleTemplate: p.titleTemplate,
    descriptionTemplate: p.descriptionTemplate,
    defaultTags: p.defaultTags,
    aiLabelDefault: p.aiLabelDefault,
    approvalPolicy: p.approvalPolicy,
    schedulingPrefs: p.schedulingPrefs,
  };
}

export function toAccountView(
  account: SocialAccount & { profile?: ChannelProfile | null },
): AccountView {
  return {
    id: account.id,
    platform: account.platform,
    kind: account.kind,
    externalId: account.externalId,
    name: account.name,
    handle: account.handle,
    avatarUrl: account.avatarUrl,
    connectionStatus: account.connectionStatus,
    connectionMethod: account.connectionMethod,
    contentType: account.contentType,
    dramasEnabled: account.dramasEnabled,
    monetized: account.monetized,
    paused: account.paused,
    timezone: account.timezone,
    tokenExpiresAt: account.tokenExpiresAt ? account.tokenExpiresAt.toISOString() : null,
    createdAt: account.createdAt.toISOString(),
    profile: account.profile ? toProfileView(account.profile) : null,
  };
}
