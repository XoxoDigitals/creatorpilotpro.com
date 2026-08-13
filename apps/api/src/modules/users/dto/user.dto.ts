import { z } from 'zod';
import { RoleSchema } from '@scp/shared';

export const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120).optional(),
  role: RoleSchema,
  tempPassword: z.string().min(8).max(200),
  /** Optional initial AccountAccess grants (ignored for OWNER/ADMIN semantics in UI). */
  accountIds: z.array(z.string().min(1)).max(500).optional(),
});
export type CreateUserDto = z.infer<typeof createUserSchema>;

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(8).max(200),
});
export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

export const changeRoleSchema = z.object({
  role: RoleSchema,
});
export type ChangeRoleDto = z.infer<typeof changeRoleSchema>;

export const setUserAccountsSchema = z.object({
  accountIds: z.array(z.string().min(1)).max(500),
});
export type SetUserAccountsDto = z.infer<typeof setUserAccountsSchema>;
