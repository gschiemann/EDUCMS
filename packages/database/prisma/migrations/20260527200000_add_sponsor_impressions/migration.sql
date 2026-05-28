-- VenueOS Sports — T2-9 per-impression log for real sponsor proof-of-play.
-- Additive migration: new table only, no existing column changes.
-- Generated with --create-only on 2026-05-27; applied by the lead on merge.

CREATE TABLE "sponsor_impressions" (
    "id"           TEXT NOT NULL,
    "sponsor_id"   TEXT NOT NULL,
    "game_id"      TEXT NOT NULL,
    "surface_kind" TEXT NOT NULL,
    "ts"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sponsor_impressions_pkey" PRIMARY KEY ("id")
);

-- FK: cascade delete when sponsor is deleted
ALTER TABLE "sponsor_impressions"
    ADD CONSTRAINT "sponsor_impressions_sponsor_id_fkey"
    FOREIGN KEY ("sponsor_id") REFERENCES "sponsors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Covering indexes for the two main access patterns:
--   1. per-sponsor timeline (proof-of-play report)
--   2. per-game timeline (game-level sponsor report)
CREATE INDEX "sponsor_impressions_sponsor_id_ts_idx"
    ON "sponsor_impressions"("sponsor_id", "ts");

CREATE INDEX "sponsor_impressions_game_id_ts_idx"
    ON "sponsor_impressions"("game_id", "ts");
