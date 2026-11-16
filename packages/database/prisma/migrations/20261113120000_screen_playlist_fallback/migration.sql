-- 2026-11-13 — Screen.playlistFallback: this screen is showing a BACKUP playlist.
--
-- When the playlist scheduled on a screen has nothing the screen can play,
-- the web player — as a last resort, after two minutes on its "Content
-- unavailable" card — shows the next scheduled playlist instead. The owner's
-- rule: the admin must be told, and the dashboard must never present that as
-- healthy. The player now reports the two playlist ids on its telemetry
-- post; this column holds the current state as the SERVER verified it (both
-- playlists looked up inside the screen's own tenant, their names read
-- server-side, the moment it began). NULL = the schedule's own choice plays.
-- Telemetry-only — it never busts the manifest cache.
--
-- ADDITIVE AND NON-DESTRUCTIVE: one NULLABLE column with no default, a
-- catalogue-only change at any row count; every existing screen reads NULL
-- ("not on a backup playlist"), which is today's behaviour. Nothing is
-- dropped, renamed or rewritten.
--
-- `lock_timeout`: ALTER TABLE needs a brief ACCESS EXCLUSIVE lock on the hot
-- "screens" table; fail after five seconds instead of queueing the fleet's
-- polls behind a long transaction (pattern: 20260919120000_screen_faces).
--
-- IDEMPOTENT (`IF NOT EXISTS`) because dev databases take the shape via
-- `pnpm db:push` first.

SET lock_timeout = '5s';

ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "playlist_fallback" JSONB;
