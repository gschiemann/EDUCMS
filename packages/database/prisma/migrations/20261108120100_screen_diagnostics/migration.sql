-- 2026-11-08 — Screen diagnostics: self-test, logs on demand, storage health
-- (apps/api/src/screen-diagnostics/).
--
-- ADDITIVE AND NON-DESTRUCTIVE:
--   • three NULLABLE scalar columns on "screens" with no default — a
--     catalogue-only change at any row count; every screen reads NULL
--     ("no open diagnostics request"), which is today's behaviour;
--   • two NEW tables. Nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: ALTER TABLE needs a brief ACCESS EXCLUSIVE lock on the hot
-- "screens" table; fail after five seconds instead of queueing the fleet's
-- polls behind a long transaction (pattern: 20260919120000_screen_faces).
--
-- IDEMPOTENT (`IF NOT EXISTS`) because dev databases take the shape via
-- `pnpm db:push` first.

SET lock_timeout = '5s';

ALTER TABLE "screens"
  ADD COLUMN IF NOT EXISTS "pending_diagnostics_id" TEXT,
  ADD COLUMN IF NOT EXISTS "pending_diagnostics_kind" TEXT,
  ADD COLUMN IF NOT EXISTS "pending_diagnostics_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "screen_diagnostics_requests" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "screen_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "minutes" INTEGER,
    "requested_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "delivered_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "native_result" JSONB,
    "native_at" TIMESTAMP(3),
    "page_result" JSONB,
    "page_at" TIMESTAMP(3),
    "verdict" TEXT,
    "failure_reason" TEXT,
    "log_object_key" TEXT,
    "log_bytes" INTEGER,
    "log_sha256" TEXT,
    "log_purged_at" TIMESTAMP(3),
    CONSTRAINT "screen_diagnostics_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "screen_diagnostics_requests_tenant_id_screen_id_created_at_idx"
  ON "screen_diagnostics_requests"("tenant_id", "screen_id", "created_at");
CREATE INDEX IF NOT EXISTS "screen_diagnostics_requests_created_at_idx"
  ON "screen_diagnostics_requests"("created_at");

CREATE TABLE IF NOT EXISTS "screen_storage_health" (
    "screen_id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "native" JSONB,
    "native_at" TIMESTAMP(3),
    "page" JSONB,
    "page_at" TIMESTAMP(3),
    "warning" TEXT,
    "warned_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "screen_storage_health_pkey" PRIMARY KEY ("screen_id")
);

CREATE INDEX IF NOT EXISTS "screen_storage_health_tenant_id_idx"
  ON "screen_storage_health"("tenant_id");
