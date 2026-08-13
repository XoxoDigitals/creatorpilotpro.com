import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { Roles } from '../../common/decorators/roles.decorator';
import type {
  OverviewView,
  AccountMetricsView,
  PostMetricsView,
  PostTableRowView,
  AiUsageView,
  WorkerProductivityView,
  SystemHealthView,
} from './analytics.view';

@ApiTags('analytics')
@Roles('OWNER', 'ADMIN', 'REVIEWER')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(): Promise<OverviewView> {
    return this.analytics.getOverview();
  }

  @Get('accounts/:accountId')
  accountMetrics(
    @Param('accountId') accountId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AccountMetricsView> {
    return this.analytics.getAccountMetrics(accountId, from, to);
  }

  @Get('accounts/:accountId/posts')
  accountPosts(
    @Param('accountId') accountId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<PostTableRowView[]> {
    return this.analytics.getAccountPosts(accountId, from, to);
  }

  @Get('posts/:publishTargetId')
  postMetrics(
    @Param('publishTargetId') publishTargetId: string,
  ): Promise<PostMetricsView> {
    return this.analytics.getPostMetrics(publishTargetId);
  }

  @Get('ai-usage')
  aiUsage(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<AiUsageView> {
    return this.analytics.getAiUsage(from, to);
  }

  @Get('workers')
  workers(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<WorkerProductivityView> {
    return this.analytics.getWorkerProductivity(from, to);
  }

  @Get('system')
  @Roles('OWNER', 'ADMIN')
  system(): Promise<SystemHealthView> {
    return this.analytics.getSystemHealth();
  }

  @Get('accounts/:accountId/best-hours')
  bestHours(
    @Param('accountId') accountId: string,
    @Query('limit') limit?: string,
  ) {
    return this.analytics.getBestPostingHours(accountId, limit ? Number(limit) : undefined);
  }

  @Get('content/:contentItemId/cost')
  contentCost(
    @Param('contentItemId') contentItemId: string,
  ) {
    return this.analytics.getContentItemCost(contentItemId);
  }

  @Post('accounts/:accountId/sync')
  @Roles('OWNER', 'ADMIN')
  triggerAccountSync(
    @Param('accountId') accountId: string,
  ): Promise<{ enqueued: true }> {
    return this.analytics.triggerAccountSync(accountId);
  }

  @Post('posts/:publishTargetId/sync')
  @Roles('OWNER', 'ADMIN')
  triggerPostSync(
    @Param('publishTargetId') publishTargetId: string,
  ): Promise<{ enqueued: true }> {
    return this.analytics.triggerPostSync(publishTargetId);
  }
}
