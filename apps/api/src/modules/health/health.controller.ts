import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { HealthService, HealthStatus } from './health.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public() // health probes must not require auth (docs/08 §1)
  @Get()
  @ApiOkResponse({ description: 'Liveness/readiness probe.' })
  check(): HealthStatus {
    return this.health.check();
  }
}
