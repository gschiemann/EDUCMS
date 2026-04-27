-- v1.0.12 — Per-phase OTA progress reported by the Android player.
-- Lets the dashboard show real progress (CHECKING → DOWNLOADING X% →
-- VERIFYING → INSTALLING → INSTALLED|ERROR) instead of the time-based
-- stage theater that was killing operator trust.
ALTER TABLE "screens" ADD COLUMN "last_ota_state" TEXT;
ALTER TABLE "screens" ADD COLUMN "last_ota_progress" INT;
ALTER TABLE "screens" ADD COLUMN "last_ota_message" TEXT;
ALTER TABLE "screens" ADD COLUMN "last_ota_at" TIMESTAMP(3);
