-- 2026-09-19 — Screen faces: the columns behind double-sided displays.
--
-- THIS FILE IS THE FIX FOR THE 2026-09-16 PRODUCTION INCIDENT. Commit 684f8576
-- added faceOfScreenId / faceIndex / faceContentMode to schema.prisma and
-- shipped NO migration. Production only ever applies migration files
-- (scripts/railway-start.sh runs `prisma migrate deploy` before node boots —
-- verified in the deploy log of 160901b1: "migrations applied successfully",
-- then "booting the API"). So the new client selected three columns that did
-- not exist, on the table every manifest poll, heartbeat and register reads,
-- and the fleet errored until the code was reverted. The columns were never
-- the hard part; the missing file was.
--
-- ADDITIVE AND NON-DESTRUCTIVE:
--   * three NULLABLE columns with no default — a catalogue-only change in
--     Postgres, instant at any row count, and every existing screen reads as
--     "not a face" (NULL), which is exactly today's behaviour;
--   * one self-referencing FK. Every existing row is NULL, so validation has
--     nothing to check. ON DELETE CASCADE: deleting a display removes its
--     back side, which is what deleting a display means.
--   * nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: ALTER TABLE needs a brief ACCESS EXCLUSIVE lock on "screens".
-- If a long transaction is holding the table, a lock request that WAITS queues
-- every screen's next poll behind it. Five seconds, then fail — railway-start
-- retries six times, and a failed migrate never goes healthy, so Railway keeps
-- the previous deployment serving. Failing loudly beats stalling the fleet.
--
-- IDEMPOTENT (`IF NOT EXISTS` + a guarded constraint) because this repo's dev
-- flow is `pnpm db:push`: a database that already took this shape applies the
-- file as a no-op instead of failing on "column already exists".

SET lock_timeout = '5s';

ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "face_of_screen_id" TEXT,
  ADD COLUMN IF NOT EXISTS "face_index" INTEGER,
  ADD COLUMN IF NOT EXISTS "face_content_mode" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'screens_face_of_screen_id_fkey'
  ) THEN
    ALTER TABLE "screens"
      ADD CONSTRAINT "screens_face_of_screen_id_fkey"
      FOREIGN KEY ("face_of_screen_id") REFERENCES "screens"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
