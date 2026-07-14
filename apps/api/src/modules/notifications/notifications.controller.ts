import { Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationsService, type NotificationView } from './notifications.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/session/session.types';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser): Promise<NotificationView[]> {
    return this.notifications.listForUser(user.id);
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: SessionUser): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(user.id) };
  }

  @Patch(':id/read')
  markRead(@CurrentUser() user: SessionUser, @Param('id') id: string): Promise<NotificationView> {
    return this.notifications.markRead(user.id, id);
  }
}
