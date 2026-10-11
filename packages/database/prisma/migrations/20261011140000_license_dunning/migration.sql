-- 2026-10-11 — CARD FAILURE → VIEW-ONLY, WITH HELP (apps/api/src/billing/dunning-policy.ts).
--
-- Four columns on `licenses`:
--   dunning_invoice_id       the Stripe invoice whose payment is failing. A new
--                            invoice id resets the notice stage, so each billing
--                            email goes out at most once PER INVOICE.
--   dunning_notice_stage     0 none · 1 card declined · 2 reminder before the
--                            dashboard goes view-only · 3 now view-only —
--                            claimed atomically before sending.
--   dunning_failed_at        when that invoice first failed.
--   dunning_next_attempt_at  Stripe's next automatic retry (NULL after the last).
--
-- SQL generated with:
--   prisma migrate diff --from-schema-datamodel <master schema> \
--                       --to-schema-datamodel prisma/schema.prisma --script
-- then made idempotent (IF NOT EXISTS) per CLAUDE.md, because dev databases
-- take the same shape through `pnpm db:push`.
--
-- ADDITIVE AND NON-DESTRUCTIVE: three nullable columns with no default and one
-- NOT NULL column with a constant default (catalogue-only in Postgres 11+, no
-- table rewrite). Every existing license reads NULL / 0 = "no card failure in
-- progress", which is exactly how the code treated it before this migration.
--
-- `lock_timeout`: `licenses` is read by every pairing and billing request; five
-- seconds, then fail — railway-start retries, the previous deployment keeps
-- serving until migrate succeeds.

SET lock_timeout = '5s';

ALTER TABLE "licenses" ADD COLUMN IF NOT EXISTS "dunning_invoice_id" TEXT;
ALTER TABLE "licenses" ADD COLUMN IF NOT EXISTS "dunning_notice_stage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "licenses" ADD COLUMN IF NOT EXISTS "dunning_failed_at" TIMESTAMP(3);
ALTER TABLE "licenses" ADD COLUMN IF NOT EXISTS "dunning_next_attempt_at" TIMESTAMP(3);
