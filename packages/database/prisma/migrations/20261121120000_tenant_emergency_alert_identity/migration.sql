-- 2026-11-21 — EMG-01: an identity for the tenant-wide ("All screens") alert.
--
-- WHY. The tenant-wide alert lived only as emergency_status / emergency_type
-- on the tenant row, with no id. An all-clear sent for one alert therefore
-- ended whatever alert the tenant held by the time it arrived: an operator
-- clearing a Hold could end the Lockdown another operator had just raised in
-- its place. The trigger now writes its overrideId here (and the raise time)
-- in the same update that sets emergency_status, and the tenant all-clear is
-- a compare-and-set on it.
--
-- SQL generated with:
--   prisma migrate diff --from-schema-datamodel <master schema> \
--                       --to-schema-datamodel prisma/schema.prisma --script
-- then made idempotent (IF NOT EXISTS) per packages/database/CLAUDE.md,
-- because dev databases take the same shape through `pnpm db:push`.
--
-- ADDITIVE AND NON-DESTRUCTIVE:
--   * two NULLABLE columns on "tenants" with no default — catalogue-only in
--     Postgres, instant at any row count, no table rewrite, no backfill;
--   * nothing is dropped, renamed or rewritten.
-- Every existing row reads NULL = "an alert raised before alert identity, or
-- no alert", and the all-clear treats NULL exactly as it always behaved, so
-- an alert already on the glass at deploy time clears as it would today. The
-- previous build ignores both columns and runs unchanged against this
-- database (rollback = redeploy the previous build).
--
-- `lock_timeout`: "tenants" is read by every manifest poll. If a long
-- transaction holds it, fail fast and let the deploy retry rather than queue
-- the fleet's polls behind the ALTER's ACCESS EXCLUSIVE lock.

SET lock_timeout = '5s';

ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "emergency_alert_id" TEXT;
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "emergency_triggered_at" TIMESTAMP(3);
