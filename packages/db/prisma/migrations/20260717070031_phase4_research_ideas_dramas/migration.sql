-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('SUGGESTED', 'APPROVED', 'REJECTED', 'IN_PRODUCTION', 'UPLOADED', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "WorkerTaskStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'UPLOADED', 'REVISION_REQUESTED', 'DONE');

-- CreateEnum
CREATE TYPE "TranscriptSource" AS ENUM ('CAPTIONS', 'WHISPER', 'NONE');

-- CreateEnum
CREATE TYPE "competitor_channel_status" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "drama_series_status" AS ENUM ('PLANNING', 'BIBLE_GENERATING', 'BIBLE_READY', 'IN_PRODUCTION', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "drama_episode_status" AS ENUM ('PENDING', 'GENERATING', 'GENERATED', 'IN_PRODUCTION', 'UPLOADED', 'PUBLISHED', 'FAILED');

-- CreateTable
CREATE TABLE "competitor_channels" (
    "id" TEXT NOT NULL,
    "ownAccountId" TEXT NOT NULL,
    "youtubeChannelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "checkIntervalMin" INTEGER NOT NULL DEFAULT 360,
    "lastCheckedAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "status" "competitor_channel_status" NOT NULL DEFAULT 'ACTIVE',
    "errorNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "competitor_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_videos" (
    "id" TEXT NOT NULL,
    "competitorChannelId" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "views" BIGINT NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "durationSec" DOUBLE PRECISION,
    "transcript" TEXT,
    "transcriptSource" "TranscriptSource" NOT NULL DEFAULT 'NONE',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitor_videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideas" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "sourceCompetitorVideoIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "title" TEXT NOT NULL,
    "angle" TEXT NOT NULL DEFAULT '',
    "hook" TEXT NOT NULL DEFAULT '',
    "rationale" TEXT NOT NULL DEFAULT '',
    "status" "IdeaStatus" NOT NULL DEFAULT 'SUGGESTED',
    "rejectionReason" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ideas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_briefs" (
    "id" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "researchSummary" TEXT NOT NULL DEFAULT '',
    "script" TEXT NOT NULL DEFAULT '',
    "sceneBreakdown" JSONB NOT NULL DEFAULT '[]',
    "characterPrompts" JSONB NOT NULL DEFAULT '[]',
    "editingInstructions" TEXT NOT NULL DEFAULT '',
    "targetDurationSec" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_briefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drama_series" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "genre" TEXT NOT NULL DEFAULT '',
    "theme" TEXT NOT NULL DEFAULT '',
    "audience" TEXT NOT NULL DEFAULT '',
    "episodeCount" INTEGER NOT NULL,
    "episodeDurationSec" INTEGER NOT NULL DEFAULT 60,
    "styleReferences" TEXT,
    "seriesBible" JSONB,
    "characterSheets" JSONB NOT NULL DEFAULT '[]',
    "status" "drama_series_status" NOT NULL DEFAULT 'PLANNING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "drama_series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drama_episodes" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "summary" TEXT,
    "script" TEXT,
    "scenePrompts" JSONB NOT NULL DEFAULT '[]',
    "narration" TEXT,
    "productionNotes" TEXT,
    "recap" TEXT,
    "generatedAt" TIMESTAMP(3),
    "contentItemId" TEXT,
    "status" "drama_episode_status" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "drama_episodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_tasks" (
    "id" TEXT NOT NULL,
    "briefId" TEXT,
    "episodeId" TEXT,
    "ideaId" TEXT,
    "workerId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "WorkerTaskStatus" NOT NULL DEFAULT 'ASSIGNED',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedAt" TIMESTAMP(3),
    "contentItemId" TEXT,
    "revisionNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "competitor_channels_status_idx" ON "competitor_channels"("status");

-- CreateIndex
CREATE INDEX "competitor_channels_deletedAt_idx" ON "competitor_channels"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_channels_ownAccountId_youtubeChannelId_key" ON "competitor_channels"("ownAccountId", "youtubeChannelId");

-- CreateIndex
CREATE INDEX "competitor_videos_competitorChannelId_idx" ON "competitor_videos"("competitorChannelId");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_videos_competitorChannelId_videoId_key" ON "competitor_videos"("competitorChannelId", "videoId");

-- CreateIndex
CREATE INDEX "ideas_accountId_status_idx" ON "ideas"("accountId", "status");

-- CreateIndex
CREATE INDEX "ideas_deletedAt_idx" ON "ideas"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "production_briefs_ideaId_key" ON "production_briefs"("ideaId");

-- CreateIndex
CREATE INDEX "drama_series_accountId_idx" ON "drama_series"("accountId");

-- CreateIndex
CREATE INDEX "drama_series_status_idx" ON "drama_series"("status");

-- CreateIndex
CREATE INDEX "drama_series_deletedAt_idx" ON "drama_series"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "drama_episodes_contentItemId_key" ON "drama_episodes"("contentItemId");

-- CreateIndex
CREATE INDEX "drama_episodes_seriesId_idx" ON "drama_episodes"("seriesId");

-- CreateIndex
CREATE INDEX "drama_episodes_status_idx" ON "drama_episodes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "drama_episodes_seriesId_number_key" ON "drama_episodes"("seriesId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "worker_tasks_contentItemId_key" ON "worker_tasks"("contentItemId");

-- CreateIndex
CREATE INDEX "worker_tasks_workerId_status_idx" ON "worker_tasks"("workerId", "status");

-- CreateIndex
CREATE INDEX "worker_tasks_accountId_idx" ON "worker_tasks"("accountId");

-- CreateIndex
CREATE INDEX "worker_tasks_status_idx" ON "worker_tasks"("status");

-- CreateIndex
CREATE INDEX "content_items_ideaId_idx" ON "content_items"("ideaId");

-- CreateIndex
CREATE INDEX "content_items_episodeId_idx" ON "content_items"("episodeId");

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "drama_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_channels" ADD CONSTRAINT "competitor_channels_ownAccountId_fkey" FOREIGN KEY ("ownAccountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_videos" ADD CONSTRAINT "competitor_videos_competitorChannelId_fkey" FOREIGN KEY ("competitorChannelId") REFERENCES "competitor_channels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideas" ADD CONSTRAINT "ideas_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_briefs" ADD CONSTRAINT "production_briefs_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drama_series" ADD CONSTRAINT "drama_series_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drama_episodes" ADD CONSTRAINT "drama_episodes_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "drama_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drama_episodes" ADD CONSTRAINT "drama_episodes_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_tasks" ADD CONSTRAINT "worker_tasks_briefId_fkey" FOREIGN KEY ("briefId") REFERENCES "production_briefs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_tasks" ADD CONSTRAINT "worker_tasks_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "drama_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_tasks" ADD CONSTRAINT "worker_tasks_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ideas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_tasks" ADD CONSTRAINT "worker_tasks_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_tasks" ADD CONSTRAINT "worker_tasks_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_tasks" ADD CONSTRAINT "worker_tasks_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
