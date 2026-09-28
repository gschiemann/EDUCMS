-- 2026-09-27 — K-12 sports launch program, lane A3: a versioned rules profile
-- bound to every game (Codex readiness audit K12-F01).
--
-- DDL generated with `prisma migrate diff --from-schema-datamodel <master>
-- --to-schema-datamodel <this branch> --script`, then made idempotent.
--
--   games.rules_profile — the profile key the game runs, e.g.
--                         'nfhs-basketball@2026-27'.
--   games.rules         — the snapshot of every rule value it runs
--                         (@cms/api-types sports-rules.ts `GameRules`).
--
-- ADDITIVE AND NON-DESTRUCTIVE: two nullable columns with no default — a
-- catalogue-only change in Postgres 11+, instant at any row count. Existing
-- rows are NOT backfilled on purpose: NULL means "created before rules
-- profiles existed", and those games keep running the classic base
-- definition exactly as they did (a game in progress or a finished result is
-- never rewritten). A not-yet-started game is moved to a profile only by the
-- audited rules change the table makes.
--
-- `lock_timeout`: the ALTER needs a brief ACCESS EXCLUSIVE lock on "games",
-- which every live scoreboard poll and score tap touches. Five seconds, then
-- fail — railway-start retries, and a failed migrate never goes healthy, so
-- the previous deployment keeps serving.
--
-- IDEMPOTENT (IF NOT EXISTS) because the dev flow is `pnpm db:push`: a
-- database that already took this shape applies the file as a no-op.

SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "games"
  ADD COLUMN IF NOT EXISTS "rules" JSONB,
  ADD COLUMN IF NOT EXISTS "rules_profile" TEXT;
