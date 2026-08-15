import { describe, it, expect } from 'vitest';
import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { SessionUser } from '../session/session.types';

/** Build a minimal ExecutionContext carrying a request user. */
function ctxFor(user: SessionUser | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const owner: SessionUser = { id: '1', email: 'o@x.com', name: 'O', role: 'OWNER' };
const reviewer: SessionUser = { id: '2', email: 'r@x.com', name: 'R', role: 'REVIEWER' };

describe('RolesGuard', () => {
  it('allows any authenticated user when no @Roles is set', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctxFor(reviewer))).toBe(true);
  });

  it('skips RBAC on @Public routes even with class-level @Roles', () => {
    const reflector = {
      getAllAndOverride: (key: string) => {
        if (key === IS_PUBLIC_KEY) return true;
        if (key === ROLES_KEY) return ['OWNER', 'ADMIN', 'REVIEWER'];
        return undefined;
      },
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctxFor(undefined))).toBe(true);
  });

  it('allows a user whose role is in the required set', () => {
    const reflector = {
      getAllAndOverride: (key: string) => (key === ROLES_KEY ? ['OWNER', 'ADMIN'] : undefined),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(ctxFor(owner))).toBe(true);
  });

  it('rejects a user whose role is not in the required set', () => {
    const reflector = {
      getAllAndOverride: (key: string) => (key === ROLES_KEY ? ['OWNER', 'ADMIN'] : undefined),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(ctxFor(reviewer))).toThrow(ForbiddenException);
  });

  it('rejects when there is no authenticated user', () => {
    const reflector = {
      getAllAndOverride: (key: string) => (key === ROLES_KEY ? ['OWNER'] : undefined),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(ctxFor(undefined))).toThrow(ForbiddenException);
  });
});
