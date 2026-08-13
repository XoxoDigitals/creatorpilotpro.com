-- Phase 5: Analytics snapshot tables (docs/07)

-- MetricSnapshotAccount — daily per-account metrics
CREATE TABLE "metric_snapshot_accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "followers" INTEGER NOT NULL DEFAULT 0,
    "views" INTEGER NOT NULL DEFAULT 0,
    "watchTimeMin" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "revenue" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "rpm" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "engagements" INTEGER NOT NULL DEFAULT 0,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_snapshot_accounts_pkey" PRIMARY KEY ("id")
);

-- MetricSnapshotPost — daily per-post metrics
CREATE TABLE "metric_snapshot_posts" (
    "id" TEXT NOT NULL,
    "publishTargetId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "watchTimeMin" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "ctr" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "retentionCurve" JSONB NOT NULL DEFAULT '[]',
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "metric_snapshot_posts_pkey" PRIMARY KEY ("id")
);

-- AiUsageDaily — materialized daily rollup from ai_usage_log
CREATE TABLE "ai_usage_daily" (
    "id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "providerId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "totalCalls" INTEGER NOT NULL DEFAULT 0,
    "cacheHits" INTEGER NOT NULL DEFAULT 0,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "ttsSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estimatedCostUsd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_daily_pkey" PRIMARY KEY ("id")
);

-- WorkerProductivitySnapshot — weekly per-worker rollup
CREATE TABLE "worker_productivity_snapshots" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "tasksAssigned" INTEGER NOT NULL DEFAULT 0,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "medianHoursToComplete" DOUBLE PRECISION,
    "revisionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_productivity_snapshots_pkey" PRIMARY KEY ("id")
);

-- Unique constraints
CREATE UNIQUE INDEX "metric_snapshot_accounts_accountId_date_key" ON "metric_snapshot_accounts"("accountId", "date");
CREATE UNIQUE INDEX "metric_snapshot_posts_publishTargetId_date_key" ON "metric_snapshot_posts"("publishTargetId", "date");
CREATE UNIQUE INDEX "ai_usage_daily_date_providerId_task_key" ON "ai_usage_daily"("date", "providerId", "task");
CREATE UNIQUE INDEX "worker_productivity_snapshots_userId_weekStart_key" ON "worker_productivity_snapshots"("userId", "weekStart");

-- Indexes
CREATE INDEX "metric_snapshot_accounts_accountId_idx" ON "metric_snapshot_accounts"("accountId");
CREATE INDEX "metric_snapshot_accounts_date_idx" ON "metric_snapshot_accounts"("date");
CREATE INDEX "metric_snapshot_posts_publishTargetId_idx" ON "metric_snapshot_posts"("publishTargetId");
CREATE INDEX "metric_snapshot_posts_accountId_idx" ON "metric_snapshot_posts"("accountId");
CREATE INDEX "metric_snapshot_posts_date_idx" ON "metric_snapshot_posts"("date");
CREATE INDEX "worker_productivity_snapshots_userId_idx" ON "worker_productivity_snapshots"("userId");

-- Foreign keys
ALTER TABLE "metric_snapshot_accounts" ADD CONSTRAINT "metric_snapshot_accounts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "metric_snapshot_posts" ADD CONSTRAINT "metric_snapshot_posts_publishTargetId_fkey" FOREIGN KEY ("publishTargetId") REFERENCES "publish_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "worker_productivity_snapshots" ADD CONSTRAINT "worker_productivity_snapshots_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
