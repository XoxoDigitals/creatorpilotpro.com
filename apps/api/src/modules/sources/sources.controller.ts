import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SourcesService } from './sources.service';
import type { WatchedSourceView } from './watched-source.view';
import type { SourceVideoView } from './source-video.view';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { SessionUser } from '../../common/session/session.types';
import {
  bulkImportSchema,
  createSourceSchema,
  patchSourceSchema,
  setRightsSchema,
  type BulkImportDto,
  type CreateSourceDto,
  type PatchSourceDto,
  type SetRightsDto,
} from './dto/sources.dto';

/**
 * Sources module (docs/04 §1–3). Watched-source CRUD, bulk URL import, manual
 * "check now", source-video listing, and the rights-note gate. RBAC: OWNER/ADMIN
 * manage, REVIEWER reads (REVIEWER may also set rights notes as part of review).
 */
@ApiTags('sources')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller('sources')
export class SourcesController {
  constructor(private readonly sources: SourcesService) {}

  // --- Static routes before :id --------------------------------------------

  @Post('import')
  @Roles('OWNER', 'ADMIN')
  @Audit('source.import', 'WatchedSource')
  bulkImport(@Body(new ZodBody(bulkImportSchema)) body: BulkImportDto): Promise<WatchedSourceView> {
    return this.sources.bulkImport(body);
  }

  @Get('videos')
  listVideos(@Query('sourceId') sourceId?: string): Promise<SourceVideoView[]> {
    return this.sources.listVideos({ sourceId });
  }

  @Post('video/:id/retry-download')
  @Roles('OWNER', 'ADMIN')
  @Audit('source.video.retry_download', 'SourceVideo')
  retryDownload(@Param('id') id: string): Promise<SourceVideoView> {
    return this.sources.retryDownload(id);
  }

  @Patch('video/:id/rights')
  @Audit('source.video.rights', 'SourceVideo')
  setRights(
    @CurrentUser() actor: SessionUser,
    @Param('id') id: string,
    @Body(new ZodBody(setRightsSchema)) body: SetRightsDto,
  ): Promise<SourceVideoView> {
    return this.sources.setRights(id, body.rightsNote, actor.id);
  }

  // --- Watched-source CRUD --------------------------------------------------

  @Get()
  list(@Query('accountId') accountId?: string): Promise<WatchedSourceView[]> {
    return this.sources.list({ accountId });
  }

  @Post()
  @Roles('OWNER', 'ADMIN')
  @Audit('source.create', 'WatchedSource')
  create(@Body(new ZodBody(createSourceSchema)) body: CreateSourceDto): Promise<WatchedSourceView> {
    return this.sources.create(body);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<WatchedSourceView> {
    return this.sources.get(id);
  }

  @Patch(':id')
  @Roles('OWNER', 'ADMIN')
  @Audit('source.update', 'WatchedSource')
  patch(
    @Param('id') id: string,
    @Body(new ZodBody(patchSourceSchema)) body: PatchSourceDto,
  ): Promise<WatchedSourceView> {
    return this.sources.patch(id, body);
  }

  @Post(':id/check')
  @Roles('OWNER', 'ADMIN')
  @Audit('source.check', 'WatchedSource')
  checkNow(@Param('id') id: string): Promise<{ id: string; enqueued: true }> {
    return this.sources.checkNow(id);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @Audit('source.delete', 'WatchedSource')
  remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    return this.sources.softDelete(id);
  }
}
