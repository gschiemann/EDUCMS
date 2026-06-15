-- Add the per-type board cue/event index. The board reads game_events with
-- WHERE game_id = ? AND type = ? ORDER BY created_at, which the existing
-- (game_id, created_at) index can't serve on the `type` predicate — Postgres
-- was scanning all events for the game and filtering in memory (live 33.5%
-- seq-scan ratio). Name matches Prisma's @@index([gameId, type, createdAt])
-- convention so there is no schema drift. (2026-06-15 DB-efficiency Wave 1)
CREATE INDEX IF NOT EXISTS "game_events_game_id_type_created_at_idx"
  ON "game_events" ("game_id", "type", "created_at");
