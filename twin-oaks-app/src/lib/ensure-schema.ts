// Self-healing database schema.
//
// The Vercel build applies the schema best-effort (scripts/vercel-build.sh);
// if that step was skipped or failed, the app would crash on its first query.
// Instead, the root layout calls ensureSchema() — memoized per server
// instance — which probes for the core table and, when missing, applies the
// exact DDL below (generated via `prisma migrate diff --from-empty
// --to-schema-datamodel prisma/schema.prisma --script`, made idempotent).
//
// KEEP IN SYNC: when prisma/schema.prisma changes, regenerate this DDL.

import { prisma } from "./db";

const DDL: string[] = [
  `CREATE SCHEMA IF NOT EXISTS "public"`,

  `CREATE TABLE IF NOT EXISTS "Vendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Vendor_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Receipt" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INBOX',
    "filePath" TEXT,
    "fileName" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "vendorName" TEXT,
    "receiptDate" TIMESTAMP(3),
    "totalCents" INTEGER,
    "salesTaxCents" INTEGER,
    "paymentMethod" TEXT,
    "receiptNumber" TEXT,
    "notes" TEXT,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Expense" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "vendorId" TEXT,
    "vendorName" TEXT,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "salesTaxCents" INTEGER,
    "paymentMethod" TEXT,
    "division" TEXT NOT NULL,
    "accountingCategory" TEXT NOT NULL,
    "managementCategory" TEXT,
    "businessPurpose" TEXT,
    "assetId" TEXT,
    "taxYear" INTEGER NOT NULL,
    "taxStatus" TEXT NOT NULL DEFAULT 'NEEDS_REVIEW',
    "isCapital" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Income" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" TEXT,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "division" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "notes" TEXT,
    "taxYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Income_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Asset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "assetTag" TEXT,
    "kind" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "year" INTEGER,
    "purchaseDate" TIMESTAMP(3),
    "purchasePriceCents" INTEGER,
    "purchasedFrom" TEXT,
    "financingNotes" TEXT,
    "warrantyNotes" TEXT,
    "currentHours" DOUBLE PRECISION,
    "currentMileage" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "MaintenanceRecord" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "hoursAtService" DOUBLE PRECISION,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "partsCostCents" INTEGER,
    "laborCostCents" INTEGER,
    "vendorName" TEXT,
    "notes" TEXT,
    "expenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MaintenanceRecord_pkey" PRIMARY KEY ("id")
)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "Vendor_name_key" ON "Vendor"("name")`,
  `CREATE INDEX IF NOT EXISTS "Receipt_status_idx" ON "Receipt"("status")`,
  `CREATE INDEX IF NOT EXISTS "Receipt_expenseId_idx" ON "Receipt"("expenseId")`,
  `CREATE INDEX IF NOT EXISTS "Expense_date_idx" ON "Expense"("date")`,
  `CREATE INDEX IF NOT EXISTS "Expense_taxYear_division_idx" ON "Expense"("taxYear", "division")`,
  `CREATE INDEX IF NOT EXISTS "Expense_accountingCategory_idx" ON "Expense"("accountingCategory")`,
  `CREATE INDEX IF NOT EXISTS "Expense_taxStatus_idx" ON "Expense"("taxStatus")`,
  `CREATE INDEX IF NOT EXISTS "Expense_assetId_idx" ON "Expense"("assetId")`,
  `CREATE INDEX IF NOT EXISTS "Income_date_idx" ON "Income"("date")`,
  `CREATE INDEX IF NOT EXISTS "Income_taxYear_division_idx" ON "Income"("taxYear", "division")`,
  `CREATE INDEX IF NOT EXISTS "Asset_kind_idx" ON "Asset"("kind")`,
  `CREATE INDEX IF NOT EXISTS "Asset_division_idx" ON "Asset"("division")`,
  `CREATE INDEX IF NOT EXISTS "MaintenanceRecord_assetId_date_idx" ON "MaintenanceRecord"("assetId", "date")`,

  // ————— V2: revenue loop + mileage —————

  `CREATE TABLE IF NOT EXISTS "Customer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "division" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3),
    "terms" TEXT,
    "notes" TEXT,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "salesTaxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "taxYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "Payment" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT,
    "checkNumber" TEXT,
    "notes" TEXT,
    "incomeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
)`,

  `CREATE TABLE IF NOT EXISTS "MileageLog" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "startLocation" TEXT,
    "destination" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "customerName" TEXT,
    "vehicleAssetId" TEXT,
    "startOdometer" DOUBLE PRECISION,
    "endOdometer" DOUBLE PRECISION,
    "miles" DOUBLE PRECISION NOT NULL,
    "notes" TEXT,
    "taxYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MileageLog_pkey" PRIMARY KEY ("id")
)`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "Invoice_number_key" ON "Invoice"("number")`,
  `CREATE INDEX IF NOT EXISTS "Invoice_customerId_idx" ON "Invoice"("customerId")`,
  `CREATE INDEX IF NOT EXISTS "Invoice_status_idx" ON "Invoice"("status")`,
  `CREATE INDEX IF NOT EXISTS "Invoice_taxYear_idx" ON "Invoice"("taxYear")`,
  `CREATE INDEX IF NOT EXISTS "Payment_invoiceId_idx" ON "Payment"("invoiceId")`,
  `CREATE INDEX IF NOT EXISTS "MileageLog_date_idx" ON "MileageLog"("date")`,
  `CREATE INDEX IF NOT EXISTS "MileageLog_taxYear_idx" ON "MileageLog"("taxYear")`,

  `DO $$ BEGIN
    ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Payment" ADD CONSTRAINT "Payment_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "MileageLog" ADD CONSTRAINT "MileageLog_vehicleAssetId_fkey" FOREIGN KEY ("vehicleAssetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // Foreign keys have no IF NOT EXISTS — swallow duplicate_object instead.
  `DO $$ BEGIN
    ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "Expense" ADD CONSTRAINT "Expense_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `DO $$ BEGIN
    ALTER TABLE "MaintenanceRecord" ADD CONSTRAINT "MaintenanceRecord_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
];

export type DbStatus =
  | { ok: true }
  | { ok: false; reason: string; detail?: string; envNames: string[] };

function dbEnvNames(): string[] {
  return Object.keys(process.env)
    .filter((k) => /DATABASE|POSTGRES|NEON|^PG/.test(k))
    .sort();
}

declare global {
  var __twinOaksSchemaEnsured: Promise<DbStatus> | undefined;
}

async function ensureSchemaOnce(): Promise<DbStatus> {
  if (!process.env.DATABASE_URL) {
    return {
      ok: false,
      reason: "No DATABASE_URL environment variable is set.",
      envNames: dbEnvNames(),
    };
  }
  try {
    // Probe the NEWEST table — if an older deploy's schema is present but a
    // newer model is missing, the idempotent DDL below fills the gap.
    await prisma.$queryRawUnsafe(`SELECT 1 FROM "MileageLog" LIMIT 1`);
    return { ok: true }; // schema already present
  } catch (probeErr) {
    // Table missing (or connection issue) — attempt to apply the schema.
    try {
      for (const stmt of DDL) {
        await prisma.$executeRawUnsafe(stmt);
      }
      await prisma.$queryRawUnsafe(`SELECT 1 FROM "MileageLog" LIMIT 1`);
      console.log("[twin-oaks] database schema applied by self-heal");
      return { ok: true };
    } catch (healErr) {
      const detail =
        healErr instanceof Error ? healErr.message : String(healErr ?? probeErr);
      console.error("[twin-oaks] schema self-heal failed:", detail);
      return {
        ok: false,
        reason: "Could not reach the database or apply the schema.",
        detail: detail.slice(0, 500),
        envNames: dbEnvNames(),
      };
    }
  }
}

// Memoized per server instance; never throws.
export function ensureSchema(): Promise<DbStatus> {
  if (!globalThis.__twinOaksSchemaEnsured) {
    globalThis.__twinOaksSchemaEnsured = ensureSchemaOnce().catch((e) => ({
      ok: false as const,
      reason: "Unexpected error while checking the database.",
      detail: e instanceof Error ? e.message.slice(0, 500) : String(e),
      envNames: dbEnvNames(),
    }));
  }
  return globalThis.__twinOaksSchemaEnsured;
}
