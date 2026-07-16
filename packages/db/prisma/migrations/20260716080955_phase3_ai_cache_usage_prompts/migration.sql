-- AlterTable
ALTER TABLE "ai_keys" ADD COLUMN     "dayWindowStartAt" TIMESTAMP(3),
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "minuteWindowStartAt" TIMESTAMP(3),
ADD COLUMN     "requestsInDay" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "requestsInMinute" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tokensInMinute" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ai_outputs" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "providerId" TEXT,
    "model" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL DEFAULT 1,
    "output" JSONB NOT NULL,
    "audioRef" TEXT,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "ttsSeconds" DOUBLE PRECISION,
    "contentItemId" TEXT,
    "hitCount" INTEGER NOT NULL DEFAULT 0,
    "lastHitAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_log" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "providerId" TEXT,
    "keyId" TEXT,
    "model" TEXT NOT NULL,
    "contentItemId" TEXT,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "tokensIn" INTEGER,
    "tokensOut" INTEGER,
    "ttsSeconds" DOUBLE PRECISION,
    "estimatedCostUsd" DECIMAL(10,6),
    "errorClass" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT,
    "task" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "template" TEXT NOT NULL,
    "schemaHint" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_outputs_cacheKey_key" ON "ai_outputs"("cacheKey");

-- CreateIndex
CREATE INDEX "ai_outputs_task_model_idx" ON "ai_outputs"("task", "model");

-- CreateIndex
CREATE INDEX "ai_outputs_contentItemId_idx" ON "ai_outputs"("contentItemId");

-- CreateIndex
CREATE INDEX "ai_usage_log_createdAt_idx" ON "ai_usage_log"("createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_log_providerId_createdAt_idx" ON "ai_usage_log"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_log_contentItemId_idx" ON "ai_usage_log"("contentItemId");

-- CreateIndex
CREATE INDEX "ai_usage_log_keyId_idx" ON "ai_usage_log"("keyId");

-- CreateIndex
CREATE INDEX "prompt_versions_accountId_task_isActive_idx" ON "prompt_versions"("accountId", "task", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_accountId_task_name_version_key" ON "prompt_versions"("accountId", "task", "name", "version");

-- CreateIndex
CREATE INDEX "ai_keys_providerId_status_lastUsedAt_idx" ON "ai_keys"("providerId", "status", "lastUsedAt");

-- AddForeignKey
ALTER TABLE "ai_usage_log" ADD CONSTRAINT "ai_usage_log_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "ai_keys"("id") ON DELETE SET NULL ON UPDATE CASCADE;
