import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { TelegramChannel } from './channels/telegram.channel';
import { SmtpChannel } from './channels/smtp.channel';
import { SystemModule } from '../system/system.module';

/**
 * Notifications (docs/03 Domain 7, docs/08 §3): in-app rows + Telegram + SMTP
 * fan-out. Imports SystemModule for encrypted channel settings.
 */
@Module({
  imports: [SystemModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, TelegramChannel, SmtpChannel],
  exports: [NotificationsService],
})
export class NotificationsModule {}
