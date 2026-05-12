-- 2026-05-11 — Add first_name + last_name to users.
--
-- Operator: "let's add first and last name to the user profile so
-- we can say Hi Greg and not gschiemann."
--
-- Pre-fix: dashboard greeting did `email.split('@')[0].split(/[._-]/)[0]`
-- to guess a name — produced "Gschiemann" for gschiemann@sbcglobal.net
-- and worse for emails like first.last@. With explicit columns the
-- greeting is reliably "Greg" and the sidebar can show "Greg Schiemann
-- · gschiemann@sbcglobal.net" instead of just the email.
--
-- Columns are nullable so:
--   - Existing rows keep loading
--   - Legacy display fallback to email-prefix still works for users
--     who haven't filled in their name yet
--   - Future SSO imports (Clever, Google) have a clean target
--
-- Index on (tenantId, lastName, firstName) so the eventual user-list
-- search-by-name doesn't fall back to a seq scan once we have >1k
-- users per tenant.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "first_name" TEXT,
  ADD COLUMN IF NOT EXISTS "last_name"  TEXT;

CREATE INDEX IF NOT EXISTS "users_tenant_name_idx"
  ON "users" ("tenant_id", "last_name", "first_name");
