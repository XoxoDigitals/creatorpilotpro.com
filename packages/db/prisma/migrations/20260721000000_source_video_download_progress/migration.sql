-- Live download progress for source videos (yt-dlp progress stream → UI bar/ETA).
ALTER TABLE "source_videos"
    ADD COLUMN "downloadPercent"  DOUBLE PRECISION NOT NULL DEFAULT 0,
    ADD COLUMN "downloadEtaSec"   INTEGER,
    ADD COLUMN "downloadSpeedBps" INTEGER;
