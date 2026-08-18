import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { basename } from 'node:path';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueProducer } from '../../common/queue/queue.producer';
import { toIdeaView, toBriefView, pendingBriefView, type IdeaView, type ProductionBriefView } from './ideas.view';
import type {
  GenerateIdeasDto,
  GeneratePackageDto,
  PatchIdeaDto,
  UploadIdeaVideoDto,
  CreateRhymePackageDto,
} from './dto/ideas.dto';
import type { ContentItemView } from '../content/content.view';
import { toContentItemView } from '../content/content.view';
import { parseStyleProfile, isKidsRhymePackage } from '@scp/shared';
import { resolvePackageResumeStage } from './package-resume';
import { AiService } from '../ai/ai.service';

const GENERATION_STALE_MS = 5 * 60 * 1000;

export interface IdeaGenerationStatusView {
  runId: string | null;
  status: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';
  createdAt: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
}

const IDEA_LIST_INCLUDE = {
  brief: {
    select: {
      id: true,
      voiceoverStatus: true,
      voiceoverLocalPath: true,
      packageStage: true,
      packageStageError: true,
    },
  },
  contentItems: {
    where: { deletedAt: null },
    orderBy: { createdAt: 'desc' as const },
    select: {
      id: true,
      status: true,
      assets: {
        where: { kind: { in: ['FINAL', 'THUMBNAIL'] as Array<'FINAL' | 'THUMBNAIL'> } },
        select: { kind: true, localPath: true, driveFileId: true },
      },
      publishTargets: {
        orderBy: { createdAt: 'desc' as const },
        select: { status: true, scheduledAt: true, publishedAt: true },
      },
    },
  },
};

