-- Track when an asset binary was uploaded to Google Drive (12h embed readiness).
ALTER TABLE "assets" ADD COLUMN "driveUploadedAt" TIMESTAMP(3);

-- Existing Drive copies: start the readiness clock from last asset update.
UPDATE "assets"
SET "driveUploadedAt" = "updatedAt"
WHERE "driveFileId" IS NOT NULL AND "driveUploadedAt" IS NULL;
