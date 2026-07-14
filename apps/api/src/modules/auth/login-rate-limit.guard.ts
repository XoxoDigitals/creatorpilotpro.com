import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

const WINDOW_MS = 60_000; // 1 minute
const MAX_ATTEMPTS = 5; // per IP per window (docs/08 §2: rate-limited login)

/**
 * In-memory sliding-window login throttle (5/min/IP). Sufficient for Phase 0 /
 * single-node; Phase 1 can move this to a shared store if we scale out the API.
 */
@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const ip = req.ip || 'unknown';
    const now = Date.now();

    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS) {
      throw new HttpException(
        'Too many login attempts. Try again shortly.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    recent.push(now);
    this.hits.set(ip, recent);
    return true;
  }
}
