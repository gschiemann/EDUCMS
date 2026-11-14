-- Panic phones (2026-11-14) — apps/api/src/emergency/panic-device/.
--
-- One row per phone a person has kept ready for emergencies. The row holds
-- sha256(secret) only; the secret lives in an HttpOnly, Secure,
-- SameSite=Strict cookie on the web origin's /api/panic path. Revoked rows
-- are kept (soft revoke) as the forensic record beside their audit rows.
--
-- Purely additive: one new table, no existing table touched, no foreign keys
-- (relation-free like session_refresh_tokens, so no cascade edge reaches
-- users or tenants). Idempotent (IF NOT EXISTS) so a dev database that
-- already took the shape via `db:push` applies it cleanly. A new, empty table
-- takes no lock anything else waits on, so no lock_timeout is needed.
-- Generated with `prisma migrate diff --from-schema-datamodel <before>
-- --to-schema-datamodel <after> --script`, then made idempotent.

CREATE TABLE IF NOT EXISTS "panic_devices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_ip" TEXT,
    "last_used_at" TIMESTAMP(3),
    "last_used_ip" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "revoked_reason" TEXT,

    CONSTRAINT "panic_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "panic_devices_secret_hash_key" ON "panic_devices"("secret_hash");

CREATE INDEX IF NOT EXISTS "panic_devices_user_id_idx" ON "panic_devices"("user_id");

CREATE INDEX IF NOT EXISTS "panic_devices_tenant_id_idx" ON "panic_devices"("tenant_id");
