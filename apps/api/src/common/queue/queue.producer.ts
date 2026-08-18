import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PgBoss from 'pg-boss';
import { QUEUE } from '@scp/shared';

/**
 * Thin pg-boss producer for the API (docs/06 §3). The worker owns queue creation
 * and consumption; the API only *sends* publish jobs. Job shape matches the
 * worker's contract exactly: `{ kind: 'publish', publishTargetId }` on the
 * `publish` queue, with singletonKey so a target can't be double-dispatched.
 */
@Injectable()
export class QueueProducer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueProducer.name);
  private boss: PgBoss | undefined;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const connectionString = this.config.get<string>('databaseUrl');
    if (!connectionString) {
      this.logger.warn('DATABASE_URL not set — publish dispatch is disabled.');
      return;
    }
    this.boss = new PgBoss({ connectionString, schema: 'pgboss' });
    this.boss.on('error', (err) => this.logger.error('pg-boss error', err as Error));
    await this.boss.start();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.boss) await this.boss.stop({ graceful: true, timeout: 5_000 });
  }

  /** Enqueue an immediate publish for a target (dedup via singletonKey). */
  async enqueuePublish(publishTargetId: string): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.PUBLISH,
      { kind: 'publish', publishTargetId },
      { singletonKey: publishTargetId },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        'A publish job for this target is already queued or active. Wait for it to finish, then retry.',
      );
    }
  }

  /** Enqueue an immediate poll of a watched source (docs/04 §1; dedup via singletonKey). */
  async enqueueWatch(watchedSourceId: string): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.WATCHER,
      { kind: 'watch', watchedSourceId },
      { singletonKey: watchedSourceId },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        'A watcher job for this source is already queued or active.',
      );
    }
  }

  /** Enqueue a download for a discovered source video (docs/04 §2; dedup via singletonKey). */
  async enqueueDownload(sourceVideoId: string): Promise<void> {
    if (!this.boss) {
      this.logger.warn(`enqueueDownload(${sourceVideoId}) skipped — producer not started.`);
      return;
    }
    await this.boss.send(
      QUEUE.DOWNLOAD,
      { kind: 'download', sourceVideoId },
      { singletonKey: sourceVideoId },
    );
  }

  /** Enqueue an AI job (analyze/narration/metadata) for a content item (docs/05 §2). */
  async enqueueAi(contentItemId: string, kind: 'analyze' | 'narration' | 'metadata'): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.AI,
      { kind, contentItemId },
      { singletonKey: `${kind}-${contentItemId}` },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        `An ${kind} job for this item is already queued or active.`,
      );
    }
  }

  /** Enqueue TTS synthesis for a content item (docs/05 §6). */
  async enqueueTts(contentItemId: string): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.TTS,
      { kind: 'tts', contentItemId },
      { singletonKey: `tts-${contentItemId}` },
    );
    if (!jobId) {
      throw new ServiceUnavailableException('A TTS job for this item is already queued or active.');
    }
  }

  /** Re-mix FINAL from existing VOICEOVER (no TTS). */
  async enqueueRender(contentItemId: string): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.STORAGE,
      { kind: 'render', contentItemId },
      { singletonKey: `render-${contentItemId}` },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        'A render job for this item is already queued or active.',
      );
    }
  }

  /** Enqueue a competitor channel poll (Phase 4, reuses WATCHER queue). */
  async enqueueCompetitorPoll(competitorChannelId: string): Promise<void> {
    if (!this.boss) {
      this.logger.warn(`enqueueCompetitorPoll(${competitorChannelId}) skipped — producer not started.`);
      return;
    }
    await this.boss.send(
      QUEUE.WATCHER,
      { kind: 'competitor_poll', competitorChannelId },
      { singletonKey: `comp-${competitorChannelId}` },
    );
  }

  /** Enqueue reference-channel performance analysis (channel memory). */
  async enqueueCompetitorPerformanceAnalysis(
    competitorChannelId: string,
    force = false,
  ): Promise<void> {
    if (!this.boss) {
      this.logger.warn(
        `enqueueCompetitorPerformanceAnalysis(${competitorChannelId}) skipped — producer not started.`,
      );
      return;
    }
    await this.boss.send(
      QUEUE.AI,
      { kind: 'competitor_performance', competitorChannelId, force },
      { singletonKey: `comp-perf-${competitorChannelId}` },
    );
  }

  /** Enqueue AI idea generation for an account (Phase 4). */
  async enqueueIdeaGeneration(
    accountId: string,
    count = 50,
    generationRunId?: string,
    topicSeed?: string,
    exactTopic = false,
  ): Promise<string> {
    if (!this.boss) {
      throw new ServiceUnavailableException('The job queue is not available. Please try again shortly.');
    }
    const jobId = await this.boss.send(
      QUEUE.AI,
      {
        kind: 'idea_generation',
        accountId,
        count,
        generationRunId,
        ...(topicSeed ? { topicSeed } : {}),
        ...(exactTopic ? { exactTopic: true } : {}),
      },
      { singletonKey: `idea-gen-${accountId}` },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        'Idea generation is already queued. Please wait for it to finish.',
      );
    }
    return jobId;
  }

  /** Enqueue AI brief generation for an approved idea (Phase 4). */
  async enqueueBriefGeneration(ideaId: string): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.AI,
      { kind: 'brief_generation', ideaId },
      { singletonKey: `brief-${ideaId}` },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        'Brief generation for this idea is already queued or active.',
      );
    }
  }

  /** Enqueue package voiceover TTS (resume from VOICE stage). */
  async enqueueIdeaTts(ideaId: string): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.TTS,
      { kind: 'idea_tts', ideaId },
      { singletonKey: `idea-tts-${ideaId}`, expireInSeconds: 12 * 60 },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        'Idea TTS for this package is already queued or active.',
      );
    }
  }

  /** Enqueue timed-transcript rebuild (resume from TRANSCRIPT stage). */
  async enqueueIdeaTranscript(ideaId: string): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.AI,
      { kind: 'idea_transcript', ideaId },
      { singletonKey: `idea-transcript-${ideaId}` },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        'Idea transcript for this package is already queued or active.',
      );
    }
  }

  /** Enqueue visual-prompt generation (resume from VISUALS stage). */
  async enqueueIdeaVisuals(ideaId: string): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.AI,
      { kind: 'idea_visuals', ideaId },
      { singletonKey: `idea-visuals-${ideaId}` },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        'Idea visuals for this package is already queued or active.',
      );
    }
  }

  /** Enqueue AI drama bible generation for a series (Phase 4). */
  async enqueueDramaBible(seriesId: string): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.AI,
      { kind: 'drama_bible', seriesId },
      { singletonKey: `bible-${seriesId}` },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        'Drama bible generation is already queued or active.',
      );
    }
  }

  /** Enqueue AI drama episode generation (Phase 4). */
  async enqueueDramaEpisode(episodeId: string): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.AI,
      { kind: 'drama_episode', episodeId },
      { singletonKey: `episode-${episodeId}` },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        'Drama episode generation is already queued or active.',
      );
    }
  }

  /** Enqueue A/B title + thumbnail suggestion generation (Phase 7 #10). */
  async enqueueAbSuggestions(contentItemId: string): Promise<void> {
    if (!this.boss) {
      throw new ServiceUnavailableException(
        'The job queue is not available. Please try again shortly.',
      );
    }
    const jobId = await this.boss.send(
      QUEUE.AI,
      { kind: 'ab_suggestions', contentItemId },
      { singletonKey: `ab-${contentItemId}` },
    );
    if (!jobId) {
      throw new ServiceUnavailableException(
        'A/B suggestions for this item are already queued or active.',
      );
    }
  }

  /** Enqueue manual account metrics sync (Phase 5). */
  async enqueueAccountSync(accountId: string): Promise<void> {
    if (!this.boss) {
      this.logger.warn(`enqueueAccountSync(${accountId}) skipped — producer not started.`);
      return;
    }
    await this.boss.send(
      QUEUE.ANALYTICS,
      { kind: 'account_sync', accountId },
      { singletonKey: `acct-sync-${accountId}` },
    );
  }

  /** Enqueue manual post metrics sync (Phase 5). */
  async enqueuePostSync(publishTargetId: string): Promise<void> {
    if (!this.boss) {
      this.logger.warn(`enqueuePostSync(${publishTargetId}) skipped — producer not started.`);
      return;
    }
    await this.boss.send(
      QUEUE.ANALYTICS,
      { kind: 'post_sync', publishTargetId },
      { singletonKey: `post-sync-${publishTargetId}` },
    );
  }
}
