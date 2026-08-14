import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { createReadStream } from 'node:fs';
import type { ContentItemStatus } from '@scp/db';
import { ContentService } from './content.service';
import type {
  AiPipelineItemView,
  ContentItemView,
  ReviewItemView,
} from './content.view';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  createContentSchema,
  rejectContentSchema,
  updatePublishMetadataSchema,
  updateScriptSchema,
  rewriteScriptSchema,
  rerenderContentSchema,
  type CreateContentDto,
  type RejectContentDto,
  type UpdatePublishMetadataDto,
  type UpdateScriptDto,
  type RewriteScriptDto,
  type RerenderContentDto,
} from './dto/content.dto';

/**
 * Content module (docs/03 Domain 4). Content items + the review queue. REVIEWER
 * can review/approve/reject and create on granted accounts; OWNER/ADMIN full access.
 */
@ApiTags('content')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller('content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Post()
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.create', 'ContentItem')
  create(@Body(new ZodBody(createContentSchema)) body: CreateContentDto): Promise<ContentItemView> {
    return this.content.create(body);
  }

  @Get()
  list(@Query('status') status?: string): Promise<ContentItemView[]> {
    return this.content.list(status as ContentItemStatus | undefined);
  }

  @Get('review')
  review(
    @Query('accountId') accountId?: string,
    @Query('excludeScheduled') excludeScheduled?: string,
  ): Promise<ReviewItemView[]> {
    return this.content.listReview(accountId, {
      excludeScheduled: excludeScheduled === '1' || excludeScheduled === 'true',
    });
  }

  @Get('ai-pipeline')
  aiPipeline(@Query('accountId') accountId?: string): Promise<AiPipelineItemView[]> {
    return this.content.listAiPipeline(accountId);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ContentItemView> {
    return this.content.get(id);
  }

  @Post(':id/approve')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.approve', 'ContentItem')
  approve(@Param('id') id: string): Promise<ContentItemView> {
    return this.content.approve(id);
  }

  @Post(':id/approve-script')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.approve_script', 'ContentItem')
  approveScript(@Param('id') id: string): Promise<ContentItemView> {
    return this.content.approveScript(id);
  }

  @Post(':id/reset-to-review')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.reset_to_review', 'ContentItem')
  resetToReview(@Param('id') id: string): Promise<ContentItemView> {
    return this.content.resetToReview(id);
  }

  @Post(':id/retry-ai')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.retry_ai', 'ContentItem')
  retryAi(@Param('id') id: string): Promise<ContentItemView> {
    return this.content.retryAiPipeline(id);
  }

  @Post(':id/regenerate-metadata')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.regenerate_metadata', 'ContentItem')
  regenerateMetadata(@Param('id') id: string): Promise<ContentItemView> {
    return this.content.regenerateMetadata(id);
  }

  @Post(':id/regenerate-script')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.regenerate_script', 'ContentItem')
  regenerateScript(@Param('id') id: string): Promise<ContentItemView> {
    return this.content.regenerateScript(id);
  }

  @Post(':id/regenerate-voiceover')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.regenerate_voiceover', 'ContentItem')
  regenerateVoiceover(@Param('id') id: string): Promise<ContentItemView> {
    return this.content.regenerateVoiceover(id);
  }

  @Post(':id/rerender')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.rerender', 'ContentItem')
  regenerateRender(
    @Param('id') id: string,
    @Body(new ZodBody(rerenderContentSchema)) body: RerenderContentDto,
  ): Promise<ContentItemView> {
    return this.content.regenerateRender(id, body);
  }

  @Delete(':id')
  @Roles('OWNER', 'ADMIN')
  @Audit('content.delete', 'ContentItem')
  remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    return this.content.softDelete(id);
  }

  @Patch(':id/publish-metadata')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.update_publish_metadata', 'ContentItem')
  updatePublishMetadata(
    @Param('id') id: string,
    @Body(new ZodBody(updatePublishMetadataSchema)) body: UpdatePublishMetadataDto,
  ): Promise<AiPipelineItemView> {
    return this.content.updatePublishMetadata(id, body);
  }

  @Patch(':id/script')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.update_script', 'ContentItem')
  updateScript(
    @Param('id') id: string,
    @Body(new ZodBody(updateScriptSchema)) body: UpdateScriptDto,
  ): Promise<AiPipelineItemView> {
    return this.content.updateScript(id, body);
  }

  @Post(':id/rewrite-script')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.rewrite_script', 'ContentItem')
  rewriteScript(
    @Param('id') id: string,
    @Body(new ZodBody(rewriteScriptSchema)) body: RewriteScriptDto,
  ): Promise<{ script: string }> {
    return this.content.rewriteScript(id, body);
  }

  @Post(':id/translate-title')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.translate_title', 'ContentItem')
  translateTitle(@Param('id') id: string) {
    return this.content.translateTitle(id);
  }

  /**
   * Stream the item's video (FINAL, or ORIGINAL as fallback) for inline playback.
   * `?kind=thumbnail` streams the stored thumbnail; `?kind=original` / `?kind=final`
   * pin a specific video asset (AI pipeline original vs rendered previews).
   *
   * When the asset lives only on Google Drive, redirect to the Drive preview
   * embed URL (iframe-friendly) instead of streaming from disk.
   */
  @Get(':id/media')
  async media(
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query('kind') kind?: string,
  ): Promise<StreamableFile | void> {
    const info = await this.resolveMedia(id, kind);
    if (!info) throw new NotFoundException('No playable asset for this item.');
    if (!info.path && info.embedUrl) {
      void reply.redirect(info.embedUrl, 302);
      return;
    }
    if (!info.path || info.bytes == null) {
      throw new NotFoundException('No playable asset for this item.');
    }
    void reply.header('content-type', info.mimeType);
    void reply.header('content-length', String(info.bytes));
    void reply.header('accept-ranges', 'bytes');
    return new StreamableFile(createReadStream(info.path));
  }

  /**
   * Resolve embed / stream URLs for UI players without downloading the file.
   * Prefer Drive preview when archived; otherwise same-origin media stream.
   */
  @Get(':id/media-info')
  async mediaInfo(
    @Param('id') id: string,
    @Query('kind') kind?: string,
  ): Promise<{
    mode: 'embed' | 'stream';
    embedUrl: string | null;
    streamUrl: string;
    mimeType: string;
  }> {
    const info = await this.resolveMedia(id, kind);
    if (!info) throw new NotFoundException('No playable asset for this item.');
    const streamUrl = mediaStreamPath(id, kind);
    if (info.embedUrl && !info.path) {
      return { mode: 'embed', embedUrl: info.embedUrl, streamUrl, mimeType: info.mimeType };
    }
    return {
      mode: 'stream',
      embedUrl: info.embedUrl ?? null,
      streamUrl,
      mimeType: info.mimeType,
    };
  }

  private resolveMedia(id: string, kind?: string) {
    const k = kind?.toUpperCase();
    if (k === 'THUMBNAIL') return this.content.getThumbnailAsset(id);
    if (k === 'ORIGINAL' || k === 'FINAL') return this.content.getPlayableAsset(id, k);
    return this.content.getPlayableAsset(id);
  }

  @Post(':id/reject')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.reject', 'ContentItem')
  reject(
    @Param('id') id: string,
    @Body(new ZodBody(rejectContentSchema)) body: RejectContentDto,
  ): Promise<ContentItemView> {
    return this.content.reject(id, body.reason);
  }

  // ── A/B suggestions (Phase 7 #10) ────────────────────────────────────────

  @Get(':id/suggestions')
  suggestions(@Param('id') id: string) {
    return this.content.listSuggestions(id);
  }

  @Post(':id/suggestions/generate')
  @Roles('OWNER', 'ADMIN')
  @Audit('content.suggestions_generate', 'ContentItem')
  generateSuggestions(@Param('id') id: string): Promise<{ enqueued: true }> {
    return this.content.generateSuggestions(id);
  }

  @Post('suggestions/:suggestionId/choose')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('content.suggestion_choose', 'PostSuggestion')
  chooseSuggestion(@Param('suggestionId') suggestionId: string) {
    return this.content.chooseSuggestion(suggestionId);
  }
}

function mediaStreamPath(id: string, kind?: string): string {
  const k = kind?.toLowerCase();
  const qs =
    k === 'thumbnail' || k === 'original' || k === 'final' ? `?kind=${k}` : '';
  return `/api/v1/content/${encodeURIComponent(id)}/media${qs}`;
}
