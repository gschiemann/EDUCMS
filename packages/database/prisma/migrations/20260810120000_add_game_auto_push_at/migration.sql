-- 2026-08-10 — Inputs-wave SCHED: schedule game mode (additive).
--
-- When an operator ARMS a game for automatic pushing (Setup → "Tonight's
-- game"), this column holds the moment the board should go up on the
-- selected screens: scheduledAt − 10 minutes (a baked default, no knob).
-- The GameScheduleService sweep (apps/api/src/sports/game-schedule.service.ts)
-- claims due rows with a single atomic UPDATE … SET auto_push_at = NULL
-- WHERE auto_push_at <= NOW() RETURNING …, so two replicas can never
-- double-fire the same game (the webhook-retry claim-by-write pattern).
-- NULL means "nothing pending": not armed, already pushed, cancelled at
-- FINAL, or disarmed. Which screens/surface to push (and the saved state
-- to restore at FINAL) rides a latest-wins AUTO_PUSH GameEvent — no new
-- table.
--
-- The index serves the sweep's tenant-less scan predicate
-- (WHERE auto_push_at <= NOW()) — the existing (tenant_id, …) indexes
-- can't, same reason games_status_clock_running_idx exists for the clock
-- sweep. Name matches Prisma's @@index([autoPushAt]) on model Game so
-- `migrate deploy` and the schema stay in agreement.
--
-- Additive-only. Nullable, no default needed — every existing Game row
-- reads as "no auto-push pending", which is exactly today's behavior.
-- Safe to apply on the live pilot tenant with zero downtime.
ALTER TABLE "games"
  ADD COLUMN "auto_push_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "games_auto_push_at_idx"
  ON "games"("auto_push_at");
