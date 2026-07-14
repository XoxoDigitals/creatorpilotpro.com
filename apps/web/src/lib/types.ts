// Shared view types mirroring the API responses (apps/api). Kept minimal and
// local to the web app; a generated client can replace these in a later phase.

export type Role = 'OWNER' | 'ADMIN' | 'REVIEWER' | 'WORKER' | 'ANALYST';
export const ROLES: Role[] = ['OWNER', 'ADMIN', 'REVIEWER', 'WORKER', 'ANALYST'];

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
}

export interface NotificationView {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  channels: string[];
  readAt: string | null;
  createdAt: string;
}
