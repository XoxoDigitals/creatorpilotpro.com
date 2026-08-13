import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { configuration, validateEnv } from './config/configuration';
import { PrismaModule } from './prisma/prisma.module';
import { CryptoModule } from './common/crypto/crypto.module';
import { QueueModule } from './common/queue/queue.module';
import { AccountAccessModule } from './common/account-access/account-access.module';
import { AccountAccessGuard } from './common/account-access/account-access.guard';
import { CsrfGuard } from './common/guards/csrf.guard';
import { SessionAuthGuard } from './common/guards/session-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { SourcesModule } from './modules/sources/sources.module';
import { CompetitorsModule } from './modules/competitors/competitors.module';
import { ContentModule } from './modules/content/content.module';
import { AiModule } from './modules/ai/ai.module';
import { IdeasModule } from './modules/ideas/ideas.module';
import { DramasModule } from './modules/dramas/dramas.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { PublishingModule } from './modules/publishing/publishing.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { IncidentsModule } from './modules/incidents/incidents.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { StorageModule } from './modules/storage/storage.module';
import { SystemModule } from './modules/system/system.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validate: validateEnv,
      // The single .env lives at the repo root; cwd is apps/api under
      // `turbo run dev` but the repo root under pm2/`node dist/main.js`.
      envFilePath: ['.env', '../../.env'],
    }),
    // Global rate limiting (docs/08 §1). Two tiers: burst protection (short) +
    // sustained-abuse cap (long). Trust-proxy is set in main.ts so req.ip is
    // the client's true IP behind Caddy.
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1_000, limit: 20 },
      { name: 'long', ttl: 60_000, limit: 300 },
    ]),
    // Cross-cutting infrastructure (global).
    PrismaModule,
    CryptoModule,
    QueueModule,
    AccountAccessModule,
    HealthModule,
    // Feature modules (docs/02 §3).
    AuthModule,
    UsersModule,
    AccountsModule,
    SourcesModule,
    CompetitorsModule,
    ContentModule,
    AiModule,
    IdeasModule,
    DramasModule,
    TasksModule,
    SchedulingModule,
    PublishingModule,
    AnalyticsModule,
    IncidentsModule,
    NotificationsModule,
    StorageModule,
    SystemModule,
  ],
  providers: [
    // Global guard chain (order matters): throttler → CSRF → session auth → RBAC → account ACL.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: AccountAccessGuard },
    // Audit trail for @Audit()-annotated mutations (docs/08 §3).
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
  ],
})
export class AppModule {}
