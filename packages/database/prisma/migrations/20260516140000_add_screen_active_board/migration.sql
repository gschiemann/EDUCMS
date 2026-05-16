-- VenueOS Sports — Sprint 13 Phase 3. Push a live scoreboard to a screen.
-- One nullable column on `screens`: when set, the screen's manifest
-- serves the scoreboard for that game instead of its scheduled
-- playlist. No FK — the manifest endpoint tolerates a stale id and
-- deleteGame() clears it. The single safest possible migration:
-- a nullable ADD COLUMN with no constraint and no default.

-- AlterTable
ALTER TABLE "screens" ADD COLUMN "active_board_game_id" TEXT;
