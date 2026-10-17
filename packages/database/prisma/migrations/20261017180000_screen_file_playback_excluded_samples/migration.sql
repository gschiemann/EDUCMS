-- 2026-10-17 — Player rock-solid program §4B (demotion sample guard):
-- docs/research/2026-10-17-player-rock-solid/00-PLAN.md.
--
-- A playback sample inside the 3 minutes after a page load, an engine change,
-- a native hand-off or a player update — or one the browser played while the
-- screen should be on its hardware engine — is RECORDED but never graded
-- (`playbackSampleExclusion`, @cms/api-types). These four columns are that
-- record on the per-(screen, file) evidence row:
--   excluded_reason   why the most recent excluded sample was not graded
--   excluded_at       when it arrived
--   excluded_until    the window a detected event left open for the next
--                     samples of the same file
--   excluded_samples  how many samples were recorded without grading
--
-- Generated with `prisma migrate diff --from-schema-datamodel <old>
-- --to-schema-datamodel <new> --script`, then made idempotent by hand (dev
-- databases take the shape through `pnpm db:push` first).
--
-- ADDITIVE ONLY: three nullable columns and one NOT NULL column with a
-- constant default — catalogue-only in Postgres 11+, instant at any row count,
-- and every existing row reads as "nothing excluded yet" (NULL / 0), which is
-- exactly today's behaviour. Nothing is dropped, renamed or rewritten, and
-- "screens" is not touched. The table is telemetry, never manifest-fed.
--
-- `lock_timeout`: telemetry upserts this table on every video report. ALTER
-- TABLE needs a brief ACCESS EXCLUSIVE lock; five seconds, then fail
-- (railway-start retries; a failed migrate never goes healthy, so the previous
-- deployment keeps serving) rather than queue the fleet's reports.

SET lock_timeout = '5s';

ALTER TABLE "screen_file_playback"
  ADD COLUMN IF NOT EXISTS "excluded_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "excluded_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "excluded_samples" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "excluded_until" TIMESTAMP(3);
