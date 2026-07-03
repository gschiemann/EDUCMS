-- 2026-07-02 — Sports Wave S4-1 (P1-8, deep-pass audit finding): games had
-- no date/time. The New Game create modal never asked, the game list was
-- ungrouped/undated, and COUNTDOWN/PreGameScene had no target to count down
-- to.
--
-- This column is a plain nullable DateTime — no default, no backfill:
--   - Every existing Game row (and every game created before this shipped)
--     becomes NULL, which stays perfectly legal everywhere (create/update/
--     list/board all treat NULL as "no scheduled time set").
--   - When set, the web game list uses it to order upcoming games and
--     render "Tonight 7:00 PM" style copy; a future COUNTDOWN wiring can
--     target it.
--
-- Additive-only. Safe to apply on the live pilot tenant with zero downtime.
ALTER TABLE "games"
  ADD COLUMN IF NOT EXISTS "scheduled_at" TIMESTAMP(3);

-- Serves the tenant-scoped "upcoming games ordered by scheduledAt" list
-- query. Matches Prisma's @@index([tenantId, scheduledAt]) on model Game.
CREATE INDEX IF NOT EXISTS "games_tenant_id_scheduled_at_idx"
  ON "games"("tenant_id", "scheduled_at");
