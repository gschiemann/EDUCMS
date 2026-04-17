-- Sprint 3: Clever SIS integration
-- Adds nullable Clever fields to tenants + users, and CleverSyncLog table.

ALTER TABLE "tenants"
  ADD COLUMN "clever_district_id" TEXT,
  ADD COLUMN "clever_access_token" TEXT,
  ADD COLUMN "clever_connected_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "tenants_clever_district_id_key" ON "tenants"("clever_district_id");

ALTER TABLE "users"
  ADD COLUMN "clever_id" TEXT,
  ADD COLUMN "clever_role" TEXT;

CREATE UNIQUE INDEX "users_clever_id_key" ON "users"("clever_id");

CREATE TABLE "clever_sync_logs" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "sync_started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sync_completed_at" TIMESTAMP(3),
  "users_added" INTEGER NOT NULL DEFAULT 0,
  "users_updated" INTEGER NOT NULL DEFAULT 0,
  "users_disabled" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  CONSTRAINT "clever_sync_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "clever_sync_logs_tenant_id_sync_started_at_idx"
  ON "clever_sync_logs"("tenant_id", "sync_started_at");

ALTER TABLE "clever_sync_logs"
  ADD CONSTRAINT "clever_sync_logs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
