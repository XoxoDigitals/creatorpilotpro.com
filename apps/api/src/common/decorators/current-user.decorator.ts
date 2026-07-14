import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { AuthedRequest, SessionUser } from '../session/session.types';

/** Injects the authenticated SessionUser (set by SessionAuthGuard). */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): SessionUser | undefined => {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    return req.user;
  },
);
