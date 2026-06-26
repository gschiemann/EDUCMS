-- Org-wide "Require approval before any content goes live" gate
-- (Appspace-parity enterprise control, 2026-06-26). Additive boolean,
-- defaults to FALSE so every existing tenant keeps today's behavior
-- (no forced approval queue). When TRUE, a CONTRIBUTOR who publishes /
-- schedules content is routed through the existing submit-for-review
-- flow instead of going live directly; admins bypass.
-- `IF NOT EXISTS` so a re-apply on a DB that already has the column is a no-op.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "require_content_approval" BOOLEAN NOT NULL DEFAULT false;
