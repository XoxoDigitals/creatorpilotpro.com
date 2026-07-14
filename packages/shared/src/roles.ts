import { z } from 'zod';

/**
 * User roles (docs/01 §4, docs/03 Domain 1).
 * OWNER > ADMIN > REVIEWER > WORKER, plus optional read-only ANALYST.
 */
export const Role = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  REVIEWER: 'REVIEWER',
  WORKER: 'WORKER',
  ANALYST: 'ANALYST',
} as const;

export type Role = (typeof Role)[keyof typeof Role];

export const RoleSchema = z.enum(['OWNER', 'ADMIN', 'REVIEWER', 'WORKER', 'ANALYST']);

/** Descending privilege order for simple hierarchy checks. */
export const ROLE_RANK: Record<Role, number> = {
  OWNER: 100,
  ADMIN: 80,
  REVIEWER: 60,
  WORKER: 40,
  ANALYST: 20,
};
