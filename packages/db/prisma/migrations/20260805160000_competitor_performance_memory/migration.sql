-- Persist reference-channel performance insights (channel memory) for idea gen.

ALTER TABLE "competitor_channels"
  ADD COLUMN "performanceMemory" JSONB,
  ADD COLUMN "performanceAnalyzedAt" TIMESTAMP(3);
