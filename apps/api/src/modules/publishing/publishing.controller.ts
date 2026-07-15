import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PublishingService } from './publishing.service';
import type { PublishTargetView } from './publish-target.view';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  createPublishSchema,
  patchTargetSchema,
  type CreatePublishDto,
  type PatchTargetDto,
} from './dto/publish.dto';

/**
 * Publishing module (docs/06 §4–5). Creates publish targets (cross-posting) and
 * exposes the calendar read side. OWNER/ADMIN manage; REVIEWER reads.
 */
@ApiTags('publishing')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller('publish')
export class PublishingController {
  constructor(private readonly publishing: PublishingService) {}

  @Post()
  @Roles('OWNER', 'ADMIN')
  @Audit('publish.create', 'PublishTarget')
  create(@Body(new ZodBody(createPublishSchema)) body: CreatePublishDto): Promise<PublishTargetView[]> {
    return this.publishing.createTargets(body);
  }

  @Get('targets')
  listTargets(
    @Query('accountId') accountId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<PublishTargetView[]> {
    return this.publishing.listTargets({ accountId, from, to });
  }

  @Get('target/:id')
  getTarget(@Param('id') id: string): Promise<PublishTargetView> {
    return this.publishing.getTarget(id);
  }

  @Patch('target/:id')
  @Roles('OWNER', 'ADMIN')
  @Audit('publish.target.update', 'PublishTarget')
  patchTarget(
    @Param('id') id: string,
    @Body(new ZodBody(patchTargetSchema)) body: PatchTargetDto,
  ): Promise<PublishTargetView> {
    return this.publishing.patchTarget(id, body);
  }
}
