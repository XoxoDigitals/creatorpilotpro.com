import { SetMetadata } from '@nestjs/common';

export const AUDIT_KEY = 'scp:audit';

export interface AuditMeta {
  /** Logical action name, e.g. "user.create", "ai_key.create". */
  action: string;
  /** Entity type recorded in audit_log, e.g. "User", "AiKey". */
  entityType: string;
}

/**
 * Marks a mutating handler for audit logging (docs/08 §3). The AuditInterceptor
 * records actor + action + entityType/Id on success. Secret values are redacted.
 */
export const Audit = (action: string, entityType: string) =>
  SetMetadata(AUDIT_KEY, { action, entityType } satisfies AuditMeta);
