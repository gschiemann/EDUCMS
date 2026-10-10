-- 2026-10-10 — Customer management console (/super/customers).
--
-- Generated with `prisma migrate diff --from-schema-datamodel <old> --to-schema-datamodel <new>
-- --script`, then made idempotent by hand (dev databases take this shape via `pnpm db:push`, so
-- the file must apply as a no-op there).
--
-- ADDITIVE ONLY:
--   * four NULLABLE columns on "licenses" with no default — catalogue-only, instant at any row
--     count; every existing license reads exactly as it did (no PO, no renewal date, not
--     suspended);
--   * one NEW table "customer_invoices" (the ARC invoice ledger for INVOICE / PURCHASE_ORDER
--     customers) + its indexes + an FK to "tenants" (ON DELETE CASCADE, like "licenses");
--   * nothing is dropped, renamed or rewritten.
--
-- `lock_timeout`: "licenses" is read on every screen pair and by the billing webhook; ALTER TABLE
-- needs a brief ACCESS EXCLUSIVE lock. Five seconds, then fail (railway-start retries) rather
-- than queue those reads behind a lock.

SET lock_timeout = '5s';

ALTER TABLE "licenses"
  ADD COLUMN IF NOT EXISTS "po_number" TEXT,
  ADD COLUMN IF NOT EXISTS "renewal_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "suspend_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "suspended_at" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "customer_invoices" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "po_number" TEXT,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "sent_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "notes" TEXT,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_invoices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "customer_invoices_number_key" ON "customer_invoices"("number");

CREATE INDEX IF NOT EXISTS "customer_invoices_tenant_id_created_at_idx" ON "customer_invoices"("tenant_id", "created_at");

CREATE INDEX IF NOT EXISTS "customer_invoices_status_due_at_idx" ON "customer_invoices"("status", "due_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customer_invoices_tenant_id_fkey'
  ) THEN
    ALTER TABLE "customer_invoices"
      ADD CONSTRAINT "customer_invoices_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
