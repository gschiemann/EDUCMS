-- VenueOS Sports — team brand logos on the scoreboard.
-- Two nullable columns on `games`: the home and away team logo URLs,
-- rendered on the live board + the broadcast scorebug. Additive,
-- nullable, no constraint — the safest possible migration.

-- AlterTable
ALTER TABLE "games" ADD COLUMN "home_logo_url" TEXT;
ALTER TABLE "games" ADD COLUMN "away_logo_url" TEXT;
