-- 2026-10-24 — launch QA S1 + S2: two facts about a person, on their user row.
--
-- S1 — `setup_password_only`. A password an ADMIN sets for someone else
-- ("Set password now" in People) is TEMPORARY. Such an account is created with
-- `must_setup_credentials = true` (the existing first-login setup gate) AND
-- this flag, which narrows that setup to choosing a new password: the email
-- the admin typed is the person's own, unlike a provisioned placeholder
-- address. Cleared together with `must_setup_credentials` by
-- POST /auth/complete-setup.
--
-- S2 — `terms_accepted_version` / `terms_accepted_at`. The End User License
-- Agreement used to be accepted only in one browser's localStorage, so the
-- server had no record of who accepted which version when, and an invited
-- teammate never saw it at all. These hold the person's latest acceptance;
-- every acceptance also writes an immutable TERMS_ACCEPTED audit row (version,
-- time, address, how it was given).
--
-- ADDITIVE AND NON-DESTRUCTIVE:
--   * one BOOLEAN NOT NULL DEFAULT false — a catalogue-only change in Postgres
--     11+ (no table rewrite), and every existing row reads false, which is
--     exactly today's behaviour;
--   * two NULLABLE columns with no default — catalogue-only; every existing
--     row reads "never accepted on the server" (NULL), so the dashboard asks
--     each person once;
--   * nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: ALTER TABLE takes a brief ACCESS EXCLUSIVE lock on "users",
-- which every sign-in and session read touches. Five seconds, then fail —
-- railway-start retries, and a failed migrate never goes healthy, so Railway
-- keeps the previous deployment serving.
--
-- IDEMPOTENT (`IF NOT EXISTS`) because the dev flow is `pnpm db:push`: a
-- database that already took this shape applies the file as a no-op.

SET lock_timeout = '5s';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "setup_password_only" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "terms_accepted_version" TEXT,
  ADD COLUMN IF NOT EXISTS "terms_accepted_at" TIMESTAMP(3);
