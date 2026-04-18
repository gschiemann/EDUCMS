-- License + multi-vertical (Sprint 7E)
--
-- Per-tenant License row. The billing meter is the count of paired Screens.
-- When register() would push currentSeats above seatLimit, we reject with
-- LICENSE_EXHAUSTED and prompt the admin to add seats.
--
-- Tenant.vertical drives default templates / widget palette / pricing tier
-- so one codebase can serve K-12 + restaurants + retail + healthcare +
-- corporate without cross-contamination.

ALTER TABLE "tenants" ADD COLUMN "vertical" TEXT NOT NULL DEFAULT 'K12';

CREATE TABLE "licenses" (
    "id"                       TEXT NOT NULL,
    "tenant_id"                TEXT NOT NULL,
    "tier"                     TEXT NOT NULL,
    "seat_limit"               INTEGER NOT NULL DEFAULT 3,
    "billing_mode"             TEXT NOT NULL DEFAULT 'CARD',
    "status"                   TEXT NOT NULL DEFAULT 'ACTIVE',
    "monthly_price_cents"      INTEGER,
    "stripe_customer_id"       TEXT,
    "stripe_subscription_id"   TEXT,
    "current_period_start"     TIMESTAMP(3),
    "current_period_end"       TIMESTAMP(3),
    "expires_at"               TIMESTAMP(3),
    "notes"                    TEXT,
    "created_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "licenses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "licenses_tenant_id_key" ON "licenses"("tenant_id");

ALTER TABLE "licenses" ADD CONSTRAINT "licenses_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
