-- Add APK-version reporting columns to the screens table so the
-- /screens list can show each kiosk's current player build.
-- All three columns are nullable: browser-based players never fill
-- them, and paired APKs populate them the first time OtaUpdateWorker
-- runs (within 6h of pairing, or on next boot — whichever is first).

ALTER TABLE "screens"
  ADD COLUMN "player_version"       TEXT,
  ADD COLUMN "player_version_code"  INTEGER,
  ADD COLUMN "player_version_at"    TIMESTAMP(3);
