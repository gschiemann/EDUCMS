-- 2026-10-12 — Video guarantee, steps 5–8 (owner decisions A/B/C, 2026-10-12):
-- the closed loop that moves a screen with PROVEN, VISIBLE stutter on a fully
-- cached original to that file's validated 1080p copy, and the once-a-day ops
-- alert when no lighter copy exists.
-- Design: docs/research/2026-10-11-launch-readiness/02-video-guarantee.md §4.7.
--
-- Generated with `prisma migrate diff --from-schema-datamodel <old>
-- --to-schema-datamodel <new> --script`, then made idempotent by hand (dev
-- databases take the shape through `pnpm db:push` first), plus the one thing
-- Prisma's schema language cannot express: the PARTIAL unique index that keeps
-- one ACTIVE demotion per (screen, source digest).
--
-- ADDITIVE ONLY: two nullable/defaulted columns on "screen_file_playback"
-- (telemetry, not manifest-fed), one new table, three indexes, one foreign key
-- to "screens". Nothing on "screens" itself changes.
--
-- `lock_timeout`: the foreign key that REFERENCES "screens" takes a brief SHARE
-- ROW EXCLUSIVE lock on the table every manifest poll and heartbeat touches.
-- Five seconds, then fail (railway-start retries) rather than queue the fleet.

SET lock_timeout = '5s';

ALTER TABLE "screen_file_playback" ADD COLUMN IF NOT EXISTS "stutter_alerted_at" TIMESTAMP(3);
ALTER TABLE "screen_file_playback" ADD COLUMN IF NOT EXISTS "visible_bad_streak" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "screen_playback_demotions" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "screen_id" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "asset_id" TEXT,
    "from_rung" TEXT NOT NULL,
    "to_rung" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cleared_at" TIMESTAMP(3),
    "cleared_by_user_id" TEXT,

    CONSTRAINT "screen_playback_demotions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "screen_playback_demotions_screen_id_cleared_at_idx"
    ON "screen_playback_demotions"("screen_id", "cleared_at");

CREATE INDEX IF NOT EXISTS "screen_playback_demotions_tenant_id_created_at_idx"
    ON "screen_playback_demotions"("tenant_id", "created_at");

-- One ACTIVE demotion per screen × source file (sticky; never a pile-up).
CREATE UNIQUE INDEX IF NOT EXISTS "screen_playback_demotions_active_key"
    ON "screen_playback_demotions"("screen_id", "source_sha256")
    WHERE "cleared_at" IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'screen_playback_demotions_screen_id_fkey'
  ) THEN
    ALTER TABLE "screen_playback_demotions"
      ADD CONSTRAINT "screen_playback_demotions_screen_id_fkey"
      FOREIGN KEY ("screen_id") REFERENCES "screens"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
