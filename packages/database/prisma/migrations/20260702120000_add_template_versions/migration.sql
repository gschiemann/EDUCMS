-- Wave C / editor-crush C3 (2026-07-02) — last-5 version history.
--
-- "Even last-5 snapshots kills the 'one bad Save is unrecoverable'
-- class" (06-CRUSH-CANVA-PLAN.md Wave C). Today, PUT /templates/:id
-- and PUT /templates/:id/zones both blind-overwrite the row (the
-- zones endpoint literally deletes every TemplateZone and recreates
-- them) with no snapshot kept anywhere. This migration adds a purely
-- additive `template_versions` table the API writes one compact
-- snapshot into on every successful save, keeping only the newest 5
-- rows per template (older ones deleted in the same transaction —
-- application-level retention, not a DB trigger, so the cap is easy
-- to reason about / change later).
--
-- Additive-only — new table, no existing column/row touched. Safe on
-- the live pilot database with zero backfill needed (a template with
-- no versions yet simply has an empty history list until its next
-- save).
--
-- `IF NOT EXISTS` / idempotent guards throughout so a re-apply on a
-- database that already has this table is a no-op (matches the
-- house style established in 20260512_add_template_scenes and
-- 20260615093709_add_sports_stats_engine).

CREATE TABLE IF NOT EXISTS "template_versions" (
  "id"           TEXT PRIMARY KEY,
  "template_id"  TEXT NOT NULL,
  "tenant_id"    TEXT NOT NULL,
  "by_user_id"   TEXT,
  "zones"        JSONB NOT NULL,
  "meta"         JSONB NOT NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Hot read path: "give me the 5 most recent versions for this
-- template" (History panel list + the cap-at-5 eviction query both
-- use this exact shape).
CREATE INDEX IF NOT EXISTS "template_versions_template_id_created_at_idx"
  ON "template_versions"("template_id", "created_at");

-- Tenant-wide export/cleanup access pattern, matching the sibling
-- audit_logs table's tenantId index.
CREATE INDEX IF NOT EXISTS "template_versions_tenant_id_idx"
  ON "template_versions"("tenant_id");

-- FKs added via DO blocks (idempotent — re-running the migration
-- doesn't error if the constraint already exists), matching the house
-- style in 20260512_add_template_scenes/migration.sql.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'template_versions_template_id_fkey'
  ) THEN
    ALTER TABLE "template_versions"
      ADD CONSTRAINT "template_versions_template_id_fkey"
      FOREIGN KEY ("template_id") REFERENCES "templates"("id")
      ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'template_versions_tenant_id_fkey'
  ) THEN
    ALTER TABLE "template_versions"
      ADD CONSTRAINT "template_versions_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
      ON DELETE CASCADE;
  END IF;
END $$;

-- by_user_id is nullable + SET NULL on delete: deleting a user account
-- must never cascade into losing a template's safety-net snapshots.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'template_versions_by_user_id_fkey'
  ) THEN
    ALTER TABLE "template_versions"
      ADD CONSTRAINT "template_versions_by_user_id_fkey"
      FOREIGN KEY ("by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL;
  END IF;
END $$;
