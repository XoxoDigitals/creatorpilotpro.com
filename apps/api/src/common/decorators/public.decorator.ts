import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'scp:isPublic';

/**
 * Marks a route as public — bypasses the global SessionAuthGuard.
 * Used for health checks and login (docs/08 §1: only these are unauthenticated).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
