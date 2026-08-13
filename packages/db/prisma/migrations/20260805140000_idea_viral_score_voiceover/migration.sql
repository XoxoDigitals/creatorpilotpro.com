-- Idea viral score + creative-package voiceover status for AI-owner workflow.

CREATE TYPE "voiceover_status" AS ENUM ('NONE', 'GENERATING', 'READY', 'FAILED');

ALTER TABLE "ideas"
  ADD COLUMN "viralScore" INTEGER;

ALTER TABLE "production_briefs"
  ADD COLUMN "voiceoverStatus" "voiceover_status" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "voiceoverLocalPath" TEXT;
