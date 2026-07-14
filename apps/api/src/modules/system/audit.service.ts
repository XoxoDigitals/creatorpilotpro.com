import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditPage {
  items: Array<{
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    actor: { id: string; email: string } | null;
    ip: string | null;
    at: Date;
  }>;
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async list(page: number, pageSize: number): Promise<AuditPage> {
    const take = Math.min(Math.max(pageSize, 1), 100);
    const skip = Math.max(page - 1, 0) * take;

    const [rows, total] = await Promise.all([
      this.prisma.client.auditLog.findMany({
        orderBy: { at: 'desc' },
        skip,
        take,
        include: { user: { select: { id: true, email: true } } },
      }),
      this.prisma.client.auditLog.count(),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        actor: r.user ? { id: r.user.id, email: r.user.email } : null,
        ip: r.ip,
        at: r.at,
      })),
      total,
      page: Math.max(page, 1),
      pageSize: take,
    };
  }
}
