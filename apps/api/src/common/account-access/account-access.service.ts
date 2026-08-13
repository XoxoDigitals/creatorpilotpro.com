import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hasGlobalAccountAccess } from '@scp/shared';
import { PrismaService } from '../../prisma/prisma.service';
import type { SessionUser } from '../session/session.types';

/**
 * Per-account ACL for grant-scoped REVIEWER users.
 * OWNER and ADMIN always have unrestricted SocialAccount access.
 */
@Injectable()
export class AccountAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** True when the role bypasses AccountAccess grants entirely. */
  isUnrestricted(role: SessionUser['role']): boolean {
    return hasGlobalAccountAccess(role);
  }

  /**
   * Account ids the user may see/operate on.
   * `null` means unrestricted (OWNER/ADMIN) — callers should skip id filters.
   */
  async accessibleAccountIds(user: SessionUser): Promise<string[] | null> {
    if (this.isUnrestricted(user.role)) return null;
    const rows = await this.prisma.client.accountAccess.findMany({
      where: { userId: user.id },
      select: { accountId: true },
    });
    return rows.map((r) => r.accountId);
  }

  /** Prisma `where.id` fragment: unrestricted → undefined; else `{ in: [...] }`. */
  async accountIdFilter(
    user: SessionUser,
  ): Promise<{ in: string[] } | undefined> {
    const ids = await this.accessibleAccountIds(user);
    if (ids === null) return undefined;
    return { in: ids };
  }

  async canAccess(user: SessionUser, accountId: string): Promise<boolean> {
    if (this.isUnrestricted(user.role)) return true;
    const grant = await this.prisma.client.accountAccess.findUnique({
      where: { userId_accountId: { userId: user.id, accountId } },
      select: { id: true },
    });
    return Boolean(grant);
  }

  async assertCanAccess(user: SessionUser, accountId: string): Promise<void> {
    if (await this.canAccess(user, accountId)) return;
    // Distinguish missing account vs denied grant without leaking existence to
    // grant-scoped users who aren't allowed to see it.
    const exists = await this.prisma.client.socialAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Account not found');
    throw new ForbiddenException('You do not have access to this account');
  }

  async listAccountIdsForUser(userId: string): Promise<string[]> {
    const rows = await this.prisma.client.accountAccess.findMany({
      where: { userId },
      select: { accountId: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.accountId);
  }

  /**
   * Replace the full grant set for a user. Invalid / soft-deleted account ids
   * are rejected. Empty array clears all grants.
   */
  async replaceGrants(userId: string, accountIds: string[]): Promise<string[]> {
    const unique = [...new Set(accountIds)];
    if (unique.length > 0) {
      const found = await this.prisma.client.socialAccount.findMany({
        where: { id: { in: unique }, deletedAt: null },
        select: { id: true },
      });
      if (found.length !== unique.length) {
        throw new NotFoundException('One or more accounts were not found');
      }
    }

    await this.prisma.client.$transaction(async (tx) => {
      await tx.accountAccess.deleteMany({ where: { userId } });
      if (unique.length > 0) {
        await tx.accountAccess.createMany({
          data: unique.map((accountId) => ({ userId, accountId })),
        });
      }
    });

    return unique;
  }
}
