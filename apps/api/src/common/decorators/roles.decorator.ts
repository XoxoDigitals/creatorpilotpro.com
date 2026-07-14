import { SetMetadata } from '@nestjs/common';
import type { Role } from '@scp/db';

export const ROLES_KEY = 'scp:roles';

/**
 * Restricts a route to the listed roles (docs/08 §1 matrix). Enforced by
 * RolesGuard. Absence of this decorator means "any authenticated user".
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
