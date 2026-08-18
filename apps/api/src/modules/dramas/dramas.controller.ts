import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DramasService } from './dramas.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  createSeriesSchema,
  patchSeriesSchema,
  type CreateSeriesDto,
  type PatchSeriesDto,
} from './dto/dramas.dto';
import type { DramaSeriesView, DramaSeriesDetailView, DramaEpisodeView } from './dramas.view';

/**
 * Dramas controller (Phase 4). Drama series CRUD, bible regeneration, episode
 * listing and on-demand generation. RBAC: OWNER/ADMIN manage, REVIEWER reads.
 */
@ApiTags('dramas')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller()
export class DramasController {
  constructor(private readonly dramas: DramasService) {}

  // --- Series CRUD (account-scoped) ------------------------------------------

  @Get('accounts/:accountId/dramas')
  list(@Param('accountId') accountId: string): Promise<DramaSeriesView[]> {
    return this.dramas.list(accountId);
  }

  @Post('accounts/:accountId/dramas')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('drama.create', 'DramaSeries')
  create(
    @Param('accountId') accountId: string,
    @Body(new ZodBody(createSeriesSchema)) body: CreateSeriesDto,
  ): Promise<DramaSeriesView> {
    return this.dramas.create(accountId, body);
  }

  // --- Series detail ---------------------------------------------------------

  @Get('dramas/:id')
  get(@Param('id') id: string): Promise<DramaSeriesDetailView> {
    return this.dramas.get(id);
  }

  @Patch('dramas/:id')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('drama.update', 'DramaSeries')
  patch(
    @Param('id') id: string,
    @Body(new ZodBody(patchSeriesSchema)) body: PatchSeriesDto,
  ): Promise<DramaSeriesView> {
    return this.dramas.patch(id, body);
  }

  @Delete('dramas/:id')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('drama.delete', 'DramaSeries')
  remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    return this.dramas.softDelete(id);
  }

  @Post('dramas/:id/regenerate-bible')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('drama.regenerate', 'DramaSeries')
  regenerateBible(@Param('id') id: string): Promise<DramaSeriesView> {
    return this.dramas.regenerateBible(id);
  }

  // --- Episodes --------------------------------------------------------------

  @Get('dramas/:id/episodes')
  listEpisodes(@Param('id') id: string): Promise<DramaEpisodeView[]> {
    return this.dramas.listEpisodes(id);
  }

  @Get('dramas/:id/episodes/:number')
  getEpisode(
    @Param('id') id: string,
    @Param('number') number: string,
  ): Promise<DramaEpisodeView> {
    return this.dramas.getEpisode(id, parseInt(number, 10));
  }

  @Post('dramas/:id/episodes/:number/generate')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('drama.episode.generate', 'DramaEpisode')
  generateEpisode(
    @Param('id') id: string,
    @Param('number') number: string,
  ): Promise<DramaEpisodeView> {
    return this.dramas.generateEpisode(id, parseInt(number, 10));
  }
}
