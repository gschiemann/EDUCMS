-- User soft-delete (Wave 2). Hard delete 500'd on any user with history
-- (FK Restrict on 3 required relations + the immutable audit_logs trigger
-- blocking SetNull). Additive nullable column; existing rows stay non-deleted.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3);
