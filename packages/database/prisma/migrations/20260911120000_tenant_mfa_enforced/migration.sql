-- 2026-09-11 — PER-TENANT MFA ENFORCEMENT.
--
-- Greg: "i want people to have the options but for my riot accounts, leave it
-- turned on, we will keep that security so just new customers."
--
-- The column is a NULLABLE TRI-STATE resolved by `effectiveMfaEnforced()` in
-- @cms/api-types:  true = enforce, false = optional, NULL = the default, which
-- is OPTIONAL (the new-customer posture).
--
-- ⚠️ THE BACKFILL IS THE WHOLE POINT OF THIS MIGRATION, not an afterthought.
-- On the day this shipped, production ran MFA_REQUIRED_ENFORCE_AFTER="now", so
-- EVERY privileged and panic-capable account in EVERY tenant was already held
-- at login until it enrolled. Adding a nullable column whose NULL resolves to
-- "optional" — and stopping there — would have disarmed that live control for
-- every existing organization in one deploy, silently, with a 200 on every
-- login. So the ADD and the UPDATE ship together, in this file, and a tenant
-- that was enforcing before the deploy is still enforcing after it.
--
-- Rows created AFTER this runs keep NULL and therefore default to optional.
-- DO NOT re-run the UPDATE later: it would re-arm every tenant that has since
-- deliberately opted out. (Prisma's migration history makes that a non-issue
-- here; the warning is for anyone tempted to copy these two lines into a fixup.)
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "mfa_enforced" BOOLEAN;

UPDATE "tenants" SET "mfa_enforced" = true WHERE "mfa_enforced" IS NULL;
