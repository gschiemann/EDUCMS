-- 2026-09-26 — K-12 sports launch program, lane A1: corrections, concurrency,
-- atomicity (Codex readiness audit K12-F09 / F10 / F11 / F12 / F13 / F34 / F39).
--
-- DDL generated with `prisma migrate diff --from-schema-datamodel <master>
-- --to-schema-datamodel <this branch> --script`, then made idempotent.
--
--   games.version            — the game-state revision every command
--                              compare-and-swaps on (F12).
--   game_events.command_id / actor_type / actor_user_id / revision
--                            — who produced each event, and at which revision
--                              (F34). All nullable: old rows read as
--                              unattributed, which is the truth.
--   game_commands            — durable per-command receipt, unique on
--                              (game_id, command_id): a replayed command is a
--                              no-op that returns the original response (F10);
--                              also the single-use undo claim (F09).
--   game_stat_rollups        — durable, correction-aware player-stat roll-up
--                              state per game (F39).
--
-- ADDITIVE AND NON-DESTRUCTIVE. Nothing is dropped, renamed or rewritten:
--   * `games.version` is NOT NULL with a constant DEFAULT 0 — a catalogue-only
--     change in Postgres 11+ (no table rewrite), instant at any row count;
--   * the four game_events columns are nullable with no default — catalogue
--     only, instant;
--   * two new tables, their indexes, and FKs to games (ON DELETE CASCADE, the
--     same lifetime as game_events).
--
-- `lock_timeout`: the two ALTER TABLEs need a brief ACCESS EXCLUSIVE lock on
-- "games" / "game_events", which every live scoreboard poll and score tap
-- touches. Five seconds, then fail — railway-start retries, and a failed
-- migrate never goes healthy, so the previous deployment keeps serving.
--
-- IDEMPOTENT (IF NOT EXISTS + guarded constraints) because the dev flow is
-- `pnpm db:push`: a database that already took this shape applies the file as
-- a no-op instead of failing on "already exists". Proven on a scratch
-- Postgres 16: applied twice over the master schema, both runs exit 0.

SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "game_events"
  ADD COLUMN IF NOT EXISTS "actor_type" TEXT,
  ADD COLUMN IF NOT EXISTS "actor_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "command_id" TEXT,
  ADD COLUMN IF NOT EXISTS "revision" INTEGER;

-- CreateTable
CREATE TABLE IF NOT EXISTS "game_commands" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "command_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_ref" TEXT,
    "revision_before" INTEGER NOT NULL,
    "revision_after" INTEGER NOT NULL,
    "response" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "game_stat_rollups" (
    "game_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "target_revision" INTEGER NOT NULL,
    "applied_revision" INTEGER,
    "contribution" JSONB NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "game_stat_rollups_pkey" PRIMARY KEY ("game_id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "game_commands_tenant_id_created_at_idx" ON "game_commands"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "game_commands_game_id_command_id_key" ON "game_commands"("game_id", "command_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "game_stat_rollups_state_updated_at_idx" ON "game_stat_rollups"("state", "updated_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "game_stat_rollups_tenant_id_idx" ON "game_stat_rollups"("tenant_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_commands_game_id_fkey'
  ) THEN
    ALTER TABLE "game_commands"
      ADD CONSTRAINT "game_commands_game_id_fkey"
      FOREIGN KEY ("game_id") REFERENCES "games"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'game_stat_rollups_game_id_fkey'
  ) THEN
    ALTER TABLE "game_stat_rollups"
      ADD CONSTRAINT "game_stat_rollups_game_id_fkey"
      FOREIGN KEY ("game_id") REFERENCES "games"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
