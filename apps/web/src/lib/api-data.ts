'use client';

/**
 * Real API accessors for accounts (Phase 1a), satisfying the same `domain-types`
 * contract the mock layer does. DEMO MODE (docs mission §4): when `demo_mode` is
 * on AND there are zero real accounts, the mock data is served so the designed
 * UI stays populated; as soon as a real account is connected, the mock vanishes.
 */
import { api, ApiError } from './api';
import { getAccounts as mockAccounts, getAccount as mockAccount } from './mock-data';
import type {
  Account,
  ConnectionMethod,
  ContentType,
  HealthStatus,
  ConnectionStatus,
  Platform,
} from './domain-types';

/** Shape returned by GET /accounts (see apps/api account.view.ts). Never carries secrets. */
export interface ApiChannelProfile {
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

export interface ApiAccount {
  id: string;
  platform: Platform;
  kind: string;
  externalId: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
  connectionStatus: 'HEALTHY' | 'EXPIRING' | 'BROKEN';
  connectionMethod: ConnectionMethod;
  contentType: ContentType;
  dramasEnabled: boolean;
  monetized: boolean;
  paused: boolean;
  timezone: string;
  tokenExpiresAt: string | null;
  createdAt: string;
  profile: ApiChannelProfile | null;
}

const HEALTH: Record<ApiAccount['connectionStatus'], HealthStatus> = {
  HEALTHY: 'HEALTHY',
  EXPIRING: 'WARNING',
  BROKEN: 'CRITICAL',
};
const CONNECTION: Record<ApiAccount['connectionStatus'], ConnectionStatus> = {
  HEALTHY: 'CONNECTED',
  EXPIRING: 'EXPIRING',
  BROKEN: 'DISCONNECTED',
};

/** Map an API account to the UI `Account` view. Metrics are 0/placeholder until Phase 6. */
export function mapAccount(a: ApiAccount): Account {
  return {
    id: a.id,
    name: a.name,
    handle: a.handle ?? '',
    platform: a.platform,
    contentType: a.contentType,
    connectionMethod: a.connectionMethod,
    dramasEnabled: a.dramasEnabled,
    avatarUrl: a.avatarUrl,
    health: HEALTH[a.connectionStatus],
    connection: CONNECTION[a.connectionStatus],
    tokenExpiresAt: a.tokenExpiresAt,
    followers: 0,
    views30d: 0,
    scheduledCount: 0,
    openIncidents: 0,
    monetized: a.monetized,
    paused: a.paused,
    createdAt: a.createdAt,
  };
}

export async function getDemoMode(): Promise<boolean> {
  try {
    const { enabled } = await api.get<{ enabled: boolean }>('/system/demo-mode');
    return enabled;
  } catch {
    return true; // default ON (docs mission §4)
  }
}

async function fetchRealAccounts(): Promise<ApiAccount[]> {
  return api.get<ApiAccount[]>('/accounts');
}

export interface AccountsResult {
  accounts: Account[];
  /** True when the returned list is mock data (demo mode active). */
  demo: boolean;
}

export async function getAccountsView(): Promise<AccountsResult> {
  const real = await fetchRealAccounts();
  if (real.length > 0) return { accounts: real.map(mapAccount), demo: false };
  if (await getDemoMode()) return { accounts: mockAccounts(), demo: true };
  return { accounts: [], demo: false };
}

/** Raw API account (for the settings tab which needs the profile), or null. */
export async function getApiAccount(id: string): Promise<ApiAccount | null> {
  try {
    return await api.get<ApiAccount>(`/accounts/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export interface AccountResult {
  account: Account | null;
  demo: boolean;
}

export async function getAccountView(id: string): Promise<AccountResult> {
  const real = await fetchRealAccounts();
  const found = real.find((a) => a.id === id);
  if (found) return { account: mapAccount(found), demo: false };
  if (real.length === 0 && (await getDemoMode())) {
    const m = mockAccount(id);
    return { account: m ?? null, demo: Boolean(m) };
  }
  return { account: null, demo: false };
}
