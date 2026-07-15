-- CreateEnum
CREATE TYPE "ContentItemType" AS ENUM ('REPURPOSED', 'WORKER_PRODUCED', 'DRAMA_EPISODE', 'MANUAL_UPLOAD');

-- CreateEnum
CREATE TYPE "ContentItemStatus" AS ENUM ('INGESTED', 'REVIEW_PENDING', 'APPROVED', 'ANALYZING', 'SCRIPT_READY', 'SCRIPT_APPROVED', 'TTS_DONE', 'RENDERED', 'METADATA_READY', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'DRAFT', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('ORIGINAL', 'PROCESSED', 'VOICEOVER', 'BG_AUDIO', 'FINAL', 'THUMBNAIL', 'SUBTITLE');

-- CreateEnum
CREATE TYPE "StorageState" AS ENUM ('LOCAL', 'UPLOADING', 'DRIVE', 'BOTH', 'EVICTED');

-- CreateEnum
CREATE TYPE "ScheduleMode" AS ENUM ('NOW', 'FIXED', 'QUEUE_SLOT', 'RANDOM_WINDOW');

-- CreateEnum
CREATE TYPE "PublishTargetStatus" AS ENUM ('PENDING', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'DRAFT');

-- CreateEnum
CREATE TYPE "PublishAttemptOutcome" AS ENUM ('SUCCESS', 'RETRYABLE_ERROR', 'TERMINAL_ERROR');

-- CreateEnum
CREATE TYPE "IncidentKind" AS ENUM ('COPYRIGHT', 'AUTH', 'RATE_LIMIT', 'PLATFORM_REJECT', 'WATCHER', 'STORAGE', 'SYSTEM');

-- CreateEnum
CREATE TYPE "IncidentSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('OPEN', 'ACKED', 'RESOLVED');

-- CreateTable
CREATE TABLE "content_items" (
    "id" TEXT NOT NULL,
    "type" "ContentItemType" NOT NULL,
    "sourceVideoId" TEXT,
    "ideaId" TEXT,
    "episodeId" TEXT,
    "title" TEXT NOT NULL,
    "status" "ContentItemStatus" NOT NULL DEFAULT 'INGESTED',
    "statusReason" TEXT,
    "reviewedById" TEXT,
    "currentStep" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "localPath" TEXT,
    "driveFileId" TEXT,
    "md5" TEXT,
    "bytes" BIGINT,
    "durationSec" DOUBLE PRECISION,
    "width" INTEGER,
    "height" INTEGER,
    "storageState" "StorageState" NOT NULL DEFAULT 'LOCAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_targets" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "metadataOverride" JSONB NOT NULL DEFAULT '{}',
    "scheduleMode" "ScheduleMode" NOT NULL DEFAULT 'QUEUE_SLOT',
    "scheduledAt" TIMESTAMP(3),
    "status" "PublishTargetStatus" NOT NULL DEFAULT 'PENDING',
    "platformPostId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "lastError" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publish_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_slots" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "rule" JSONB NOT NULL DEFAULT '{}',
    "timeWindows" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "schedule_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_attempts" (
    "id" TEXT NOT NULL,
    "publishTargetId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "outcome" "PublishAttemptOutcome",
    "errorCode" TEXT,
    "errorPayload" JSONB,

    CONSTRAINT "publish_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "incidents" (
    "id" TEXT NOT NULL,
    "kind" "IncidentKind" NOT NULL,
    "severity" "IncidentSeverity" NOT NULL DEFAULT 'MEDIUM',
    "accountId" TEXT,
    "contentItemId" TEXT,
    "publishTargetId" TEXT,
    "title" TEXT NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "status" "IncidentStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "content_items_status_idx" ON "content_items"("status");

-- CreateIndex
CREATE INDEX "content_items_type_idx" ON "content_items"("type");

-- CreateIndex
CREATE INDEX "content_items_deletedAt_idx" ON "content_items"("deletedAt");

-- CreateIndex
CREATE INDEX "assets_contentItemId_kind_idx" ON "assets"("contentItemId", "kind");

-- CreateIndex
CREATE INDEX "assets_storageState_idx" ON "assets"("storageState");

-- CreateIndex
CREATE INDEX "publish_targets_contentItemId_idx" ON "publish_targets"("contentItemId");

-- CreateIndex
CREATE INDEX "publish_targets_accountId_idx" ON "publish_targets"("accountId");

-- CreateIndex
CREATE INDEX "publish_targets_status_scheduledAt_idx" ON "publish_targets"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "schedule_slots_accountId_active_idx" ON "schedule_slots"("accountId", "active");

-- CreateIndex
CREATE INDEX "publish_attempts_publishTargetId_attemptNo_idx" ON "publish_attempts"("publishTargetId", "attemptNo");

-- CreateIndex
CREATE INDEX "incidents_status_severity_idx" ON "incidents"("status", "severity");

-- CreateIndex
CREATE INDEX "incidents_accountId_idx" ON "incidents"("accountId");

-- CreateIndex
CREATE INDEX "incidents_kind_idx" ON "incidents"("kind");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_targets" ADD CONSTRAINT "publish_targets_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_targets" ADD CONSTRAINT "publish_targets_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_attempts" ADD CONSTRAINT "publish_attempts_publishTargetId_fkey" FOREIGN KEY ("publishTargetId") REFERENCES "publish_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_publishTargetId_fkey" FOREIGN KEY ("publishTargetId") REFERENCES "publish_targets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "incidents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
