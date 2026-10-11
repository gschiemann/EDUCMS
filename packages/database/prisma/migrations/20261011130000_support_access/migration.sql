-- 2026-10-11 — CUSTOMER-APPROVED, TIME-BOXED SUPPORT ACCESS.
--
-- VenueOS's standing full access to customer data is removed. A SUPER_ADMIN
-- reaches a customer organisation only under an ACTIVE row of the new
-- "support_access_grants" table (apps/api/src/support-access). Three pieces:
--
--   * "tenants"."is_internal"  — VenueOS's OWN organisations (VisionCore, the
--     owner's demo / bench / test orgs). Exempt from the gate so the owner can
--     never lock himself out. NOT NULL DEFAULT false: every customer reads
--     false. The UPDATE below marks the known internal slugs; a slug that does
--     not exist in a database is simply not matched.
--   * "audit_logs"."support_grant_id" — which grant a super admin acted under,
--     stamped by the ambient audit-actor hook. NULLABLE, no default: instant
--     at any row count on this (large, append-only) table.
--   * "support_access_grants" — the grants themselves, FK to "tenants" with
--     ON DELETE CASCADE exactly like "licenses" / "customer_invoices".
--
-- Generated with
--   prisma migrate diff --from-schema-datamodel <master schema> \
--                       --to-schema-datamodel prisma/schema.prisma --script
-- then made idempotent (IF NOT EXISTS / pg_constraint guard) per CLAUDE.md,
-- because dev databases already take this shape through `pnpm db:push`.
-- Additive only: nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: "audit_logs" is written by every privileged action and
-- "tenants" is read by auth on every request; ALTER TABLE needs a brief
-- ACCESS EXCLUSIVE lock. Five seconds, then fail (railway-start retries)
-- rather than queue the fleet behind a lock.

SET lock_timeout = '5s';

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "is_internal" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "audit_logs"
  ADD COLUMN IF NOT EXISTS "support_grant_id" TEXT;

CREATE TABLE IF NOT EXISTS "support_access_grants" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT,
    "scope_tenant_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requested_duration_minutes" INTEGER NOT NULL,
    "requested_by_user_id" TEXT,
    "requested_by_email" TEXT,
    "decided_by_user_id" TEXT,
    "decided_by_email" TEXT,
    "decided_at" TIMESTAMP(3),
    "starts_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "revoked_by_email" TEXT,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_access_grants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "support_access_grants_tenant_id_status_idx"
  ON "support_access_grants"("tenant_id", "status");

CREATE INDEX IF NOT EXISTS "support_access_grants_status_expires_at_idx"
  ON "support_access_grants"("status", "expires_at");

CREATE INDEX IF NOT EXISTS "audit_logs_tenant_id_support_grant_id_created_at_idx"
  ON "audit_logs"("tenant_id", "support_grant_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'support_access_grants_tenant_id_fkey'
  ) THEN
    ALTER TABLE "support_access_grants"
      ADD CONSTRAINT "support_access_grants_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- VenueOS's own organisations (verified against production on 2026-10-11 —
-- see docs/research/2026-10-11-support-access/01-agent-report.md). Only ROOT
-- organisations are listed; a location inherits its root's flag at run time.
-- Idempotent: re-running sets the same rows to the same value.
UPDATE "tenants" SET "is_internal" = true
 WHERE "parent_id" IS NULL
   AND "slug" IN (
     '__system__',             -- security-event sink, never a customer
     'visioncore-systems',     -- VisionCore (the owner's media-player box)
     'dodgers'                 -- the owner's test organisation (Brookfield NorCal demo)
   );
-- Owner decision 2026-10-11: ONLY these three are VenueOS-internal. Durgabari
-- and every RIOT organisation are customers (approval required); demo orgs
-- (Springfield, Walnut Creek, Crunch, AGC) were archived the same day.
