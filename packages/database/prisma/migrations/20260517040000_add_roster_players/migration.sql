-- VenueOS Sports — player roster.
-- A new table only; fully additive, no change to existing rows.
-- Players carry a headshot URL + a flexible JSON stat map so a
-- scoreboard / ribbon can surface lineups, stat leaders, and
-- player-of-the-game content.
CREATE TABLE "roster_players" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "number" TEXT,
    "position" TEXT,
    "photo_url" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "roster_players_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "roster_players_game_id_team_sort_order_idx"
    ON "roster_players"("game_id", "team", "sort_order");

ALTER TABLE "roster_players"
    ADD CONSTRAINT "roster_players_game_id_fkey"
    FOREIGN KEY ("game_id") REFERENCES "games"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