@Injectable()
export class IdeasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueProducer,
    private readonly ai: AiService,
  ) {}

  private async assertAccount(accountId: string): Promise<void> {
    const account = await this.prisma.client.socialAccount.findFirst({
      where: { id: accountId, deletedAt: null },
      select: { id: true },
    });
    if (!account) throw new NotFoundException(`Account ${accountId} not found.`);
  }

  private async findIdeaOrThrow(id: string) {
    const idea = await this.prisma.client.idea.findFirst({
      where: { id, deletedAt: null },
      include: IDEA_LIST_INCLUDE,
    });
    if (!idea) throw new NotFoundException('Idea not found.');
    return idea;
  }

  private assertSuggested(idea: { status: string }): void {
    if (idea.status !== 'SUGGESTED') {
      throw new BadRequestException(
        `Idea is ${idea.status}; only SUGGESTED ideas can be modified.`,
      );
    }
  }

  /**
   * An idea is "active in AI" until both final video and thumbnail are uploaded
   * (or it reaches UPLOADED/PUBLISHED). Blocks starting the next package.
   */
  private async findBlockingActiveIdea(
    accountId: string,
    excludeIdeaId?: string,
  ): Promise<{ id: string; title: string } | null> {
    const candidates = await this.prisma.client.idea.findMany({
      where: {
        accountId,
        deletedAt: null,
        ...(excludeIdeaId ? { id: { not: excludeIdeaId } } : {}),
        OR: [
          { packageStatus: { in: ['GENERATING', 'READY', 'DONE'] } },
          { status: 'IN_PRODUCTION' },
        ],
        status: { notIn: ['UPLOADED', 'PUBLISHED', 'REJECTED'] },
      },
      include: {
        contentItems: {
          where: { deletedAt: null },
          select: {
            assets: {
              where: { kind: { in: ['FINAL', 'THUMBNAIL'] as Array<'FINAL' | 'THUMBNAIL'> } },
              select: { kind: true, localPath: true, driveFileId: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    for (const idea of candidates) {
      const assets = idea.contentItems.flatMap((c) => c.assets);
      const hasVideo = assets.some((a) => a.kind === 'FINAL' && !!(a.localPath || a.driveFileId));
      const hasThumb = assets.some((a) => a.kind === 'THUMBNAIL' && !!(a.localPath || a.driveFileId));
      if (!(hasVideo && hasThumb)) {
        return { id: idea.id, title: idea.title };
      }
    }
    return null;
  }

  async list(accountId: string, status?: string): Promise<IdeaView[]> {
    const ideas = await this.prisma.client.idea.findMany({
      where: {
        accountId,
        deletedAt: null,
        ...(status ? { status: status as any } : {}),
      },
      include: IDEA_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    return ideas.map(toIdeaView);
  }

  async get(id: string): Promise<IdeaView> {
    const idea = await this.prisma.client.idea.findFirst({
      where: { id, deletedAt: null },
      include: IDEA_LIST_INCLUDE,
    });
    if (!idea) throw new NotFoundException('Idea not found.');
    return toIdeaView(idea);
  }

  async generate(
    accountId: string,
    dto?: GenerateIdeasDto,
  ): Promise<{ accountId: string; enqueued: true; count: number; runId: string }> {
    await this.assertAccount(accountId);
    const exactTopic = dto?.exactTopic === true && Boolean(dto?.topicSeed);
    const count = exactTopic ? 1 : (dto?.count ?? 50);
    const topicSeed = dto?.topicSeed;
    const staleBefore = new Date(Date.now() - GENERATION_STALE_MS);
    const active = await this.prisma.client.jobRun.findFirst({
      where: {
        entityId: accountId,
        jobName: 'idea_generation',
        status: { in: ['WAITING', 'ACTIVE'] },
        createdAt: { gte: staleBefore },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (active) {
      return { accountId, enqueued: true, count, runId: active.id };
    }

    await this.prisma.client.jobRun.updateMany({
      where: {
        entityId: accountId,
        jobName: 'idea_generation',
        status: { in: ['WAITING', 'ACTIVE'] },
        createdAt: { lt: staleBefore },
      },
      data: {
        status: 'FAILED',
        finishedAt: new Date(),
        error: { message: 'Idea generation timed out before completion.' },
      },
    });

    const run = await this.prisma.client.jobRun.create({
      data: {
        queue: 'ai',
        jobName: 'idea_generation',
        entityId: accountId,
        status: 'WAITING',
      },
    });
    try {
      await this.queue.enqueueIdeaGeneration(accountId, count, run.id, topicSeed, exactTopic);
    } catch (error) {
      await this.prisma.client.jobRun.update({
        where: { id: run.id },
        data: {
          status: 'FAILED',
          finishedAt: new Date(),
          error: { message: error instanceof Error ? error.message : String(error) },
        },
      });
      throw error;
    }
    return { accountId, enqueued: true, count, runId: run.id };
  }

  /**
   * Kids rhyme package: generate or store lyrics, then wait for the owner to
   * upload the sung voice. Transcript + visual prompts run after that upload.
   */
  async createRhymePackage(accountId: string, dto: CreateRhymePackageDto): Promise<IdeaView> {
    await this.assertAccount(accountId);
    const blocker = await this.findBlockingActiveIdea(accountId);
    if (blocker) {
      throw new BadRequestException(
        `Finish the current AI idea first — upload final video and thumbnail for "${blocker.title}" before starting another rhyme.`,
      );
    }
    const profile = await this.prisma.client.channelProfile.findUnique({
      where: { accountId },
      select: { language: true, styleProfile: true },
    });
    const language = profile?.language ?? 'en';
    const niche = parseStyleProfile(profile?.styleProfile).answers.niche;
    const durationSec = dto.videoDurationSec ?? 60;
    const clipDurationSec = dto.clipDurationSec ?? 10;
    const pasted = dto.rhyme?.trim() ?? '';
    let title: string;
    let rhyme: string;
    let hook: string;
    let topicSummary: string;
    if (pasted) {
      rhyme = pasted;
      const firstLine = pasted.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? 'Kids rhyme';
      title = (dto.topic?.trim() || firstLine).slice(0, 120);
      hook = pasted
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(' / ')
        .slice(0, 400);
      topicSummary = dto.topic?.trim() || 'Owner-provided kids nursery rhyme.';
    } else {
      const generated = await this.ai.generateKidsRhyme({
        topic: dto.topic,
        language,
        durationSec,
        niche,
      });
      title = generated.title.slice(0, 120);
      rhyme = generated.rhyme;
      hook = generated.hook.slice(0, 400);
      topicSummary = generated.topicSummary;
    }

    const idea = await this.prisma.client.idea.create({
      data: {
        accountId,
        title,
        angle: 'Kids nursery rhyme',
        hook,
        topicSummary,
        status: 'IN_PRODUCTION',
        packageStatus: 'GENERATING',
        requestedVideoDurationSec: durationSec,
        requestedClipDurationSec: clipDurationSec,
      },
    });
    await this.prisma.client.productionBrief.create({
      data: {
        ideaId: idea.id,
        researchSummary: topicSummary,
        script: rhyme,
        videoTitle: title,
        videoDescription: '',
        packageStage: 'SCRIPT',
        voiceoverStatus: 'NONE',
        targetDurationSec: durationSec,
      },
    });
    return this.get(idea.id);
  }

  async saveOwnerVoiceover(
    id: string,
    opts: { filePath: string; mimeType: string; filename: string },
  ): Promise<IdeaView> {
    const idea = await this.findIdeaOrThrow(id);
    if (!idea.brief) {
      throw new BadRequestException('Generate the rhyme/script before uploading a voice.');
    }
    const root = process.env.STORAGE_ROOT?.trim();
    if (!root) throw new BadRequestException('STORAGE_ROOT is not configured on the API host.');
    const { mkdir, copyFile, unlink } = await import('node:fs/promises');
    const { extname, join } = await import('node:path');
    const ext = (() => {
      const fromName = extname(opts.filename).toLowerCase();
      if (['.wav', '.mp3', '.m4a', '.aac', '.ogg', '.webm', '.flac'].includes(fromName)) return fromName;
      const mime = (opts.mimeType || '').toLowerCase();
      if (mime.includes('wav')) return '.wav';
      if (mime.includes('mpeg') || mime.includes('mp3')) return '.mp3';
      if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) return '.m4a';
      if (mime.includes('ogg')) return '.ogg';
      if (mime.includes('webm')) return '.webm';
      return '.wav';
    })();
    const dir = join(root, 'ideas', id, 'tts');
    await mkdir(dir, { recursive: true });
    const dest = join(dir, `owner-voice${ext}`);
    await copyFile(opts.filePath, dest);
    await unlink(opts.filePath).catch(() => undefined);

    await this.prisma.client.productionBrief.update({
      where: { ideaId: id },
      data: {
        voiceoverStatus: 'READY',
        voiceoverLocalPath: dest,
        voiceIdUsed: 'owner:upload',
        packageStage: 'VOICE',
        packageStageError: null,
        timedTranscript: [],
      },
    });
    await this.prisma.client.idea.update({
      where: { id },
      data: { packageStatus: 'GENERATING', status: 'IN_PRODUCTION' },
    });
    await this.queue.enqueueIdeaTranscript(id);
    return this.get(id);
  }

  async generationStatus(accountId: string): Promise<IdeaGenerationStatusView> {
    await this.assertAccount(accountId);
    const run = await this.prisma.client.jobRun.findFirst({
      where: { entityId: accountId, jobName: 'idea_generation' },
      orderBy: { createdAt: 'desc' },
    });
    if (!run) {
      return {
        runId: null,
        status: 'idle',
        createdAt: null,
        startedAt: null,
        finishedAt: null,
        error: null,
      };
    }

    const error =
      run.error && typeof run.error === 'object' && !Array.isArray(run.error)
        ? String((run.error as { message?: unknown }).message ?? '')
        : null;
    const statuses = {
      WAITING: 'queued',
      ACTIVE: 'running',
      COMPLETED: 'succeeded',
      FAILED: 'failed',
      DELAYED: 'queued',
    } as const;
    return {
      runId: run.id,
      status: statuses[run.status],
      createdAt: run.createdAt.toISOString(),
      startedAt: run.startedAt?.toISOString() ?? null,
      finishedAt: run.finishedAt?.toISOString() ?? null,
      error: error || null,
    };
  }

  async patch(id: string, dto: PatchIdeaDto): Promise<IdeaView> {
    const idea = await this.findIdeaOrThrow(id);
    this.assertSuggested(idea);

    const updated = await this.prisma.client.idea.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.angle !== undefined ? { angle: dto.angle } : {}),
        ...(dto.hook !== undefined ? { hook: dto.hook } : {}),
        ...(dto.topicSummary !== undefined ? { topicSummary: dto.topicSummary } : {}),
      },
      include: IDEA_LIST_INCLUDE,
    });
    return toIdeaView(updated);
  }

  /** Approve only — does NOT enqueue package generation. */
  async approve(id: string, actorId: string): Promise<IdeaView> {
    const idea = await this.findIdeaOrThrow(id);
    this.assertSuggested(idea);

    const updated = await this.prisma.client.idea.update({
      where: { id },
      data: {
        status: 'APPROVED',
        decidedById: actorId,
        decidedAt: new Date(),
      },
      include: IDEA_LIST_INCLUDE,
    });
    return toIdeaView(updated);
  }

  async reject(id: string, actorId: string, rejectionReason?: string): Promise<IdeaView> {
    const idea = await this.findIdeaOrThrow(id);
    this.assertSuggested(idea);

    const updated = await this.prisma.client.idea.update({
      where: { id },
      data: {
        status: 'REJECTED',
        rejectionReason: rejectionReason ?? null,
        decidedById: actorId,
        decidedAt: new Date(),
      },
      include: IDEA_LIST_INCLUDE,
    });
    return toIdeaView(updated);
  }

  /**
   * Store duration params and enqueue creative-package (brief) generation.
   * Gated: only one active AI package per account until video+thumbnail uploaded.
   */
  async generatePackage(id: string, dto: GeneratePackageDto): Promise<IdeaView> {
    const idea = await this.findIdeaOrThrow(id);
    if (idea.status !== 'APPROVED' && idea.status !== 'IN_PRODUCTION') {
      throw new BadRequestException(
        `Idea is ${idea.status}; approve the idea before generating a package.`,
      );
    }
    if (idea.packageStatus === 'GENERATING') {
      throw new BadRequestException('Package generation is already in progress.');
    }

    const blocker = await this.findBlockingActiveIdea(idea.accountId, id);
    if (blocker) {
      throw new BadRequestException(
        `Finish the current AI idea first — upload final video and thumbnail for "${blocker.title}" before starting generation on another idea.`,
      );
    }

    // Allow retry after FAILED; block regenerate while READY/DONE without uploads.
    if (
      idea.packageStatus !== 'FAILED' &&
      idea.packageStatus !== 'NONE' &&
      (idea.packageStatus === 'READY' || idea.packageStatus === 'DONE') &&
      idea.status === 'IN_PRODUCTION'
    ) {
      const assets = (idea.contentItems ?? []).flatMap((c) => c.assets ?? []);
      const hasVideo = assets.some((a) => a.kind === 'FINAL' && !!(a.localPath || a.driveFileId));
      const hasThumb = assets.some((a) => a.kind === 'THUMBNAIL' && !!(a.localPath || a.driveFileId));
      if (!(hasVideo && hasThumb)) {
        throw new BadRequestException(
          'This idea already has a creative package. Upload the final video and thumbnail before regenerating, or mark the package Done and upload.',
        );
      }
    }

    const updated = await this.prisma.client.idea.update({
      where: { id },
      data: {
        requestedVideoDurationSec: dto.videoDurationSec,
        requestedClipDurationSec: dto.clipDurationSec,
        packageStatus: 'GENERATING',
        // Stay APPROVED until worker finishes; worker sets IN_PRODUCTION + READY.
        status: 'APPROVED',
      },
      include: IDEA_LIST_INCLUDE,
    });

    // Keep a placeholder brief so GET /package does not 404 while the worker runs.
    await this.prisma.client.productionBrief.deleteMany({ where: { ideaId: id } });
    await this.prisma.client.productionBrief.create({
      data: {
        ideaId: id,
        researchSummary: '',
        script: '',
        videoTitle: updated.title,
        videoDescription: '',
        packageStage: 'SCRIPT',
        voiceoverStatus: 'NONE',
        targetDurationSec: dto.videoDurationSec,
      },
    });
    await this.queue.enqueueBriefGeneration(id);
    return toIdeaView(await this.findIdeaOrThrow(id));
  }

  /**
   * Resume a FAILED package from the stage that failed — keep prior successful
   * artifacts (script / voiceover / transcript) instead of regenerating from scratch.
   */
  async retryPackage(id: string): Promise<IdeaView> {
    const idea = await this.findIdeaOrThrow(id);
    if (idea.status !== 'APPROVED' && idea.status !== 'IN_PRODUCTION') {
      throw new BadRequestException(
        `Idea is ${idea.status}; approve the idea before retrying the package.`,
      );
    }
    if (idea.packageStatus === 'GENERATING') {
      throw new BadRequestException('Package generation is already in progress.');
    }

    const briefFailed = idea.brief?.packageStage === 'FAILED';
    if (idea.packageStatus !== 'FAILED' && !briefFailed) {
      throw new BadRequestException(
        'Package is not in a failed state. Use package generation to start or regenerate from scratch.',
      );
    }

    const blocker = await this.findBlockingActiveIdea(idea.accountId, id);
    if (blocker) {
      throw new BadRequestException(
        `Finish the current AI idea first — upload final video and thumbnail for "${blocker.title}" before retrying generation.`,
      );
    }

    const brief = await this.prisma.client.productionBrief.findUnique({
      where: { ideaId: id },
      select: {
        script: true,
        voiceoverStatus: true,
        voiceoverLocalPath: true,
        timedTranscript: true,
        packageStageError: true,
      },
    });

    const resumeFrom = resolvePackageResumeStage(brief);

    // Clear FAILED → GENERATING and show the resumed stage label; never wipe artifacts here.
    await this.prisma.client.idea.update({
      where: { id },
      data: {
        packageStatus: 'GENERATING',
        status: 'APPROVED',
      },
    });

    if (resumeFrom === 'SCRIPT') {
      // Full pipeline from script is OK when there is no usable narration.
      if (brief) {
        await this.prisma.client.productionBrief.update({
          where: { ideaId: id },
          data: { packageStage: 'SCRIPT', packageStageError: null },
        });
      }
      await this.queue.enqueueBriefGeneration(id);
    } else if (resumeFrom === 'VOICE') {
      await this.prisma.client.productionBrief.update({
        where: { ideaId: id },
        data: {
          packageStage: 'VOICE',
          packageStageError: null,
          voiceoverStatus: 'GENERATING',
        },
      });
      await this.queue.enqueueIdeaTts(id);
    } else if (resumeFrom === 'TRANSCRIPT') {
      await this.prisma.client.productionBrief.update({
        where: { ideaId: id },
        data: { packageStage: 'TRANSCRIPT', packageStageError: null },
      });
      await this.queue.enqueueIdeaTranscript(id);
    } else {
      await this.prisma.client.productionBrief.update({
        where: { ideaId: id },
        data: { packageStage: 'VISUALS', packageStageError: null },
      });
      await this.queue.enqueueIdeaVisuals(id);
    }

    const updated = await this.findIdeaOrThrow(id);
    return toIdeaView(updated);
  }

  /**
   * Force re-run of one package stage even when the package is already READY.
   * Script wipes the brief and regenerates; voiceover/visuals keep prior artifacts
   * that the later stages do not need to rebuild from scratch.
   */
  async regeneratePackageStage(
    id: string,
    stage: 'script' | 'voiceover' | 'visuals',
  ): Promise<IdeaView> {
    const idea = await this.findIdeaOrThrow(id);
    if (idea.status === 'REJECTED') {
      throw new BadRequestException('Rejected ideas cannot be regenerated.');
    }
    if (idea.status !== 'APPROVED' && idea.status !== 'IN_PRODUCTION' && idea.status !== 'UPLOADED') {
      throw new BadRequestException(
        `Idea is ${idea.status}; approve it before regenerating package stages.`,
      );
    }
    if (idea.packageStatus === 'GENERATING') {
      throw new BadRequestException('Package generation is already in progress.');
    }

    const blocker = await this.findBlockingActiveIdea(idea.accountId, id);
    if (blocker) {
      throw new BadRequestException(
        `Finish the current AI idea first — upload final video and thumbnail for "${blocker.title}" before regenerating another package.`,
      );
    }

    if (stage === 'script') {
      const updated = await this.prisma.client.idea.update({
        where: { id },
        data: {
          packageStatus: 'GENERATING',
          status: idea.status === 'UPLOADED' ? 'UPLOADED' : 'APPROVED',
        },
        include: IDEA_LIST_INCLUDE,
      });
      await this.prisma.client.productionBrief.deleteMany({ where: { ideaId: id } });
      await this.queue.enqueueBriefGeneration(id);
      return toIdeaView(updated);
    }

    const brief = await this.prisma.client.productionBrief.findUnique({
      where: { ideaId: id },
      select: {
        script: true,
        voiceoverStatus: true,
        voiceoverLocalPath: true,
        timedTranscript: true,
      },
    });
    if (!brief) {
      throw new BadRequestException('No creative package yet — generate the package first.');
    }

    if (stage === 'voiceover') {
      if (!brief.script?.trim()) {
        throw new BadRequestException('No narration script to synthesize — regenerate the script first.');
      }
      const profile = await this.prisma.client.channelProfile.findUnique({
        where: { accountId: idea.accountId },
        select: { styleProfile: true },
      });
      if (isKidsRhymePackage(profile?.styleProfile)) {
        throw new BadRequestException(
          'Kids rhymes use an uploaded sound, not generated TTS. Upload the rhyme on the AI package.',
        );
      }
      await this.prisma.client.idea.update({
        where: { id },
        data: {
          packageStatus: 'GENERATING',
          status: idea.status === 'UPLOADED' ? 'UPLOADED' : 'APPROVED',
        },
      });
      await this.prisma.client.productionBrief.update({
        where: { ideaId: id },
        data: {
          packageStage: 'VOICE',
          packageStageError: null,
          voiceoverStatus: 'GENERATING',
        },
      });
      await this.queue.enqueueIdeaTts(id);
    } else {
      const timings = Array.isArray(brief.timedTranscript) ? brief.timedTranscript : [];
      if (timings.length === 0) {
        throw new BadRequestException(
          'No timed transcript yet — wait for voiceover (or regenerate it) before visuals.',
        );
      }
      await this.prisma.client.idea.update({
        where: { id },
        data: {
          packageStatus: 'GENERATING',
          status: idea.status === 'UPLOADED' ? 'UPLOADED' : 'APPROVED',
        },
      });
      await this.prisma.client.productionBrief.update({
        where: { ideaId: id },
        data: { packageStage: 'VISUALS', packageStageError: null },
      });
      await this.queue.enqueueIdeaVisuals(id);
    }

    return toIdeaView(await this.findIdeaOrThrow(id));
  }

  async getPackage(ideaId: string): Promise<ProductionBriefView> {
    const brief = await this.prisma.client.productionBrief.findUnique({
      where: { ideaId },
      include: {
        idea: {
          select: {
            title: true,
            packageStatus: true,
            requestedVideoDurationSec: true,
            account: {
              select: {
                profile: { select: { styleProfile: true } },
              },
            },
          },
        },
      },
    });
    if (brief) {
      const presentationMode = parseStyleProfile(brief.idea.account.profile?.styleProfile).answers
        .presentation;
      return toBriefView(brief, presentationMode);
    }

    // Soft pending response while GENERATING before/after brief rewrite — avoid
    // noisy 404s from the AI packages poller.
    const idea = await this.prisma.client.idea.findFirst({
      where: { id: ideaId, deletedAt: null },
      select: {
        id: true,
        title: true,
        packageStatus: true,
        requestedVideoDurationSec: true,
        account: {
          select: { profile: { select: { styleProfile: true } } },
        },
      },
    });
    if (!idea) throw new NotFoundException('Idea not found.');
    if (idea.packageStatus !== 'GENERATING' && idea.packageStatus !== 'FAILED') {
      throw new NotFoundException('Creative package not found for this idea.');
    }
    const presentationMode = parseStyleProfile(idea.account.profile?.styleProfile).answers
      .presentation;
    return pendingBriefView(idea, presentationMode);
  }

  /** Alias kept for older clients. */
  async getBrief(ideaId: string): Promise<ProductionBriefView> {
    return this.getPackage(ideaId);
  }

  async getVoiceoverDownload(
    ideaId: string,
  ): Promise<{ path: string; mimeType: string; bytes: number | null } | null> {
    const brief = await this.prisma.client.productionBrief.findUnique({
      where: { ideaId },
      select: { voiceoverStatus: true, voiceoverLocalPath: true },
    });
    if (!brief || brief.voiceoverStatus !== 'READY' || !brief.voiceoverLocalPath) return null;
    if (!existsSync(brief.voiceoverLocalPath)) return null;
    return {
      path: brief.voiceoverLocalPath,
      mimeType: 'audio/wav',
      bytes: null,
    };
  }

  async getTranscriptDownload(
    ideaId: string,
    format: 'srt' | 'vtt' = 'srt',
  ): Promise<{ path: string; mimeType: string; filename: string } | null> {
    const brief = await this.prisma.client.productionBrief.findUnique({
      where: { ideaId },
      select: { transcriptLocalPath: true, timedTranscript: true },
    });
    if (!brief) return null;
    const base = brief.transcriptLocalPath?.replace(/\.srt$/i, '') ?? null;
    if (base) {
      const candidate =
        format === 'vtt' ? `${base}.vtt` : brief.transcriptLocalPath!;
      if (existsSync(candidate)) {
        return {
          path: candidate,
          mimeType: format === 'vtt' ? 'text/vtt' : 'application/x-subrip',
          filename: `transcript.${format}`,
        };
      }
    }
    return null;
  }

  /** Owner marks package review complete — ready for external production + upload. */
  async markPackageDone(id: string): Promise<IdeaView> {
    const idea = await this.findIdeaOrThrow(id);
    if (
      idea.packageStatus !== 'READY' &&
      idea.packageStatus !== 'DONE' &&
      idea.brief?.packageStage !== 'READY'
    ) {
      throw new BadRequestException(
        `Package is ${idea.packageStatus}; wait until generation finishes before marking Done.`,
      );
    }
    const brief = await this.prisma.client.productionBrief.findUnique({
      where: { ideaId: id },
      select: { id: true },
    });
    if (!brief) throw new BadRequestException('No creative package to mark done.');

    const updated = await this.prisma.client.idea.update({
      where: { id },
      data: {
        packageStatus: 'DONE',
        status: 'IN_PRODUCTION',
      },
      include: IDEA_LIST_INCLUDE,
    });
    return toIdeaView(updated);
  }

  /**
   * Create a MANUAL_UPLOAD content item linked to this idea (owner upload path).
   * Client then uploads FINAL + THUMBNAIL via storage and schedules via /publish.
   */
  async createUploadContent(
    id: string,
    dto: UploadIdeaVideoDto,
  ): Promise<ContentItemView & { ideaId: string }> {
    const idea = await this.findIdeaOrThrow(id);
    // The brief's stage is the authoritative "package finished" signal; packageStatus
    // can lag behind it if a stage transition was interrupted.
    const stageReady = idea.brief?.packageStage === 'READY';
    const packageFinished =
      idea.packageStatus === 'DONE' ||
      idea.packageStatus === 'READY' ||
      stageReady ||
      idea.status === 'UPLOADED';
    if (!packageFinished) {
      throw new BadRequestException(
        'Wait for the creative package to finish before uploading the finished video.',
      );
    }

    // Auto-mark Done when uploading from READY (or from a lagging packageStatus).
    const keepsStatus = idea.status === 'UPLOADED' || idea.status === 'PUBLISHED';
    if (idea.packageStatus !== 'DONE' || !keepsStatus) {
      await this.prisma.client.idea.update({
        where: { id },
        data: {
          packageStatus: 'DONE',
          ...(keepsStatus ? {} : { status: 'IN_PRODUCTION' }),
        },
      });
    }

    const brief = await this.prisma.client.productionBrief.findUnique({
      where: { ideaId: id },
      select: { videoTitle: true },
    });

    const title = dto.title?.trim() || brief?.videoTitle?.trim() || idea.title;

    // Reuse existing linked content item if present (so thumbnail can be added later).
    const existing = await this.prisma.client.contentItem.findFirst({
      where: { ideaId: id, deletedAt: null, type: 'MANUAL_UPLOAD' },
      include: { assets: true },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { ...toContentItemView(existing), ideaId: id };
    }

    const item = await this.prisma.client.contentItem.create({
      data: {
        title,
        type: 'MANUAL_UPLOAD',
        status: 'REVIEW_PENDING',
        ideaId: id,
      },
      include: { assets: true },
    });

    return { ...toContentItemView(item), ideaId: id };
  }

  /**
   * Mark idea UPLOADED only when both FINAL video and THUMBNAIL assets exist
   * on a linked content item — unlocks the next Start Generation.
   */
  async markUploaded(id: string): Promise<IdeaView> {
    await this.findIdeaOrThrow(id);
    const items = await this.prisma.client.contentItem.findMany({
      where: { ideaId: id, deletedAt: null },
      select: {
        assets: {
          where: { kind: { in: ['FINAL', 'THUMBNAIL'] as Array<'FINAL' | 'THUMBNAIL'> } },
          select: { kind: true, localPath: true, driveFileId: true },
        },
      },
    });
    const assets = items.flatMap((c) => c.assets);
    const hasVideo = assets.some((a) => a.kind === 'FINAL' && !!(a.localPath || a.driveFileId));
    const hasThumb = assets.some((a) => a.kind === 'THUMBNAIL' && !!(a.localPath || a.driveFileId));
    if (!hasVideo || !hasThumb) {
      throw new BadRequestException(
        'Upload both the final video and a thumbnail before marking this idea uploaded.',
      );
    }

    const updated = await this.prisma.client.idea.update({
      where: { id },
      data: { status: 'UPLOADED', packageStatus: 'DONE' },
      include: IDEA_LIST_INCLUDE,
    });
    return toIdeaView(updated);
  }

  async softDelete(id: string): Promise<{ id: string; deleted: true }> {
    const idea = await this.prisma.client.idea.findFirst({
      where: { id, deletedAt: null },
      select: { id: true },
    });
    if (!idea) throw new NotFoundException('Idea not found.');
    await this.prisma.client.idea.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    return { id, deleted: true };
  }

  voiceoverFilename(path: string): string {
    return basename(path) || 'voiceover.wav';
  }
}
