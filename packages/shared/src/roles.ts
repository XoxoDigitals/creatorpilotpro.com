import { z } from 'zod';

/**
 * User roles — exactly three:
 * OWNER > ADMIN > REVIEWER (grant-scoped).
 */
export const Role = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  REVIEWER: 'REVIEWER',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const RoleSchema = z.enum(['OWNER', 'ADMIN', 'REVIEWER']);

/** Descending privilege order for simple hierarchy checks. */
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 100,
  ADMIN: 80,
  REVIEWER: 60,
};

/**
 * Roles that can see and operate on every SocialAccount without AccountAccess
 * grants. REVIEWER is grant-scoped (empty grants ⇒ no account access).
 */
export const GLOBAL_ACCOUNT_ACCESS_ROLES: readonly Role[] = [Role.OWNER, Role.ADMIN];

export function hasGlobalAccountAccess(role: Role): boolean {
  return (GLOBAL_ACCOUNT_ACCESS_ROLES as readonly string[]).includes(role);
}
