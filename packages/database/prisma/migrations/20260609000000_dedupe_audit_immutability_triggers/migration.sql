-- 2026-06-09 audit H10 — de-duplicate the audit_logs immutability triggers.
--
-- THE BUG (verified live in prod pg_trigger): THREE triggers coexist on
-- audit_logs —
--   audit_log_immutable_no_update  } 2026-05-26 P0-6 pair: blanket
--   audit_log_immutable_no_delete  } RAISE on every UPDATE/DELETE
--   audit_logs_immutable             2026-05-31: smart variant
--
-- The 2026-05-31 migration was written precisely because the blanket
-- UPDATE block breaks user deletion: `audit_logs_user_id_fkey` is
-- ON DELETE SET NULL, so deleting a user fires
-- `UPDATE audit_logs SET user_id = NULL ...` — its smart trigger permits
-- exactly that one anonymization (every other column byte-identical) and
-- blocks everything else. But it only dropped a trigger named
-- `audit_logs_immutable` (its own), NOT the 05-26 pair — so the blanket
-- pair still fires first and every user deletion 500s
-- (launch-readiness 2026-06-08 P1; full-audit 2026-06-09 H10).
--
-- THE FIX: drop the 05-26 blanket pair + its now-unused function. The
-- 05-31 `audit_logs_immutable` trigger remains, so the storage-layer
-- append-only guarantee is fully preserved (DELETE blocked, UPDATE blocked
-- except the FK user-id anonymization). Per the 05-26 design note, removal
-- of an immutability trigger must be "a deliberate DROP TRIGGER migration"
-- — this file, in git history, is that audited record.
--
-- Idempotent: IF EXISTS everywhere; safe to re-run.

DROP TRIGGER IF EXISTS audit_log_immutable_no_update ON "audit_logs";
DROP TRIGGER IF EXISTS audit_log_immutable_no_delete ON "audit_logs";
DROP FUNCTION IF EXISTS audit_log_immutable();

-- Belt-and-braces: guarantee the smart trigger exists even on a database
-- where the 05-31 migration somehow didn't run (e.g. db-push-provisioned
-- dev). CREATE OR REPLACE + DROP/CREATE TRIGGER mirrors 05-31 exactly.
CREATE OR REPLACE FUNCTION audit_logs_block_mutation()
  RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_logs is append-only: DELETE is not permitted'
      USING ERRCODE = 'check_violation',
            HINT = 'Audit history is immutable. Inserts only.';
  END IF;

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
