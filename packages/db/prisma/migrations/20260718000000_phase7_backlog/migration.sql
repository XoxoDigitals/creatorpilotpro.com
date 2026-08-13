-- Phase 7: strike counter, auto-hold siblings, A/B suggestions, best-time-to-post learner

-- Item 8: strike counter + pause reason on SocialAccount
ALTER TABLE "social_accounts" ADD COLUMN "pausedReason" TEXT;
ALTER TABLE "social_accounts" ADD COLUMN "copyrightStrikeCount" INTEGER NOT NULL DEFAULT 0;

-- Item 10: PostSuggestion (A/B title + thumbnail candidates)
CREATE TYPE "PostSuggestionKind" AS ENUM ('TITLE', 'THUMBNAIL_PROMPT');

CREATE TABLE "post_suggestions" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "kind" "PostSuggestionKind" NOT NULL,
    "content" TEXT NOT NULL,
    "rationale" TEXT NOT NULL DEFAULT '',
    "chosen" BOOLEAN NOT NULL DEFAULT false,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "post_suggestions_contentItemId_kind_idx" ON "post_suggestions"("contentItemId", "kind");

ALTER TABLE "post_suggestions" ADD CONSTRAINT "post_suggestions_contentItemId_fkey"
    FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Item 11: BestPostingHour (learner output)
CREATE TABLE "best_posting_hours" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "best_posting_hours_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "best_posting_hours_accountId_dayOfWeek_hour_key" ON "best_posting_hours"("accountId", "dayOfWeek", "hour");
CREATE INDEX "best_posting_hours_accountId_idx" ON "best_posting_hours"("accountId");

ALTER TABLE "best_posting_hours" ADD CONSTRAINT "best_posting_hours_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "social_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
