// Shared view types mirroring the API responses (apps/api). Kept minimal and
// local to the web app; a generated client can replace these in a later phase.

export type Role = 'OWNER' | 'ADMIN' | 'REVIEWER';
export const ROLES: Role[] = ['OWNER', 'ADMIN', 'REVIEWER'];

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  REVIEWER: 'Reviewer',
};

export const ROLE_HINTS: Record<Role, string> = {
  OWNER: 'Full access — all accounts and system settings',
  ADMIN: 'Manage accounts, users, and settings (not Owners)',
  REVIEWER: 'Full production on granted accounts (ideas, AI packages, settings, publish)',
};

export function isSystemAdmin(role: Role): boolean {
  return role === 'OWNER' || role === 'ADMIN';
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  role: Role;
}

export interface UserView extends SessionUser {
  status: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  lastLoginAt: string | null;
  createdAt: string;
  /** Granted SocialAccount ids (meaningful for REVIEWER). */
  accountIds: string[];
  /** OWNER/ADMIN see every account; grants are ignored for access checks. */
  allAccountsAccess: boolean;
}

export type AiKeyStatus = 'ACTIVE' | 'COOLDOWN' | 'EXHAUSTED' | 'DISABLED';

export interface AiKeyView {
  id: string;
  providerId: string;
  label: string;
  last4: string;
  priority: number;
  status: AiKeyStatus;
  cooldownUntil: string | null;
  createdAt: string;
}

export interface AiProviderView {
  id: string;
  name: string;
  kind: 'TEXT' | 'TTS' | 'MULTIMODAL';
  enabled: boolean;
  baseConfig: Record<string, unknown>;
  keys: AiKeyView[];
}

export interface SettingView {
  key: string;
  secret: boolean;
  configured: boolean;
  value?: unknown;
  /** For secret object settings: last-4 (or clear folder id) preview. */
  preview?: Record<string, string>;
}

export interface NotificationView {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  channels: string[];
  readAt: string | null;
  createdAt: string;
}
