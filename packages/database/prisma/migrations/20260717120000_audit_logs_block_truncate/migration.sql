-- audit_logs — block TRUNCATE (§16 completion, 2026-07-17).
--
-- The 20260531000000_audit_logs_immutable trigger blocks UPDATE/DELETE at the
-- storage layer but INTENTIONALLY left TRUNCATE open (see that migration's
-- note). TRUNCATE bypasses row-level triggers and would erase the entire
-- forensic history in a single statement — the audit's §16 finding: "audit
-- immutability blocks UPDATE/DELETE but explicitly leaves TRUNCATE possible."
--
-- This adds a STATEMENT-level BEFORE TRUNCATE guard so audit history cannot be
-- truncated by the API DB role or a direct-DB actor. Defense-in-depth on top
-- of the row-level immutability trigger, completing the append-only guarantee.
--
-- A future controlled retention/archival job must run under a SEPARATE
-- privileged role and drop/replace this trigger deliberately — the application
-- role must never be able to.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS, safe to re-run.

CREATE OR REPLACE FUNCTION audit_logs_block_truncate()
  RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: TRUNCATE is not permitted'
    USING ERRCODE = 'check_violation',
          HINT = 'Audit history is immutable. Inserts only.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_truncate ON audit_logs;
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT
  EXECUTE FUNCTION audit_logs_block_truncate();
