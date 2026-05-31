-- audit_logs immutability — enforce append-only at the storage layer.
--
-- CLAUDE.md §16 documents "DB-level immutability triggers (UPDATE/DELETE
-- blocked at storage)". Until now that safeguard was app-layer only — no
-- trigger existed (audit 2026-05-31, finding §16 F-1). This makes the claim
-- real: defense-in-depth against a compromised API process or a direct-DB
-- actor tampering with audit history.
--
-- CRITICAL DESIGN NOTE — why this is NOT a blanket `BEFORE UPDATE OR DELETE`:
--   `audit_logs_user_id_fkey` is ON DELETE SET NULL (verified 2026-05-31),
--   and the app HARD-deletes users (users.controller.ts ~L453,
--   `tx.user.delete(...)`). Deleting a user therefore fires
--   `UPDATE audit_logs SET user_id = NULL WHERE user_id = <id>`. A naive
--   blanket UPDATE block would make every user deletion fail. So this trigger
--   blocks all DELETEs and all *content* UPDATEs, but PERMITS exactly one
--   thing: the FK anonymization (user_id: non-null -> NULL, every other column
--   byte-identical). Forensic integrity is preserved; user deletion keeps
--   working. The actor who did the action is still recorded by row content
--   even after the user row is gone — only the FK pointer is nulled.
--
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS, safe to re-run.
-- TRUNCATE is intentionally NOT blocked (table-owner-only; a future controlled
-- retention/archival job may need it — add a BEFORE TRUNCATE trigger if you
-- want to close that too).

CREATE OR REPLACE FUNCTION audit_logs_block_mutation()
  RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: DELETE is not permitted'
      USING ERRCODE = 'check_violation',
            HINT = 'Audit history is immutable. Inserts only.';
  END IF;

  -- TG_OP = 'UPDATE': permit ONLY the FK ON DELETE SET NULL anonymization,
  -- i.e. user_id transitions from a real id to NULL and nothing else changes.
  IF OLD.user_id IS NOT NULL
     AND NEW.user_id IS NULL
     AND NEW.id          IS NOT DISTINCT FROM OLD.id
     AND NEW.tenant_id   IS NOT DISTINCT FROM OLD.tenant_id
     AND NEW.action      IS NOT DISTINCT FROM OLD.action
     AND NEW.target_type IS NOT DISTINCT FROM OLD.target_type
     AND NEW.target_id   IS NOT DISTINCT FROM OLD.target_id
     AND NEW.details     IS NOT DISTINCT FROM OLD.details
     AND NEW.created_at  IS NOT DISTINCT FROM OLD.created_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'audit_logs is append-only: UPDATE is not permitted (only the FK user-id anonymization is allowed)'
    USING ERRCODE = 'check_violation',
          HINT = 'Audit history is immutable. Inserts only.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_immutable ON audit_logs;
CREATE TRIGGER audit_logs_immutable
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION audit_logs_block_mutation();
