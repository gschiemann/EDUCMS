-- 2026-10-11 — SELF-SERVE TRIAL → PAID (apps/api/src/billing/trial-policy.ts).
--
-- Three columns on `licenses`:
--   trial_ends_at       when a self-serve free trial ends (signup sets it; the
--                       Stripe webhook mirrors the subscription's trial_end so
--                       a card added during the trial bills from the ORIGINAL
--                       trial end date).
--   trial_notice_stage  which trial reminder email went out (0 none, 1 seven
--                       days, 2 one day, 3 ended) — claimed atomically before
--                       sending, so each goes out at most once.
--   notice_locale       en | es | zh — the language billing emails are written in.
--
-- SQL generated with:
--   prisma migrate diff --from-schema-datamodel <master schema> \
--                       --to-schema-datamodel prisma/schema.prisma --script
-- then made idempotent (IF NOT EXISTS) per CLAUDE.md, because dev databases
-- take the same shape through `pnpm db:push`.
--
-- ADDITIVE AND NON-DESTRUCTIVE: two nullable columns with no default and one
-- NOT NULL column with a constant default (catalogue-only in Postgres 11+,
-- no table rewrite). Every existing license reads 0 / NULL, which the code
-- treats exactly as before this migration: no trial, no reminders.
--
-- `lock_timeout`: `licenses` is read by every pairing and billing request; five
-- seconds, then fail — railway-start retries, the previous deployment keeps
-- serving until migrate succeeds.

SET lock_timeout = '5s';

ALTER TABLE "licenses" ADD COLUMN IF NOT EXISTS "trial_ends_at" TIMESTAMP(3);
ALTER TABLE "licenses" ADD COLUMN IF NOT EXISTS "trial_notice_stage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "licenses" ADD COLUMN IF NOT EXISTS "notice_locale" TEXT;
