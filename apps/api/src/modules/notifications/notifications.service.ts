import { Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationChannel, Prisma } from '@scp/db';
import { PrismaService } from '../../prisma/prisma.service';
import { TelegramChannel } from './channels/telegram.channel';
import { SmtpChannel } from './channels/smtp.channel';

export interface CreateNotificationInput {
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  channels?: NotificationChannel[];
}

export interface NotificationView {
  id: string;
  type: string;
  payload: Prisma.JsonValue;
  channels: NotificationChannel[];
  readAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramChannel,
    private readonly smtp: SmtpChannel,
  ) {}

  /**
   * Create a notification. Always writes the in-app row; additionally fans out
   * to Telegram / SMTP when those channels are requested and configured (each
   * is a no-op when its secrets are unset). External sends never block/fail the
   * DB write.
   */
  async create(input: CreateNotificationInput): Promise<NotificationView> {
    const channels = input.channels ?? ['INAPP'];
    const row = await this.prisma.client.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        payload: input.payload as Prisma.InputJsonValue,
        channels,
      },
    });

    const text = this.render(input.type, input.payload);
    if (channels.includes('TELEGRAM')) void this.telegram.send(text);
    if (channels.includes('EMAIL')) {
      const user = await this.prisma.client.user.findUnique({ where: { id: input.userId } });
      if (user) void this.smtp.send(user.email, `[SCP] ${input.type}`, text);
    }

    return this.toView(row);
  }

  async listForUser(userId: string): Promise<NotificationView[]> {
    const rows = await this.prisma.client.notification.findMany({
      where: { userId },
      orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return rows.map((r) => this.toView(r));
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.client.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<NotificationView> {
    const existing = await this.prisma.client.notification.findFirst({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Notification not found');
    const row = await this.prisma.client.notification.update({
      where: { id },
      data: { readAt: existing.readAt ?? new Date() },
    });
    return this.toView(row);
  }

  private render(type: string, payload: Record<string, unknown>): string {
    const title = typeof payload.title === 'string' ? payload.title : type;
    const message = typeof payload.message === 'string' ? payload.message : '';
    return message ? `${title}\n${message}` : title;
  }

  private toView(r: {
    id: string;
    type: string;
    payload: Prisma.JsonValue;
    channels: NotificationChannel[];
    readAt: Date | null;
    createdAt: Date;
  }): NotificationView {
    return {
      id: r.id,
      type: r.type,
      payload: r.payload,
      channels: r.channels,
      readAt: r.readAt,
      createdAt: r.createdAt,
    };
  }
}
