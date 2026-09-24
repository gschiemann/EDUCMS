-- 2026-09-24 — Screen video playback quality: the dropped-frame sample the
-- player reports for the last <video> it played, so "did that clip stutter
-- on the wall?" is answered by the device rather than guessed.
--
-- ADDITIVE AND NON-DESTRUCTIVE: two NULLABLE columns with no default — a
-- catalogue-only change in Postgres, instant at any row count. Every existing
-- screen reads as "no sample yet" (NULL), which is exactly today's behaviour.
-- Nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: ALTER TABLE needs a brief ACCESS EXCLUSIVE lock on "screens",
-- the table every manifest poll and heartbeat reads. Five seconds, then fail —
-- railway-start retries, and a failed migrate never goes healthy, so Railway
-- keeps the previous deployment serving. Failing loudly beats stalling the
-- fleet behind a lock.
--
-- IDEMPOTENT (`IF NOT EXISTS`) because this repo's dev flow is `pnpm db:push`:
-- a database that already took this shape applies the file as a no-op.

SET lock_timeout = '5s';

ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "last_video_report" JSONB,
  ADD COLUMN IF NOT EXISTS "last_video_report_at" TIMESTAMP(3);
