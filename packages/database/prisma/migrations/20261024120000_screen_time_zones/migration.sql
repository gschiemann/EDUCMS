-- 2026-10-24 — Automatic per-screen time zones (apps/api/src/screens/screen-time-zone.ts).
--
-- Generated with `prisma migrate diff --from-schema-datamodel <old>
-- --to-schema-datamodel <new> --script`, then made idempotent by hand
-- (CLAUDE.md "a schema change ships a MIGRATION FILE", rule 2): a dev database
-- that already took this shape through `pnpm db:push` applies it as a no-op.
--
-- ADDITIVE ONLY, nullable, no defaults, no backfill:
--   * tenants.timezone         — the location's time-zone SETTING (IANA). NULL =
--                                automatic from the location's coordinates.
--   * screens.timezone         — a per-screen OVERRIDE (IANA). NULL = inherit.
--   * screens.device_time_zone — telemetry: the zone the device reports itself
--                                set to (register); never read by a manifest.
-- The automatic zone is derived at read time from coordinates that already
-- exist (43 of 49 live locations, 38 of 42 live screens on 2026-10-24), so no
-- data migration is needed for existing rows.
--
-- `lock_timeout`: ALTER TABLE on "screens" takes a brief ACCESS EXCLUSIVE lock
-- on the table every manifest poll reads. Five seconds, then fail — railway-
-- start retries and the previous deployment keeps serving.

SET lock_timeout = '5s';

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT;

ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "timezone" TEXT,
  ADD COLUMN IF NOT EXISTS "device_time_zone" TEXT;
