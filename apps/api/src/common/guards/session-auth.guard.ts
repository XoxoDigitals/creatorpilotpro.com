import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { SESSION_COOKIE, type AuthedRequest } from '../session/session.types';
import { SessionService } from '../../modules/auth/session.service';

/**
 * Global guard: requires a valid signed session cookie by default. Routes
 * marked @Public() (health, login) are exempt (docs/08 §1). On success the
 * resolved SessionUser is attached to the request for @CurrentUser / RolesGuard.
 */
@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest & FastifyRequest>();
    const raw = req.cookies?.[SESSION_COOKIE];
    if (!raw) throw new UnauthorizedException('Not authenticated');

    // Verify the cookie signature (HMAC with SESSION_SECRET).
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) {
      throw new UnauthorizedException('Invalid session cookie');
    }

    const resolved = await this.sessions.resolve(unsigned.value);
    if (!resolved) throw new UnauthorizedException('Session expired');

    req.user = resolved.user;
    req.sessionId = resolved.sessionId;
    return true;
  }
}
