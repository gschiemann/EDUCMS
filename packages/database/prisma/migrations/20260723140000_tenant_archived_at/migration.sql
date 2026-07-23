-- 2026-07-23 — tenant soft-delete (archive).
--
-- Hard-delete is architecturally impossible for any tenant that has ever done
-- an audited action: audit_logs.tenant_id is FK-RESTRICT'd AND protected by the
-- §16 immutability trigger, so DELETE cascades hit P2003. Archiving is the
-- supported retire/cleanup path. Additive + nullable → zero data risk, no
-- backfill. Partial index serves the "exclude archived" filter added to every
-- fleet / tenant-list / child-count / cascade query.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "tenants_parent_id_archived_at_idx" ON "tenants"("parent_id", "archived_at");
