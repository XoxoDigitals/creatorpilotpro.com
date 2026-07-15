import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { IncidentStatus } from '@scp/db';
import { IncidentsService } from './incidents.service';
import type { IncidentView } from './incident.view';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { SessionUser } from '../../common/session/session.types';

/**
 * Incidents module (docs/03 Domain 7, docs/06 §4). Incident center: list, detail,
 * manual retry, ack, resolve. OWNER/ADMIN manage; REVIEWER reads.
 */
@ApiTags('incidents')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  list(@Query('status') status?: string): Promise<IncidentView[]> {
    const normalized = status && status !== 'ALL' ? (status as IncidentStatus) : undefined;
    return this.incidents.list(normalized);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<IncidentView> {
    return this.incidents.get(id);
  }

  @Post(':id/retry')
  @Roles('OWNER', 'ADMIN')
  @Audit('incident.retry', 'Incident')
  retry(@Param('id') id: string): Promise<IncidentView> {
    return this.incidents.retry(id);
  }

  @Post(':id/ack')
  @Roles('OWNER', 'ADMIN')
  @Audit('incident.ack', 'Incident')
  ack(@Param('id') id: string): Promise<IncidentView> {
    return this.incidents.ack(id);
  }

  @Post(':id/resolve')
  @Roles('OWNER', 'ADMIN')
  @Audit('incident.resolve', 'Incident')
  resolve(@Param('id') id: string, @CurrentUser() actor: SessionUser): Promise<IncidentView> {
    return this.incidents.resolve(id, actor.id);
  }
}
