import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CompetitorsService } from './competitors.service';
import type { CompetitorChannelView, CompetitorVideoPage } from './competitors.view';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  createCompetitorSchema,
  listCompetitorVideosQuerySchema,
  patchCompetitorSchema,
  type CreateCompetitorDto,
  type ListCompetitorVideosQuery,
  type PatchCompetitorDto,
} from './dto/competitors.dto';

/**
 * Competitors module (docs/04 Phase 4). Competitor-channel CRUD, manual poll
 * trigger, and fetched-video listing. Routes are nested under accounts for list
 * and create; single-resource routes use /competitors/:id.
 */
@ApiTags('competitors')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller()
export class CompetitorsController {
  constructor(private readonly competitors: CompetitorsService) {}

  @Get('accounts/:accountId/competitors')
  list(@Param('accountId') accountId: string): Promise<CompetitorChannelView[]> {
    return this.competitors.list(accountId);
  }

  @Post('accounts/:accountId/competitors')
  @Roles('OWNER', 'ADMIN')
  @Audit('competitor.create', 'CompetitorChannel')
  create(
    @Param('accountId') accountId: string,
    @Body(new ZodBody(createCompetitorSchema)) body: CreateCompetitorDto,
  ): Promise<CompetitorChannelView> {
    return this.competitors.create(accountId, body);
  }

  @Get('competitors/:id')
  get(@Param('id') id: string): Promise<CompetitorChannelView> {
    return this.competitors.get(id);
  }

  @Patch('competitors/:id')
  @Roles('OWNER', 'ADMIN')
  @Audit('competitor.update', 'CompetitorChannel')
  patch(
    @Param('id') id: string,
    @Body(new ZodBody(patchCompetitorSchema)) body: PatchCompetitorDto,
  ): Promise<CompetitorChannelView> {
    return this.competitors.patch(id, body);
  }

  @Delete('competitors/:id')
  @Roles('OWNER', 'ADMIN')
  @Audit('competitor.delete', 'CompetitorChannel')
  remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    return this.competitors.softDelete(id);
  }

  @Post('competitors/:id/check')
  @Roles('OWNER', 'ADMIN')
  @Audit('competitor.check', 'CompetitorChannel')
  checkNow(@Param('id') id: string): Promise<{ id: string; enqueued: true }> {
    return this.competitors.checkNow(id);
  }

  @Post('competitors/:id/analyze')
  @Roles('OWNER', 'ADMIN')
  @Audit('competitor.analyze', 'CompetitorChannel')
  analyzeNow(@Param('id') id: string): Promise<{ id: string; enqueued: true }> {
    return this.competitors.analyzeNow(id);
  }

  @Get('competitors/:id/videos')
  listVideos(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('page') page?: string,
    @Query('cursor') cursor?: string,
    @Query('sort') sort?: string,
  ): Promise<CompetitorVideoPage> {
    const parsed: ListCompetitorVideosQuery = listCompetitorVideosQuerySchema.parse({
      limit,
      offset,
      page,
      cursor,
      sort,
    });
    return this.competitors.listVideos(id, parsed);
  }
}
