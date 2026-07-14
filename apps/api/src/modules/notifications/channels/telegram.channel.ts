import { Injectable, Logger } from '@nestjs/common';
import { SettingsService } from '../../system/settings.service';

interface TelegramConfig {
  botToken?: string;
  chatId?: string;
}

/**
 * Telegram bot channel (docs/08 §3, notifications). Reads bot token + chat id
 * from encrypted system settings ('notifications.telegram'); no-op if unset.
 */
@Injectable()
export class TelegramChannel {
  private readonly logger = new Logger(TelegramChannel.name);

  constructor(private readonly settings: SettingsService) {}

  async send(text: string): Promise<boolean> {
    const cfg = await this.settings.getDecrypted<TelegramConfig>('notifications.telegram');
    if (!cfg?.botToken || !cfg?.chatId) return false; // not configured → no-op

    try {
      const res = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: cfg.chatId, text }),
      });
      if (!res.ok) {
        this.logger.warn(`Telegram send failed: ${res.status}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Telegram send error: ${(err as Error).message}`);
      return false;
    }
  }
}
