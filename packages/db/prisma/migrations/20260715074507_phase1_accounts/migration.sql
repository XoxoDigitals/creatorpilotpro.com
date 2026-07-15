-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('YOUTUBE', 'FACEBOOK', 'TIKTOK');

-- CreateEnum
CREATE TYPE "AccountKind" AS ENUM ('YT_CHANNEL', 'FB_PAGE', 'FB_BM_PAGE', 'TIKTOK_ACCOUNT');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('HEALTHY', 'EXPIRING', 'BROKEN');

-- CreateEnum
CREATE TYPE "ConnectionMethod" AS ENUM ('POSTQUED', 'OWN_APP');

-- CreateEnum
CREATE TYPE "AccountContentType" AS ENUM ('AI', 'REPURPOSED', 'MIXED');

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "kind" "AccountKind" NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT,
    "avatarUrl" TEXT,
    "authPayload" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "connectionStatus" "ConnectionStatus" NOT NULL DEFAULT 'HEALTHY',
    "connectionMethod" "ConnectionMethod" NOT NULL,
    "contentType" "AccountContentType" NOT NULL DEFAULT 'AI',
    "dramasEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monetized" BOOLEAN NOT NULL DEFAULT false,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "addedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_profiles" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "masterPrompt" TEXT NOT NULL DEFAULT '',
    "writingStyle" TEXT NOT NULL DEFAULT '',
    "narrationStyle" TEXT NOT NULL DEFAULT '',
    "language" TEXT NOT NULL DEFAULT 'en',
    "voiceSettings" JSONB NOT NULL DEFAULT '{}',
    "titleTemplate" TEXT NOT NULL DEFAULT '',
    "descriptionTemplate" TEXT NOT NULL DEFAULT '',
    "defaultTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiLabelDefault" BOOLEAN NOT NULL DEFAULT true,
    "approvalPolicy" JSONB NOT NULL DEFAULT '{}',
    "schedulingPrefs" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "social_accounts_platform_idx" ON "social_accounts"("platform");

-- CreateIndex
CREATE INDEX "social_accounts_connectionStatus_idx" ON "social_accounts"("connectionStatus");

-- CreateIndex
CREATE INDEX "social_accounts_deletedAt_idx" ON "social_accounts"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_platform_externalId_key" ON "social_accounts"("platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "channel_profiles_accountId_key" ON "channel_profiles"("accountId");

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "channel_profiles" ADD CONSTRAINT "channel_profiles_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
