import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiService, type AiKeyView, type AiProviderView, type PromptVersionView } from './ai.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import {
  createKeySchema,
  createPromptVersionSchema,
  playgroundSchema,
  reorderKeySchema,
  setKeyStatusSchema,
  setPromptActiveSchema,
  setProviderEnabledSchema,
  usageStatsQuerySchema,
  ttsPreviewSchema,
  composeMasterPromptSchema,
  generateKidsRhymeSchema,
  type CreateKeyDto,
  type CreatePromptVersionDto,
  type PlaygroundDto,
  type ReorderKeyDto,
  type SetKeyStatusDto,
  type SetPromptActiveDto,
  type SetProviderEnabledDto,
  type TtsPreviewDto,
  type ComposeMasterPromptDto,
  type GenerateKidsRhymeDto,
} from './dto/ai.dto';

@ApiTags('ai')
@Roles('OWNER', 'ADMIN')
@Controller('ai')
export class AiController {
  constructor(private readonly ai: AiService) {}

  // ── Providers ───────────────────────────────────────────────────────────

  @Get('providers')
  listProviders(): Promise<AiProviderView[]> {
    return this.ai.listProviders();
  }

  @Patch('providers/:id')
  @Audit('ai_provider.set_enabled', 'AiProvider')
  setProviderEnabled(
    @Param('id') id: string,
    @Body(new ZodBody(setProviderEnabledSchema)) body: SetProviderEnabledDto,
  ): Promise<AiProviderView> {
    return this.ai.setProviderEnabled(id, body.enabled);
  }

  // ── Keys ────────────────────────────────────────────────────────────────

  @Post('providers/:id/keys')
  @Audit('ai_key.create', 'AiKey')
  createKey(
    @Param('id') providerId: string,
    @Body(new ZodBody(createKeySchema)) body: CreateKeyDto,
  ): Promise<AiKeyView> {
    return this.ai.createKey(providerId, body);
  }

  @Patch('keys/:id/status')
  @Audit('ai_key.set_status', 'AiKey')
  setKeyStatus(
    @Param('id') id: string,
    @Body(new ZodBody(setKeyStatusSchema)) body: SetKeyStatusDto,
  ): Promise<AiKeyView> {
    return this.ai.setKeyStatus(id, body.status);
  }

  @Patch('keys/:id/reorder')
  @Audit('ai_key.reorder', 'AiKey')
  reorderKey(
    @Param('id') id: string,
    @Body(new ZodBody(reorderKeySchema)) body: ReorderKeyDto,
  ): Promise<AiKeyView[]> {
    return this.ai.reorderKey(id, body.direction);
  }

  @Delete('keys/:id')
  @Audit('ai_key.delete', 'AiKey')
  deleteKey(@Param('id') id: string): Promise<{ id: string }> {
    return this.ai.deleteKey(id);
  }

  // ── Kill switches ─────────────────────────────────────────────────────

  @Get('kill-switches')
  getKillSwitches(): Promise<Record<string, boolean>> {
    return this.ai.getKillSwitches();
  }

  // ── Prompt versions ───────────────────────────────────────────────────

  @Get('prompts')
  listPrompts(
    @Query('task') task?: string,
    @Query('accountId') accountId?: string,
    @Query('activeOnly') activeOnly?: string,
  ): Promise<PromptVersionView[]> {
    return this.ai.listPromptVersions({
      task,
      accountId: accountId === 'null' ? null : accountId,
      activeOnly: activeOnly === 'true',
    });
  }

  @Post('prompts')
  @Audit('prompt_version.create', 'PromptVersion')
  createPrompt(
    @Body(new ZodBody(createPromptVersionSchema)) body: CreatePromptVersionDto,
  ): Promise<PromptVersionView> {
    return this.ai.createPromptVersion(body);
  }

  @Patch('prompts/:id/active')
  @Audit('prompt_version.set_active', 'PromptVersion')
  setPromptActive(
    @Param('id') id: string,
    @Body(new ZodBody(setPromptActiveSchema)) body: SetPromptActiveDto,
  ): Promise<PromptVersionView> {
    return this.ai.setPromptActive(id, body.isActive);
  }

  // ── Playground ────────────────────────────────────────────────────────

  @Post('playground')
  @Audit('ai.playground', 'AiPlayground')
  runPlayground(@Body(new ZodBody(playgroundSchema)) body: PlaygroundDto) {
    return this.ai.runPlayground(body);
  }

  @Post('compose-master-prompt')
  @Audit('ai.compose_master_prompt', 'AiComposeMasterPrompt')
  composeMasterPrompt(@Body(new ZodBody(composeMasterPromptSchema)) body: ComposeMasterPromptDto) {
    return this.ai.composeMasterPrompt(body);
  }

  @Post('analyze-visual-style')
  @Audit('ai.analyze_visual_style', 'AiVisualStyle')
  async analyzeVisualStyle(@Req() req: import('fastify').FastifyRequest): Promise<{ visualStyle: string }> {
    if (!req.isMultipart()) {
      throw new BadRequestException('Expected a multipart/form-data video upload.');
    }
    const data = await req.file();
    if (!data) throw new BadRequestException('No video file found in the upload.');
    const mime = (data.mimetype || '').toLowerCase();
    if (!mime.startsWith('video/')) {
      throw new BadRequestException('Upload a video file (mp4, webm, mov).');
    }
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'scp-style-'));
    const dest = join(dir, data.filename?.replace(/[^\w.\-]+/g, '_') || 'reference.mp4');
    try {
      await pipeline(data.file, createWriteStream(dest));
      if (data.file.truncated) {
        throw new BadRequestException('Upload was truncated. Use a smaller clip (under 80 MB).');
      }
      return await this.ai.analyzeVisualStyle({
        filePath: dest,
        mimeType: data.mimetype || 'video/mp4',
        filename: data.filename || 'reference.mp4',
      });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  // ── Usage stats ───────────────────────────────────────────────────────

  @Get('usage')
  getUsageStats(
    @Query('providerId') providerId?: string,
    @Query('since') since?: string,
    @Query('until') until?: string,
  ) {
    const parsed = usageStatsQuerySchema.parse({ providerId, since, until });
    return this.ai.getUsageStats(parsed);
  }

  // ── Edge Neural TTS voices ────────────────────────────────────────────

  @Get('tts/status')
  ttsStatus() {
    return this.ai.getTtsStatus();
  }

  @Get('tts/voices')
  listTtsVoices(@Query('locale') locale?: string, @Query('refresh') refresh?: string) {
    return this.ai.listTtsVoices({
      locale,
      forceRefresh: refresh === '1' || refresh === 'true',
    });
  }

  @Post('tts/preview')
  @Audit('ai.tts.preview', 'TtsPreview')
  previewTts(@Body(new ZodBody(ttsPreviewSchema)) body: TtsPreviewDto) {
    return this.ai.previewTts(body);
  }

  @Post('generate-kids-rhyme')
  @Audit('ai.generate_kids_rhyme', 'AiKidsRhyme')
  generateKidsRhyme(@Body(new ZodBody(generateKidsRhymeSchema)) body: GenerateKidsRhymeDto) {
    return this.ai.generateKidsRhyme(body);
  }
}
