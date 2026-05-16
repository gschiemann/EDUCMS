-- VenueOS Sports — Sprint 13. The Sport Engine's persistence layer.
-- A `games` row is one contest; `game_events` is its append-only log.
-- Purely additive (two new tables + their FKs) — safe to apply to the
-- live pilot tenants without touching any existing query path.
--
-- The clock is stored as an ANCHOR: `clock_ms` is the reading at
-- `clock_updated_at`, `clock_running` says whether it's advancing.
-- The board page derives the live clock from those three, so the
-- server never has to tick.

-- CreateTable
CREATE TABLE "games" (
    "id"               TEXT NOT NULL,
    "tenant_id"        TEXT NOT NULL,
    "sport"            TEXT NOT NULL,
    "home_team"        TEXT NOT NULL,
    "away_team"        TEXT NOT NULL,
    "home_score"       INTEGER NOT NULL DEFAULT 0,
    "away_score"       INTEGER NOT NULL DEFAULT 0,
    "segment"          INTEGER NOT NULL DEFAULT 1,
    "clock_ms"         INTEGER NOT NULL DEFAULT 0,
    "clock_running"    BOOLEAN NOT NULL DEFAULT false,
    "clock_updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stats"            JSONB NOT NULL DEFAULT '{}',
    "status"           TEXT NOT NULL DEFAULT 'SCHEDULED',
    "screen_group_id"  TEXT,
    "home_color"       TEXT,
    "away_color"       TEXT,
    "started_at"       TIMESTAMP(3),
    "ended_at"         TIMESTAMP(3),
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"       TIMESTAMP(3) NOT NULL,
    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_events" (
    "id"         TEXT NOT NULL,
    "game_id"    TEXT NOT NULL,
    "type"       TEXT NOT NULL,
    "payload"    JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "game_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "games_tenant_id_status_idx" ON "games"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "game_events_game_id_created_at_idx" ON "game_events"("game_id", "created_at");

-- AddForeignKey
ALTER TABLE "games" ADD CONSTRAINT "games_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_events" ADD CONSTRAINT "game_events_game_id_fkey"
    FOREIGN KEY ("game_id") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;
