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
  Req,
  Res,
  StreamableFile,
  BadRequestException,
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
  regeneratePackageSchema,
  rejectIdeaSchema,
  uploadIdeaVideoSchema,
  createRhymePackageSchema,
  type GenerateIdeasDto,
  type GeneratePackageDto,
  type PatchIdeaDto,
  type RegeneratePackageDto,
  type RejectIdeaDto,
  type UploadIdeaVideoDto,
  type CreateRhymePackageDto,
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
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('idea.generate', 'Idea')
  generate(
    @Param('accountId') accountId: string,
    @Body(new ZodBody(generateIdeasSchema)) body: GenerateIdeasDto,
  ): Promise<{ accountId: string; enqueued: true; count: number; runId: string }> {
    return this.ideas.generate(accountId, body);
  }

  @Post('accounts/:accountId/ideas/rhyme')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('idea.rhyme.create', 'Idea')
  createRhymePackage(
    @Param('accountId') accountId: string,
    @Body(new ZodBody(createRhymePackageSchema)) body: CreateRhymePackageDto,
  ): Promise<IdeaView> {
    return this.ideas.createRhymePackage(accountId, body);
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
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
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
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('idea.package.generate', 'Idea')
  generatePackage(
    @Param('id') id: string,
    @Body(new ZodBody(generatePackageSchema)) body: GeneratePackageDto,
  ): Promise<IdeaView> {
    return this.ideas.generatePackage(id, body);
  }

  /** Resume a FAILED package from the failed stage only (keeps prior artifacts). */
  @Post('ideas/:id/package/retry')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('idea.package.retry', 'Idea')
  retryPackage(@Param('id') id: string): Promise<IdeaView> {
    return this.ideas.retryPackage(id);
  }

  @Post('ideas/:id/package/regenerate')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('idea.package.regenerate', 'Idea')
  regeneratePackage(
    @Param('id') id: string,
    @Body(new ZodBody(regeneratePackageSchema)) body: RegeneratePackageDto,
  ): Promise<IdeaView> {
    return this.ideas.regeneratePackageStage(id, body.stage);
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

  @Post('ideas/:id/voiceover')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('idea.voiceover.upload', 'Idea')
  async uploadVoiceover(
    @Param('id') id: string,
    @Req() req: import('fastify').FastifyRequest,
  ): Promise<IdeaView> {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected a multipart/form-data audio upload.');
    }
    const data = await req.file();
    if (!data) throw new BadRequestException('No audio file found in the upload.');
    const mime = (data.mimetype || '').toLowerCase();
    if (!mime.startsWith('audio/') && !mime.startsWith('video/')) {
      throw new BadRequestException('Upload an audio file (mp3, wav, m4a) of the sung rhyme.');
    }
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'scp-vo-'));
    const dest = join(dir, data.filename?.replace(/[^\w.\-]+/g, '_') || 'owner-voice.mp3');
    try {
      await pipeline(data.file, createWriteStream(dest));
      if (data.file.truncated) {
        throw new BadRequestException('Upload was truncated. Use a smaller audio file (under 80 MB).');
      }
      return await this.ideas.saveOwnerVoiceover(id, {
        filePath: dest,
        mimeType: data.mimetype || 'audio/mpeg',
        filename: data.filename || 'owner-voice.mp3',
      });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
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
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('idea.package.done', 'Idea')
  markPackageDone(@Param('id') id: string): Promise<IdeaView> {
    return this.ideas.markPackageDone(id);
  }

  @Post('ideas/:id/upload')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('idea.upload.create', 'Idea')
  createUpload(
    @Param('id') id: string,
    @Body(new ZodBody(uploadIdeaVideoSchema)) body: UploadIdeaVideoDto,
  ): Promise<ContentItemView & { ideaId: string }> {
    return this.ideas.createUploadContent(id, body);
  }

  @Post('ideas/:id/mark-uploaded')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('idea.uploaded', 'Idea')
  markUploaded(@Param('id') id: string): Promise<IdeaView> {
    return this.ideas.markUploaded(id);
  }

  @Get('ideas/:id/brief')
  getBrief(@Param('id') id: string): Promise<ProductionBriefView> {
    return this.ideas.getBrief(id);
  }

  @Delete('ideas/:id')
  @Roles('OWNER', 'ADMIN', 'REVIEWER')
  @Audit('idea.delete', 'Idea')
  remove(@Param('id') id: string): Promise<{ id: string; deleted: true }> {
    return this.ideas.softDelete(id);
  }
}
