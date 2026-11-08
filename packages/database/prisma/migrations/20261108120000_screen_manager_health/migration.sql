-- 2026-11-08 — companion Manager health + crash-report authentication.
--
-- Screen.managerHealthReport / managerHealthReportAt: the companion's own
-- health facts (watchdog tick, relaunches with reason, rollback / quarantine,
-- install permission, a pending Install tap, its version), read by the Player
-- from the Manager's provider and carried on the Player's device-authenticated
-- heartbeat. Screen.lastCrashAuthenticated: whether the last crash report's
-- caller proved the screen's credential (a Manager crash relayed by the Player
-- does; Manager 1.0.24's anonymous post does not). All three are telemetry-only
-- (SCREEN_TELEMETRY_ONLY_FIELDS) — they never bust the manifest cache.
--
-- ADDITIVE AND NON-DESTRUCTIVE: three NULLABLE columns with no default, a
-- catalogue-only change at any row count; every existing screen reads NULL
-- ("no companion health reported" / "unknown"), which is today's behaviour.
-- Nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: ALTER TABLE needs a brief ACCESS EXCLUSIVE lock on the hot
-- "screens" table; fail after five seconds instead of queueing the fleet's
-- polls behind a long transaction (pattern: 20260919120000_screen_faces).
--
-- IDEMPOTENT (`IF NOT EXISTS`) because dev databases take the shape via
-- `pnpm db:push` first.

SET lock_timeout = '5s';

ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "manager_health_report" JSONB,
  ADD COLUMN IF NOT EXISTS "manager_health_report_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_crash_authenticated" BOOLEAN;
