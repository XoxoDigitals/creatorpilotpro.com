-- AI-only owner flow MVP: reference-channel URL/role, idea categories,
-- package lifecycle, and creative-package fields on production briefs.

CREATE TYPE "idea_category" AS ENUM ('RELEVANT', 'SIMILAR', 'UNIQUE');
CREATE TYPE "package_status" AS ENUM ('NONE', 'GENERATING', 'READY', 'DONE');
CREATE TYPE "competitor_channel_role" AS ENUM ('COMPETITOR', 'SOURCE');

ALTER TABLE "competitor_channels"
  ADD COLUMN "channelUrl" TEXT,
  ADD COLUMN "role" "competitor_channel_role" NOT NULL DEFAULT 'COMPETITOR';

ALTER TABLE "competitor_channels"
  ALTER COLUMN "checkIntervalMin" SET DEFAULT 1440;

ALTER TABLE "ideas"
  ADD COLUMN "category" "idea_category",
  ADD COLUMN "packageStatus" "package_status" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "requestedVideoDurationSec" INTEGER,
  ADD COLUMN "requestedClipDurationSec" INTEGER;

ALTER TABLE "production_briefs"
  ADD COLUMN "videoTitle" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "videoDescription" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "thumbnailPrompt" TEXT NOT NULL DEFAULT '';
