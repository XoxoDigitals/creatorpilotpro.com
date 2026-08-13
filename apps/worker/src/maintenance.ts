/**
 * Maintenance queue processor (docs/06 §4, docs mission §2): refresh Google
 * OAuth tokens that are < 10 minutes from expiry; on refresh failure mark the
 * account BROKEN and notify Owners/Admins.
 *
 * Note (Phase 1a deviation): the `incidents` table (Domain 7) is not migrated
 * yet, so failures raise a notification only; the incident record lands with the
 * publish engine (Phase 1b).
 */
import { getPrisma, type PrismaClient } from '@scp/db';
import { decryptSecret, encryptSecret, loadMasterKey } from '@scp/shared/crypto';

const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const EXPIRY_WINDOW_MS = 10 * 60 * 1000;

interface GoogleAuthPayload {
  provider?: string;
  accessToken?: string;
  refreshToken?: string | null;
  scope?: string;
  tokenType?: string;
  expiryDate?: number;
}

function getEnc(value: unknown): string | null {
  if (typeof value === 'object' && value && '__enc' in value) {
    const v = (value as { __enc?: unknown }).__enc;
    return typeof v === 'string' ? v : null;
  }
  return null;
}

async function loadGoogleAppConfig(
  prisma: PrismaClient,
  masterKey: Buffer,
): Promise<{ clientId: string; clientSecret: string } | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: 'platform_apps.google' } });
  const enc = getEnc(row?.value);
  if (!enc) return null;
  try {
    const cfg = JSON.parse(decryptSecret(enc, masterKey)) as {
      clientId?: string;
      clientSecret?: string;
    };
    if (!cfg.clientId || !cfg.clientSecret) return null;
    return { clientId: cfg.clientId, clientSecret: cfg.clientSecret };
  } catch {
    return null;
  }
}

async function notifyBroken(prisma: PrismaClient, accountName: string, accountId: string): Promise<void> {
  const recipients = await prisma.user.findMany({
    where: { role: { in: ['OWNER', 'ADMIN'] }, status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  if (recipients.length === 0) return;
  await prisma.notification.createMany({
    data: recipients.map((u) => ({
      userId: u.id,
      type: 'account.connection.broken',
      payload: {
        title: `Reconnect ${accountName}`,
        message: 'Google token refresh failed; the account is disconnected. Re-authorize it.',
        accountId,
      },
      channels: ['INAPP'] as const,
    })),
  });
}

export async function refreshExpiringGoogleTokens(): Promise<{ checked: number; refreshed: number; broken: number }> {
  const masterKeyRaw = process.env.MASTER_KEY;
  if (!masterKeyRaw) return { checked: 0, refreshed: 0, broken: 0 };
  const masterKey = loadMasterKey(masterKeyRaw);
  const prisma = getPrisma();

  const threshold = new Date(Date.now() + EXPIRY_WINDOW_MS);
  const accounts = await prisma.socialAccount.findMany({
    where: {
      platform: 'YOUTUBE',
      connectionMethod: 'OWN_APP',
      deletedAt: null,
      connectionStatus: { not: 'BROKEN' },
      tokenExpiresAt: { not: null, lte: threshold },
    },
  });
  if (accounts.length === 0) return { checked: 0, refreshed: 0, broken: 0 };

  const appConfig = await loadGoogleAppConfig(prisma, masterKey);

  let refreshed = 0;
  let broken = 0;
  for (const account of accounts) {
    const markBroken = async (): Promise<void> => {
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: { connectionStatus: 'BROKEN', paused: true },
      });
      await notifyBroken(prisma, account.name, account.id);
      broken += 1;
    };

    if (!appConfig || !account.authPayload) {
      await markBroken();
      continue;
    }

    let payload: GoogleAuthPayload;
    try {
      payload = JSON.parse(decryptSecret(account.authPayload, masterKey)) as GoogleAuthPayload;
    } catch {
      await markBroken();
      continue;
    }
    if (!payload.refreshToken) {
      await markBroken();
      continue;
    }

    try {
      const res = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: appConfig.clientId,
          client_secret: appConfig.clientSecret,
          refresh_token: payload.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });
      if (!res.ok) {
        await markBroken();
        continue;
      }
      const t = (await res.json()) as { access_token: string; scope?: string; token_type?: string; expires_in: number };
      const expiryDate = Date.now() + t.expires_in * 1000;
      const next: GoogleAuthPayload = {
        provider: 'google',
        accessToken: t.access_token,
        refreshToken: payload.refreshToken,
        scope: t.scope ?? payload.scope,
        tokenType: t.token_type ?? payload.tokenType,
        expiryDate,
      };
      await prisma.socialAccount.update({
        where: { id: account.id },
        data: {
          authPayload: encryptSecret(JSON.stringify(next), masterKey),
          tokenExpiresAt: new Date(expiryDate),
          connectionStatus: 'HEALTHY',
        },
      });
      refreshed += 1;
    } catch {
      await markBroken();
    }
  }

  return { checked: accounts.length, refreshed, broken };
}
