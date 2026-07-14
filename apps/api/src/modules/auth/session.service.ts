import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import type { SessionUser } from '../../common/session/session.types';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface CreatedSession {
  token: string;
  expires: Date;
}

export interface ResolvedSession {
  sessionId: string;
  user: SessionUser;
}

/**
 * DB-backed session store (docs/03 Domain 1 `sessions`). Tokens are opaque
 * 256-bit random values; the cookie carrying them is additionally HMAC-signed
 * (SESSION_SECRET) at the transport layer.
 */
@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string): Promise<CreatedSession> {
    const token = randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_TTL_MS);
    await this.prisma.client.session.create({
      data: { sessionToken: token, userId, expires },
    });
    return { token, expires };
  }

  /** Resolve a session token to its user, or null if missing/expired/disabled. */
  async resolve(token: string): Promise<ResolvedSession | null> {
    const session = await this.prisma.client.session.findUnique({
      where: { sessionToken: token },
      include: { user: true },
    });
    if (!session) return null;

    if (session.expires.getTime() <= Date.now()) {
      await this.prisma.client.session.deleteMany({ where: { sessionToken: token } });
      return null;
    }

    const u = session.user;
    // A disabled/deleted user's live sessions must stop working immediately.
    if (u.deletedAt || u.status === 'SUSPENDED') return null;

    return {
      sessionId: session.id,
      user: { id: u.id, email: u.email, name: u.name, role: u.role },
    };
  }

  async destroy(token: string): Promise<void> {
    await this.prisma.client.session.deleteMany({ where: { sessionToken: token } });
  }

  /** Revoke every session for a user (used on disable / password reset). */
  async destroyAllForUser(userId: string): Promise<void> {
    await this.prisma.client.session.deleteMany({ where: { userId } });
  }
}
