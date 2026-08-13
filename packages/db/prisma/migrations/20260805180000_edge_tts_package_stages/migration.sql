-- Audio-first narration package stages + Edge TTS metadata on production_briefs.
-- Also extend package_status with FAILED.

ALTER TYPE "package_status" ADD VALUE IF NOT EXISTS 'FAILED';

CREATE TYPE "package_stage" AS ENUM (
  'NONE',
  'SCRIPT',
  'VOICE',
  'TRANSCRIPT',
  'VISUALS',
  'READY',
  'FAILED'
);

ALTER TABLE "production_briefs"
  ADD COLUMN IF NOT EXISTS "packageStage" "package_stage" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "packageStageError" TEXT,
  ADD COLUMN IF NOT EXISTS "timedTranscript" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "transcriptLocalPath" TEXT,
  ADD COLUMN IF NOT EXISTS "voiceIdUsed" TEXT;
