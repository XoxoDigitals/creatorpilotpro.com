-- Phase 8: expand analytics with detailed audience, geo, retention, device metrics

-- Account-level additions
ALTER TABLE "metric_snapshot_accounts"
    ADD COLUMN "uniqueViewers"     INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN "retentionRate"     DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "trafficCountries"  JSONB            NOT NULL DEFAULT '[]',
    ADD COLUMN "ageGroups"         JSONB            NOT NULL DEFAULT '[]',
    ADD COLUMN "genderSplit"       JSONB            NOT NULL DEFAULT '{}',
    ADD COLUMN "trafficSources"    JSONB            NOT NULL DEFAULT '[]',
    ADD COLUMN "deviceSplit"       JSONB            NOT NULL DEFAULT '[]';

-- Post-level additions
ALTER TABLE "metric_snapshot_posts"
    ADD COLUMN "uniqueViewers"           INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN "saves"                   INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN "averageViewDurationSec"  INTEGER          NOT NULL DEFAULT 0,
    ADD COLUMN "retentionRate"           DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "trafficCountries"        JSONB            NOT NULL DEFAULT '[]',
    ADD COLUMN "ageGroups"               JSONB            NOT NULL DEFAULT '[]',
    ADD COLUMN "genderSplit"             JSONB            NOT NULL DEFAULT '{}',
    ADD COLUMN "trafficSources"          JSONB            NOT NULL DEFAULT '[]',
    ADD COLUMN "deviceSplit"             JSONB            NOT NULL DEFAULT '[]';
