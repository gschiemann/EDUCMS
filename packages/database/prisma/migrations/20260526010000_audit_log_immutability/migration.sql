-- 2026-05-26 audit P0-6: DB-level append-only enforcement for audit_logs.
--
-- CLAUDE.md "Emergency System" section claims the AuditLog is "immutable —
-- no deletion or modification allowed." Until now that was application-
-- layer policy only — every controller carefully avoided calling
-- `prisma.auditLog.update(...)` or `.delete(...)`, and code review caught
-- new offenders. But a compromised app-server credential, a runaway
-- migration, a developer with direct `psql` access, or a future
-- controller refactor could all rewrite forensic history with nothing
-- stopping it at the DB.
--
-- This trigger enforces the invariant at the storage layer:
--   INSERT — allowed (the normal path for writing audit entries).
--   UPDATE / DELETE — RAISE EXCEPTION, transaction rolls back.
--
-- The trigger is intentionally simple (no role exception, no admin
-- override). Forensic integrity is more valuable than convenience: if a
-- legitimate cleanup is ever needed (e.g., data retention compliance),
-- it should be a deliberate `DROP TRIGGER` migration that's itself
-- audited, not a runtime backdoor.
--
-- Prisma client code is unaffected because the application never
-- attempts UPDATE/DELETE on audit_logs. CLAUDE.md memory "audits
-- exhaustive or worthless" called this gap out — closes it.

CREATE OR REPLACE FUNCTION audit_log_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION
    'audit_logs is append-only — UPDATE/DELETE blocked at the DB. '
    'If a legitimate retention cleanup is needed, write a one-off '
    'DROP TRIGGER migration that itself writes an audit entry.';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_immutable_no_update ON "audit_logs";
DROP TRIGGER IF EXISTS audit_log_immutable_no_delete ON "audit_logs";

CREATE TRIGGER audit_log_immutable_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_immutable();

CREATE TRIGGER audit_log_immutable_no_delete
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION audit_log_immutable();
