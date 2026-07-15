import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
      this.logger.warn(`enqueuePublish(${publishTargetId}) skipped — producer not started.`);
      return;
    }
    await this.boss.send(
      QUEUE.PUBLISH,
      { kind: 'publish', publishTargetId },
      { singletonKey: publishTargetId },
    );
  }
}
