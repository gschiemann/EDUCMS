-- 2026-10-11 — Self-signup email verification (launch security re-audit).
--
-- A public self-signup creates an ACTIVE DISTRICT_ADMIN for an email address
-- nobody has proven. While `email_verification_pending` is true the API admits
-- only the verify-email / logout / who-am-i routes. It is set at signup only
-- when the deploy can deliver mail to arbitrary recipients.
--
-- ADDITIVE AND NON-DESTRUCTIVE: one NOT NULL column with a constant DEFAULT
-- (a catalogue-only change in Postgres 11+, instant at any row count); every
-- existing user reads false — untouched. IDEMPOTENT (`IF NOT EXISTS`) because
-- dev databases take the shape via `pnpm db:push` first. `users` is read on
-- every sign-in, so fail fast rather than queue behind a lock.

SET lock_timeout = '5s';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "email_verification_pending" BOOLEAN NOT NULL DEFAULT false;
