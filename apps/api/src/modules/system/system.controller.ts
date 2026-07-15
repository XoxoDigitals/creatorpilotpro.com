import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettingsService, type SettingView } from './settings.service';
import { AuditService, type AuditPage } from './audit.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

@ApiTags('system')
@Roles('OWNER', 'ADMIN') // docs/08 §1: system settings + audit view are Owner/Admin
@Controller('system')
export class SystemController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  @Get('settings')
  listSettings(): Promise<SettingView[]> {
    return this.settings.list();
  }

  // Readable by any authenticated user (the accounts UI needs it to decide the
  // demo-data fallback), unlike the Owner/Admin-only settings above.
  @Get('demo-mode')
  @Roles('OWNER', 'ADMIN', 'REVIEWER', 'WORKER', 'ANALYST')
  demoMode(): Promise<{ enabled: boolean }> {
    return this.settings.getDemoMode();
  }

  @Put('settings/:key')
  @Audit('system.setting.update', 'SystemSetting')
  putSetting(@Param('key') key: string, @Body('value') value: unknown): Promise<SettingView> {
    return this.settings.put(key, value);
  }

  @Get('audit')
  listAudit(@Query('page') page = '1', @Query('pageSize') pageSize = '25'): Promise<AuditPage> {
    return this.audit.list(Number(page) || 1, Number(pageSize) || 25);
  }
}
