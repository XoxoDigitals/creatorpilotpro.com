-- CreateEnum
CREATE TYPE "WatchedSourceType" AS ENUM ('KUAISHOU_PROFILE', 'GENERIC_URL');

-- CreateEnum
CREATE TYPE "WatchedSourceStatus" AS ENUM ('ACTIVE', 'PAUSED', 'ERROR');

-- CreateEnum
CREATE TYPE "DownloadStatus" AS ENUM ('PENDING', 'DOWNLOADING', 'DONE', 'FAILED', 'SKIPPED_DUPLICATE');

-- CreateTable
CREATE TABLE "watched_sources" (
    "id" TEXT NOT NULL,
    "type" "WatchedSourceType" NOT NULL,
    "url" TEXT NOT NULL,
    "label" TEXT,
    "checkIntervalMin" INTEGER NOT NULL DEFAULT 360,
    "trimStartMs" INTEGER NOT NULL DEFAULT 500,
    "lastCheckedAt" TIMESTAMP(3),
    "status" "WatchedSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "errorNote" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "targetAccountId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "watched_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_videos" (
    "id" TEXT NOT NULL,
    "watchedSourceId" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "sourcePlatformId" TEXT NOT NULL,
    "uploaderName" TEXT,
    "title" TEXT,
    "durationSec" DOUBLE PRECISION,
    "publishedAt" TIMESTAMP(3),
    "perceptualHash" TEXT,
    "md5" TEXT,
    "downloadStatus" "DownloadStatus" NOT NULL DEFAULT 'PENDING',
    "rightsNote" TEXT,
    "rightsConfirmedById" TEXT,
    "nearDuplicateOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_videos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "watched_sources_status_idx" ON "watched_sources"("status");

-- CreateIndex
CREATE INDEX "watched_sources_targetAccountId_idx" ON "watched_sources"("targetAccountId");

-- CreateIndex
CREATE INDEX "watched_sources_deletedAt_idx" ON "watched_sources"("deletedAt");

-- CreateIndex
CREATE INDEX "source_videos_perceptualHash_idx" ON "source_videos"("perceptualHash");

-- CreateIndex
CREATE INDEX "source_videos_downloadStatus_idx" ON "source_videos"("downloadStatus");

-- CreateIndex
CREATE UNIQUE INDEX "source_videos_watchedSourceId_sourcePlatformId_key" ON "source_videos"("watchedSourceId", "sourcePlatformId");

-- AddForeignKey
ALTER TABLE "watched_sources" ADD CONSTRAINT "watched_sources_targetAccountId_fkey" FOREIGN KEY ("targetAccountId") REFERENCES "social_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_videos" ADD CONSTRAINT "source_videos_watchedSourceId_fkey" FOREIGN KEY ("watchedSourceId") REFERENCES "watched_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "source_videos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
