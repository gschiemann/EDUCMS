-- 2026-11-02 — Screen.softBlankAt: the soft BLANK overlay is on the glass.
--
-- The web player's soft BLANK draws a black overlay and reported nothing, so
-- the dashboard's Sleep/Awake control kept reading "Awake" after a soft
-- Sleep. The player now reports it on its telemetry post; this column holds
-- the server clock of the latest report that said true (NULL once one says
-- false). Telemetry-only — it never busts the manifest cache.
--
-- ADDITIVE AND NON-DESTRUCTIVE: one NULLABLE column with no default, a
-- catalogue-only change at any row count; every existing screen reads NULL
-- ("not soft-blanked"), which is today's behaviour. Nothing is dropped,
-- renamed or rewritten.
--
-- `lock_timeout`: ALTER TABLE needs a brief ACCESS EXCLUSIVE lock on the hot
-- "screens" table; fail after five seconds instead of queueing the fleet's
-- polls behind a long transaction (pattern: 20260919120000_screen_faces).
--
-- IDEMPOTENT (`IF NOT EXISTS`) because dev databases take the shape via
-- `pnpm db:push` first.

SET lock_timeout = '5s';

ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "soft_blank_at" TIMESTAMP(3);
