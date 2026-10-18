-- 2026-10-18 — FIELD BUILD WINDOWS (apps/api/src/field-builds).
--
-- A private field build of the Android player is offered only inside a
-- "field window": listed organisations, listed screens (or every screen of
-- those organisations), for at most 24 hours from arming. Until now the window
-- lived in four Railway variables (PLAYER_APK_FIELD_*), so every change meant
-- editing Railway and restarting the API. A SUPER_ADMIN now arms and cancels a
-- window from /super/field-builds (audited). The variables remain the fallback
-- when no window here is live (player-ota/field-candidate.ts).
--
-- Generated with
--   prisma migrate diff --from-schema-datamodel <master schema> \
--                       --to-schema-datamodel prisma/schema.prisma --script
-- then made idempotent (IF NOT EXISTS / pg_constraint guards) per CLAUDE.md,
-- because dev databases already take this shape through `pnpm db:push`.
--
-- ADDITIVE ONLY: one new table and two indexes. Nothing existing is touched.
--
-- The CHECK constraints are the part Prisma's schema language cannot say, and
-- they are the point: no writer — the API, a console, a script — can store a
-- window longer than 24 hours from its arming, a window with no organisation,
-- or a screen list that is neither "every screen" nor a non-empty list. The
-- gate re-checks all of it at read time as well.
--
-- `lock_timeout`: nothing here locks an existing table, but every migration in
-- this repo fails fast rather than queue (railway-start retries).

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "field_build_windows" (
    "id" TEXT NOT NULL,
    "candidate" TEXT NOT NULL,
    "candidate_sha256" TEXT NOT NULL,
    "tenant_ids" TEXT[],
    "screen_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "all_screens" BOOLEAN NOT NULL DEFAULT false,
    "armed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "armed_by_user_id" TEXT,
    "armed_by_email" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_user_id" TEXT,
    "cancelled_by_email" TEXT,
    "note" TEXT,

    CONSTRAINT "field_build_windows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "field_build_windows_cancelled_at_expires_at_idx"
  ON "field_build_windows"("cancelled_at", "expires_at");

CREATE INDEX IF NOT EXISTS "field_build_windows_armed_at_idx"
  ON "field_build_windows"("armed_at");

DO $$
BEGIN
  -- At most 24 hours from arming, and after it. Extending a window means
  -- arming a new one.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_build_windows_expiry_check') THEN
    ALTER TABLE "field_build_windows"
      ADD CONSTRAINT "field_build_windows_expiry_check"
      CHECK ("expires_at" > "armed_at" AND "expires_at" <= "armed_at" + INTERVAL '24 hours');
  END IF;

  -- One to fifty organisations. An organisation is always named: there is no
  -- organisation wildcard.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_build_windows_tenants_check') THEN
    ALTER TABLE "field_build_windows"
      ADD CONSTRAINT "field_build_windows_tenants_check"
      CHECK ("tenant_ids" IS NOT NULL AND cardinality("tenant_ids") BETWEEN 1 AND 50);
  END IF;

  -- Either every screen of the listed organisations (and no list), or a list
  -- of one to five hundred screens.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_build_windows_screens_check') THEN
    ALTER TABLE "field_build_windows"
      ADD CONSTRAINT "field_build_windows_screens_check"
      CHECK (
        ("all_screens" AND cardinality(COALESCE("screen_ids", ARRAY[]::TEXT[])) = 0)
        OR (NOT "all_screens" AND "screen_ids" IS NOT NULL AND cardinality("screen_ids") BETWEEN 1 AND 500)
      );
  END IF;

  -- A field build name and a digest, in the registry's own shapes.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'field_build_windows_candidate_check') THEN
    ALTER TABLE "field_build_windows"
      ADD CONSTRAINT "field_build_windows_candidate_check"
      CHECK (
        "candidate" ~ '^[0-9]+\.[0-9]{1,2}\.[0-9]{1,2}-field\.[1-9][0-9]*$'
        AND "candidate_sha256" ~ '^[a-f0-9]{64}$'
      );
  END IF;
END $$;
