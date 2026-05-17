-- VenueOS Sports — broadcast spotlight on the scoreboard.
-- One JSONB column on `games` holding the featured player / promo
-- panel ({ visible, title, photoUrl, subtitle, lines[] }). Additive,
-- defaulted to an empty object — safe for live tenants.

-- AlterTable
ALTER TABLE "games" ADD COLUMN "spotlight" JSONB NOT NULL DEFAULT '{}';
