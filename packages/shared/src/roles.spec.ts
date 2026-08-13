import { describe, expect, it } from 'vitest';
import { hasGlobalAccountAccess, GLOBAL_ACCOUNT_ACCESS_ROLES, Role } from './roles.js';

describe('hasGlobalAccountAccess', () => {
  it('grants OWNER and ADMIN unrestricted account access', () => {
    expect(hasGlobalAccountAccess(Role.OWNER)).toBe(true);
    expect(hasGlobalAccountAccess(Role.ADMIN)).toBe(true);
    expect(GLOBAL_ACCOUNT_ACCESS_ROLES).toEqual([Role.OWNER, Role.ADMIN]);
  });

  it('scopes REVIEWER to grants', () => {
    expect(hasGlobalAccountAccess(Role.REVIEWER)).toBe(false);
  });
});
