-- Owner thumbnail style/template used when generating package thumbnail prompts.
ALTER TABLE "channel_profiles" ADD COLUMN "thumbnailReferencePrompt" TEXT NOT NULL DEFAULT '';
