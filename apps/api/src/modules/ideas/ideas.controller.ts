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
import { createReadStream } from 'node:fs';
import type { FastifyReply } from 'fastify';
import { IdeasService, type IdeaGenerationStatusView } from './ideas.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import type { SessionUser } from '../../common/session/session.types';
import type { IdeaView } from './ideas.view';
import type { ProductionBriefView } from './ideas.view';
import type { ContentItemView } from '../content/content.view';
import {
  generateIdeasSchema,
  generatePackageSchema,
  patchIdeaSchema,
  rejectIdeaSchema,
  uploadIdeaVideoSchema,
  type GenerateIdeasDto,
  type GeneratePackageDto,
  type PatchIdeaDto,
  type RejectIdeaDto,
  type UploadIdeaVideoDto,
} from './dto/ideas.dto';

/**
 * Ideas module (docs/02 Section 3, Phase 4 + AI owner package flow).
 * Suggested → Review (approve) → Start Generation → AI package → upload video+thumb.
 */
@ApiTags('ideas')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller()
export class IdeasController {
  constructor(private readonly ideas: IdeasService) {}

  // --- Account-scoped routes -------------------------------------------------

  @Get('accounts/:accountId/ideas')
  list(
    @Param('accountId') accountId: string,
    @Query('status') status?: string,
  ): Promise<IdeaView[]> {
    return this.ideas.list(accountId, status);
  }

  @Post('accounts/:accountId/ideas/generate')
  @Roles('OWNER', 'ADMIN')
  @Audit('idea.generate', 'Idea')
  generate(
    @Param('accountId') accountId: string,
    @Body(new ZodBody(generateIdeasSchema)) body: GenerateIdeasDto,
  ): Promise<{ accountId: string; enqueued: true; count: number; runId: string }> {
    return this.ideas.generate(accountId, body);
  }

  @Get('accounts/:accountId/ideas/generation-status')
  generationStatus(
    @Param('accountId') accountId: string,
  ): Promise<IdeaGenerationStatusView> {
    return this.ideas.generationStatus(accountId);
  }

  // --- Idea-scoped routes ----------------------------------------------------

  @Get('ideas/:id')
  get(@Param('id') id: string): Promise<IdeaView> {
    return this.ideas.get(id);
  }

  @Patch('ideas/:id')
  @Roles('OWNER', 'ADMIN')
  @Audit('idea.update', 'Idea')
  patch(
    @Param('id') id: string,
    @Body(new ZodBody(patchIdeaSchema)) body: PatchIdeaDto,
  ): Promise<IdeaView> {
    return this.ideas.patch(id, body);
  }

  @Post('ideas/:id/approve')
  @Audit('idea.approve', 'Idea')
  approve(
    @CurrentUser() actor: SessionUser,
    @Param('id') id: string,
  ): Promise<IdeaView> {
    return this.ideas.approve(id, actor.id);
  }

  @Post('ideas/:id/reject')
  @Audit('idea.reject', 'Idea')
  reject(
    @CurrentUser() actor: SessionUser,
    @Param('id') id: string,
    @Body(new ZodBody(rejectIdeaSchema)) body: RejectIdeaDto,
  ): Promise<IdeaView> {
    return this.ideas.reject(id, actor.id, body.rejectionReason);
  }

  @Post('ideas/:id/package')
  @Roles('OWNER', 'ADMIN')
  @Audit('idea.package.generate', 'Idea')
  generatePackage(
    @Param('id') id: string,
    @Body(new ZodBody(generatePackageSchema)) body: GeneratePackageDto,
  ): Promise<IdeaView> {
    return this.ideas.generatePackage(id, body);
  }

  /** Resume a FAILED package from the failed stage only (keeps prior artifacts). */
  @Post('ideas/:id/package/retry')
  @Roles('OWNER', 'ADMIN')
  @Audit('idea.package.retry', 'Idea')
  retryPackage(@Param('id') id: string): Promise<IdeaView> {
    return this.ideas.retryPackage(id);
  }

  @Get('ideas/:id/package')
  getPackage(@Param('id') id: string): Promise<ProductionBriefView> {
    return this.ideas.getPackage(id);
  }

  @Get('ideas/:id/voiceover')
  async downloadVoiceover(
    @Param('id') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const info = await this.ideas.getVoiceoverDownload(id);
    if (!info) throw new NotFoundException('Voiceover not available for this idea.');
    void reply.header(
      'content-disposition',
      `attachment; filename="${this.ideas.voiceoverFilename(info.path)}"`,
    );
    void reply.header('content-type', info.mimeType);
    return new StreamableFile(createReadStream(info.path));
  }

  @Get('ideas/:id/transcript')
  async downloadTranscript(
    @Param('id') id: string,
    @Query('format') format: string | undefined,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    const fmt = format === 'vtt' ? 'vtt' : 'srt';
    const info = await this.ideas.getTranscriptDownload(id, fmt);
    if (!info) throw new NotFoundException('Transcript not available for this idea.');
    void reply.header('content-disposition', `attachment; filename="${info.filename}"`);
    void reply.header('content-type', info.mimeType);
    return new StreamableFile(createReadStream(info.path));
  }

  @Post('ideas/:id/package/done')
  @Roles('OWNER', 'ADMIN')
  @Audit('idea.package.done', 'Idea')
  markPackageDone(@Param('id') id: string): Promise<IdeaView> {
    return this.ideas.markPackageDone(id);
  }

  @Post('ideas/:id/upload')
  @Roles('OWNER', 'ADMIN')
  @Audit('idea.upload.create', 'Idea')
  createUpload(
    @Param('id') id: string,
    @Body(new ZodBody(uploadIdeaVideoSchema)) body: UploadIdeaVideoDto,
  ): Promise<ContentItemView & { ideaId: string }> {
    return this.ideas.createUploadContent(id, body);
  }

  @Post('ideas/:id/mark-uploaded')
  @Roles('OWNER', 'ADMIN')
  @Audit('idea.uploaded', 'Idea')
  markUploaded(@Param('id') id: string): Promise<IdeaView> {
    return this.ideas.markUploaded(id);
  }

  @Get('ideas/:id/brief')
  getBrief(@Param('id') id: string): Promise<ProductionBriefView> {
    return this.ideas.getBrief(id);
  }

  @Delete('ideas/:id')
  @Roles('OWNER', 'ADMIN')
  @Audit('idea.delete', 'Idea')
  remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    return this.ideas.softDelete(id);
  }
}
