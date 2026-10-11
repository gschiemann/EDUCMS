-- 2026-10-11 — USER SCOPING (apps/api/src/user-scope).
--
-- Two NEW tables, nothing else:
--
--   * "user_location_access" — a person may also work in another location of
--     the SAME organisation (with the same role). "users"."tenant_id" stays the
--     person's HOME location; nothing about it changes.
--   * "user_screen_scopes"   — any row for (user, tenant) limits the person, in
--     that location, to the listed screens / screen groups. Deliberately NO
--     foreign key to "screens" / "screen_groups": a cascade would delete the
--     last row when a group is deleted and silently widen the person to the
--     whole location. A dangling id simply matches nothing.
--
-- Generated with
--   prisma migrate diff --from-schema-datamodel <master schema> \
--                       --to-schema-datamodel prisma/schema.prisma --script
-- then made idempotent (IF NOT EXISTS / pg_constraint guard) per CLAUDE.md,
-- because dev databases already take this shape through `pnpm db:push`.
-- Additive only: nothing is dropped, renamed or rewritten, and no existing
-- table gains a column.
--
-- `lock_timeout`: the foreign keys take a brief SHARE ROW EXCLUSIVE lock on
-- "users" and "tenants", which auth reads on every request. Five seconds, then
-- fail (railway-start retries) rather than queue the fleet behind a lock.

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS "user_location_access" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "granted_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_location_access_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "user_screen_scopes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "screen_id" TEXT,
    "screen_group_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_screen_scopes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "user_location_access_tenant_id_idx"
  ON "user_location_access"("tenant_id");

CREATE UNIQUE INDEX IF NOT EXISTS "user_location_access_user_id_tenant_id_key"
  ON "user_location_access"("user_id", "tenant_id");

CREATE INDEX IF NOT EXISTS "user_screen_scopes_user_id_tenant_id_idx"
  ON "user_screen_scopes"("user_id", "tenant_id");

CREATE INDEX IF NOT EXISTS "user_screen_scopes_tenant_id_idx"
  ON "user_screen_scopes"("tenant_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_location_access_user_id_fkey') THEN
    ALTER TABLE "user_location_access"
      ADD CONSTRAINT "user_location_access_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_location_access_tenant_id_fkey') THEN
    ALTER TABLE "user_location_access"
      ADD CONSTRAINT "user_location_access_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_screen_scopes_user_id_fkey') THEN
    ALTER TABLE "user_screen_scopes"
      ADD CONSTRAINT "user_screen_scopes_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_screen_scopes_tenant_id_fkey') THEN
    ALTER TABLE "user_screen_scopes"
      ADD CONSTRAINT "user_screen_scopes_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END
$$;
