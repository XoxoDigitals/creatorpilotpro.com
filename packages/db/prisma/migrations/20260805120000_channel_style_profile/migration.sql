-- Structured brand/style questionnaire for ChannelProfile (Master prompt & styles).
ALTER TABLE "channel_profiles" ADD COLUMN "styleProfile" JSONB NOT NULL DEFAULT '{}';
