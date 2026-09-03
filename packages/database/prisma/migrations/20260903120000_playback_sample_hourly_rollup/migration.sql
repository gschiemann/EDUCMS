-- Proof-of-play hourly rollup (2026-09-02 efficiency/scale audit, finding L4).
--
-- `playback_samples` grows at one row per ONLINE screen per 10 minutes:
-- ~144,000 rows/day at 1,000 screens, ~13M inside the 90-day retention
-- window, all of it re-aggregated on every report view. Retention alone
-- cannot fix that — retention is what deletes the numbers the report shows.
--
-- These two tables let the report keep every number while the raw stream is
-- kept for only ~14 days:
--
--   playback_sample_hours  one row per (tenant, screen, playlist, UTC hour)
--                          with a sample COUNT. Every figure the report
--                          renders (samples by playlist, samples by screen,
--                          the total) is a SUM over this table, so nothing is
--                          approximated.
--
--   playback_rollup_state  ONE row holding the instant through which every
--                          hour has been fully aggregated. It advances inside
--                          the same transaction that writes an hour's rows,
--                          so it can never point past a partial write, and it
--                          is a stored value rather than MAX(hour_start)
--                          because an idle hour writes no rows and would
--                          stall a derived watermark forever.
--
-- LOAD-BEARING INTERLOCK: the raw purge cuts at
-- min(PROOF_OF_PLAY_RETENTION_DAYS, rolled_through). Applying this migration
-- without running the rollup service simply keeps raw data — it can never
-- delete a sample that was not aggregated first.
--
-- Purely additive: two new tables, no existing table altered, idempotent
-- (IF NOT EXISTS) so it is safe to paste into the Supabase SQL editor and
-- safe for `prisma migrate deploy` / `prisma db push` to apply afterwards.

CREATE TABLE IF NOT EXISTS "playback_sample_hours" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "screen_id" TEXT NOT NULL,
  "playlist_id" TEXT NOT NULL,
  "hour_start" TIMESTAMP(3) NOT NULL,
  "samples" INTEGER NOT NULL,

  CONSTRAINT "playback_sample_hours_pkey" PRIMARY KEY ("id")
);

-- The rollup upserts on exactly this tuple (ON CONFLICT DO UPDATE SET
-- samples = EXCLUDED.samples), which is what makes re-running an hour after a
-- crash or a lost lease idempotent instead of double-counting.
CREATE UNIQUE INDEX IF NOT EXISTS "playback_sample_hours_key"
  ON "playback_sample_hours"("tenant_id", "screen_id", "playlist_id", "hour_start");

-- Report hot path: aggregate inside a per-tenant window.
CREATE INDEX IF NOT EXISTS "playback_sample_hours_tenant_id_hour_start_idx"
  ON "playback_sample_hours"("tenant_id", "hour_start");

-- Retention sweep.
CREATE INDEX IF NOT EXISTS "playback_sample_hours_hour_start_idx"
  ON "playback_sample_hours"("hour_start");

CREATE TABLE IF NOT EXISTS "playback_rollup_state" (
  "id" TEXT NOT NULL,
  "rolled_through" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "playback_rollup_state_pkey" PRIMARY KEY ("id")
);
