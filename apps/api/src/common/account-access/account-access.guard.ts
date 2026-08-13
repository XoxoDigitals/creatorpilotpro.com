import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AccountAccessService } from './account-access.service';
import type { AuthedRequest } from '../session/session.types';

/**
 * Enforces AccountAccess grants whenever a request targets a specific account.
 *
 * Resolves account id from (in order):
 * 1. `params.accountId` (e.g. `/accounts/:accountId/ideas`)
 * 2. `params.id` on the AccountsController (`/accounts/:id`, `/accounts/:id/profile`)
 * 3. `query.accountId` when present (scoped list/filter endpoints)
 *
 * OWNER/ADMIN always pass. Unauthenticated/public routes skip (no user).
 */
@Injectable()
export class AccountAccessGuard implements CanActivate {
  constructor(private readonly access: AccountAccessService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const user = req.user;
    if (!user) return true;
    if (this.access.isUnrestricted(user.role)) return true;

    const accountId = this.resolveAccountId(ctx, req);
    if (!accountId) return true;

    await this.access.assertCanAccess(user, accountId);
    return true;
  }

  private resolveAccountId(ctx: ExecutionContext, req: AuthedRequest): string | undefined {
    const params = req.params as Record<string, string | undefined> | undefined;
    if (params?.accountId) return params.accountId;

    // AccountsController uses `:id` for the SocialAccount primary key.
    const controller = ctx.getClass();
    if (controller?.name === 'AccountsController' && params?.id) {
      return params.id;
    }

    const query = req.query as Record<string, unknown> | undefined;
    const q = query?.accountId;
    if (typeof q === 'string' && q.length > 0) return q;

    return undefined;
  }
}
