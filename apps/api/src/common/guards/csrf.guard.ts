import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection via strict Origin/Referer checking (docs/08 §2).
 *
 * Rationale (documented): our session cookie is SameSite=Lax, which already
 * blocks cross-site POST from being auto-sent by browsers. As defence-in-depth,
 * every state-changing request (POST/PUT/PATCH/DELETE) that carries a browser
 * Origin/Referer header must match an allowed dashboard origin. Requests with
 * NO Origin/Referer (non-browser clients: curl, worker scripts, API tokens) are
 * allowed through — browsers always send Origin on cross-origin mutations, so a
 * forged cross-site request cannot omit it. This keeps the check simple and
 * Fastify-friendly while remaining effective against browser-driven CSRF.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(config: ConfigService) {
    this.allowed = new Set(config.get<string[]>('corsOrigins') ?? []);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = (req.headers.origin as string | undefined) ?? undefined;
    const referer = (req.headers.referer as string | undefined) ?? undefined;

    // No browser-supplied origin ⇒ non-browser client ⇒ not a CSRF vector.
    const source = origin ?? (referer ? safeOrigin(referer) : undefined);
    if (!source) return true;

    if (!this.allowed.has(source)) {
      throw new ForbiddenException('Cross-origin request blocked (CSRF)');
    }
    return true;
  }
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
