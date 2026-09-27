-- 2026-09-27 — K-12 sports launch program, lane B3: student privacy on public
-- screens (Greg: "follow the laws, dont show any kids without some legal
-- approval from someone"). Design:
-- docs/research/2026-09-24-k12-sports-launch-program/03-STUDENT-PRIVACY-DESIGN.md
--
-- DDL generated with `prisma migrate diff --from-schema-datamodel <master>
-- --to-schema-datamodel <this branch> --script`, then made idempotent.
--
--   roster_players.directory_opt_out / photo_release
--   sports_persons.directory_opt_out / photo_release
--                            — per-student flags the school records: the
--                              family opted out of directory information
--                              (never displayed publicly), and a photo /
--                              media release is on file (required for any
--                              public photo at a K-12 school).
--   student_privacy_policies — one row per tenant: the admin's attestation
--                              (names / photos: ALLOW with user, time and text
--                              version, or HIDE), and whether a non-K-12
--                              tenant serves minors.
--
-- ADDITIVE AND NON-DESTRUCTIVE. Nothing is dropped, renamed or rewritten:
--   * the four new columns are NOT NULL with a constant DEFAULT false — a
--     catalogue-only change in Postgres 11+ (no table rewrite), instant at any
--     row count. `false` is the SAFE value for both: no student is marked as
--     having a release, and no opt-out is invented (the tenant attestation, not
--     this column, is what hides every name by default at a K-12 school);
--   * one new table and its FK to tenants (ON DELETE CASCADE — the policy has
--     no meaning without its tenant).
--
-- `lock_timeout`: the two ALTER TABLEs need a brief ACCESS EXCLUSIVE lock on
-- "roster_players" (read by every public scoreboard poll) and "sports_persons".
-- Five seconds, then fail — railway-start retries, and a failed migrate never
-- goes healthy, so the previous deployment keeps serving.
--
-- IDEMPOTENT (IF NOT EXISTS + a guarded constraint) because the dev flow is
-- `pnpm db:push`: a database that already took this shape applies the file as
-- a no-op instead of failing on "already exists". Proven on a scratch
-- Postgres 16: applied twice over the master schema, both runs exit 0.

SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "roster_players"
  ADD COLUMN IF NOT EXISTS "directory_opt_out" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "photo_release" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "sports_persons"
  ADD COLUMN IF NOT EXISTS "directory_opt_out" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "photo_release" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "student_privacy_policies" (
    "tenant_id" TEXT NOT NULL,
    "serves_minors" BOOLEAN,
    "names_state" TEXT,
    "names_set_at" TIMESTAMP(3),
    "names_set_by_user_id" TEXT,
    "names_attestation_version" TEXT,
    "photos_state" TEXT,
    "photos_set_at" TIMESTAMP(3),
    "photos_set_by_user_id" TEXT,
    "photos_attestation_version" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_privacy_policies_pkey" PRIMARY KEY ("tenant_id")
);

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'student_privacy_policies_tenant_id_fkey'
  ) THEN
    ALTER TABLE "student_privacy_policies"
      ADD CONSTRAINT "student_privacy_policies_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
