import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { configuration, validateEnv } from './config/configuration';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { SourcesModule } from './modules/sources/sources.module';
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
    }),
    HealthModule,
    // Feature modules (docs/02 §3) — Phase 0 stubs, wired for boundary structure.
    AuthModule,
    UsersModule,
    AccountsModule,
    SourcesModule,
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
})
export class AppModule {}
