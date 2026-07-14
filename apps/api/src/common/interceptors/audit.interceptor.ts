import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AUDIT_KEY, type AuditMeta } from '../decorators/audit.decorator';
import type { AuthedRequest } from '../session/session.types';
import { PrismaService } from '../../prisma/prisma.service';

/** Field names whose values must never be written to the audit log. */
const SECRET_FIELDS = new Set([
  'password',
  'tempPassword',
  'newPassword',
  'key',
  'apiKey',
  'secret',
  'token',
  'keyEnc',
  'value', // system_settings values may hold secrets; store keys only
]);

/** Recursively redact secret-looking fields from a payload snapshot. */
function redact(input: unknown): unknown {
  if (Array.isArray(input)) return input.map(redact);
  if (input && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = SECRET_FIELDS.has(k) ? '[redacted]' : redact(v);
    }
    return out;
  }
  return input;
}

/**
 * Records mutations to audit_log (docs/08 §3): actor, action, entityType/Id,
 * and a redacted "after" snapshot. Only handlers annotated with @Audit(...) are
 * logged, keeping it cheap and intentional. Failures never break the request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const meta = this.reflector.get<AuditMeta | undefined>(AUDIT_KEY, ctx.getHandler());
    if (!meta) return next.handle();

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const actorId = req.user?.id ?? null;
    const ip = req.ip ?? null;
    const reqBody = redact(req.body ?? {});

    return next.handle().pipe(
      tap((result) => {
        const after = redact(result) as Record<string, unknown> | undefined;
        const entityId =
          (after && typeof after === 'object' && 'id' in after
            ? String((after as Record<string, unknown>).id)
            : undefined) ?? extractParamId(req);

        void this.prisma.client.auditLog
          .create({
            data: {
              userId: actorId,
              action: meta.action,
              entityType: meta.entityType,
              entityId: entityId ?? null,
              before: reqBody as object,
              after: (after ?? null) as object,
              ip,
            },
          })
          .catch(() => {
            /* audit must never break the request */
          });
      }),
    );
  }
}

function extractParamId(req: AuthedRequest): string | undefined {
  const params = (req as unknown as { params?: Record<string, string> }).params;
  return params?.id;
}
