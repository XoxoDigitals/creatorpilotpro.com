import { Injectable, Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import { SettingsService } from '../../system/settings.service';

interface SmtpConfig {
  url?: string;
  from?: string;
}

/**
 * SMTP email channel (nodemailer). Reads connection URL + from-address from
 * encrypted system settings ('notifications.smtp'); no-op if unset (docs/08 §3).
 */
@Injectable()
export class SmtpChannel {
  private readonly logger = new Logger(SmtpChannel.name);

  constructor(private readonly settings: SettingsService) {}

  async send(to: string, subject: string, text: string): Promise<boolean> {
    const cfg = await this.settings.getDecrypted<SmtpConfig>('notifications.smtp');
    if (!cfg?.url || !cfg?.from) return false; // not configured → no-op

    try {
      const transport = nodemailer.createTransport(cfg.url);
      await transport.sendMail({ from: cfg.from, to, subject, text });
      return true;
    } catch (err) {
      this.logger.warn(`SMTP send error: ${(err as Error).message}`);
      return false;
    }
  }
}
