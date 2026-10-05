-- 2026-10-05 — Alert targeting: which alert wrote each per-screen override row.
--
-- Operators can now aim an alert at all screens, one group, or one screen, so
-- several alerts can be active at once and two of them can cover the same
-- screen. `screen_emergency_overrides` is ONE row per screen (the row the
-- manifest reads), and until now it did not record which alert wrote it — so
-- an all-clear could only delete rows, and clearing one alert could silently
-- end another (proven in apps/api/src/emergency/emergency.targeting.spec.ts).
-- These columns let the all-clear end exactly its own alert and hand each of
-- its screens back to the next-newest alert still aimed at it
-- (apps/api/src/emergency/alert-stack.ts).
--
-- SQL generated with:
--   prisma migrate diff --from-schema-datamodel <master schema> \
--                       --to-schema-datamodel prisma/schema.prisma --script
-- then made idempotent (IF NOT EXISTS) per CLAUDE.md, because dev databases
-- take the same shape through `pnpm db:push`.
--
-- ADDITIVE AND NON-DESTRUCTIVE:
--   * four NULLABLE columns with no default — catalogue-only in Postgres,
--     instant at any row count. Every existing row reads as NULL = "written
--     before targeting", and the all-clear treats those exactly as it always
--     has (a whole-organisation all-clear removes them);
--   * one btree index on (tenant_id, alert_id) for the all-clear's lookup.
--     The table holds at most one row per screen, so the build is trivial;
--   * nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: every manifest poll reads this table. If a long transaction
-- holds it, a waiting ALTER would queue the fleet's polls behind it. Five
-- seconds, then fail — railway-start retries, and the previous deployment
-- keeps serving until migrate succeeds.

SET lock_timeout = '5s';

ALTER TABLE "screen_emergency_overrides"
  ADD COLUMN IF NOT EXISTS "alert_id" TEXT,
  ADD COLUMN IF NOT EXISTS "displaced" JSONB,
  ADD COLUMN IF NOT EXISTS "scope_id" TEXT,
  ADD COLUMN IF NOT EXISTS "scope_type" TEXT;

CREATE INDEX IF NOT EXISTS "screen_emergency_overrides_tenant_id_alert_id_idx"
  ON "screen_emergency_overrides"("tenant_id", "alert_id");
