-- 2026-08-24 — full device-inventory report (vendor packages, settings keys,
-- serial nodes, admin/device-owner state) from DisplayCapabilityProbe.
-- Separate table so the manifest's full-Screen-row reads never carry it
-- (the 2026-08-14 egress lesson). Additive-only per the V1 migration rule.
CREATE TABLE IF NOT EXISTS "screen_device_inventory" (
    "screen_id" TEXT NOT NULL,
    "tenant_id" TEXT,
    "report" JSONB NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "screen_device_inventory_pkey" PRIMARY KEY ("screen_id")
);

CREATE INDEX IF NOT EXISTS "screen_device_inventory_tenant_id_idx"
    ON "screen_device_inventory"("tenant_id");

ALTER TABLE "screen_device_inventory"
    ADD CONSTRAINT "screen_device_inventory_screen_id_fkey"
    FOREIGN KEY ("screen_id") REFERENCES "screens"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
