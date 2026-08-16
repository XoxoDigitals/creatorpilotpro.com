-- Default account timezone to Pakistan; migrate legacy UTC rows.
ALTER TABLE "social_accounts" ALTER COLUMN "timezone" SET DEFAULT 'Asia/Karachi';

UPDATE "social_accounts"
SET "timezone" = 'Asia/Karachi'
WHERE "timezone" = 'UTC' OR "timezone" = '' OR "timezone" IS NULL;
