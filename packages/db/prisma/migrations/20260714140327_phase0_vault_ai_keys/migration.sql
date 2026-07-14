-- CreateEnum
CREATE TYPE "AiProviderKind" AS ENUM ('TEXT', 'TTS', 'MULTIMODAL');

-- CreateEnum
CREATE TYPE "AiKeyStatus" AS ENUM ('ACTIVE', 'COOLDOWN', 'EXHAUSTED', 'DISABLED');

-- CreateTable
CREATE TABLE "ai_providers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AiProviderKind" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "baseConfig" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_keys" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "keyEnc" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "status" "AiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "cooldownUntil" TIMESTAMP(3),
    "limits" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_providers_name_key" ON "ai_providers"("name");

-- CreateIndex
CREATE INDEX "ai_keys_providerId_priority_idx" ON "ai_keys"("providerId", "priority");

-- CreateIndex
CREATE INDEX "ai_keys_status_idx" ON "ai_keys"("status");

-- AddForeignKey
ALTER TABLE "ai_keys" ADD CONSTRAINT "ai_keys_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "ai_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
