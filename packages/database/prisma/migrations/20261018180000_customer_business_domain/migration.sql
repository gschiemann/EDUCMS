SET lock_timeout = '5s';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "allocated_seats" INTEGER;

-- AlterTable
ALTER TABLE "licenses" ADD COLUMN IF NOT EXISTS "package_name" TEXT,
ADD COLUMN IF NOT EXISTS "package_price_cents" INTEGER,
ADD COLUMN IF NOT EXISTS "pooled_seats" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "customer_invoices" ADD COLUMN IF NOT EXISTS "pdf_file_name" TEXT,
ADD COLUMN IF NOT EXISTS "pdf_size_bytes" INTEGER,
ADD COLUMN IF NOT EXISTS "pdf_storage_path" TEXT,
ADD COLUMN IF NOT EXISTS "pdf_uploaded_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "platform_costs" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "plan_name" TEXT,
    "monthly_cost_cents" INTEGER NOT NULL,
    "budget_cents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "next_bill_at" TIMESTAMP(3),
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_costs_pkey" PRIMARY KEY ("id")
);


ALTER TABLE platform_costs ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE platform_costs FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE platform_costs FROM authenticated;
  END IF;
END $$;
