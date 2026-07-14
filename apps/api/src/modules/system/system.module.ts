import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { SettingsService } from './settings.service';
import { AuditService } from './audit.service';

/** System settings + audit log (docs/03 Domain 8, docs/08 §3). */
@Module({
  controllers: [SystemController],
  providers: [SettingsService, AuditService],
  exports: [SettingsService],
})
export class SystemModule {}
