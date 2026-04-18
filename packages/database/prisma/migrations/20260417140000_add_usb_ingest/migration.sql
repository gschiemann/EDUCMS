-- Sprint 7B — USB sneakernet ingestion. Off by default; admins opt in
-- per tenant. The HMAC key signs every USB bundle's manifest so a
-- random/stolen stick can't push content to a paired screen.

ALTER TABLE "tenants" ADD COLUMN "usb_ingest_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "tenants" ADD COLUMN "usb_ingest_key" TEXT;
ALTER TABLE "tenants" ADD COLUMN "usb_ingest_key_rotated_at" TIMESTAMP(3);

-- Immutable audit log of every USB ingest attempt (accepted, rejected,
-- partial, or cancelled). Critical for life-safety: lets an admin trace
-- exactly when emergency content was sideloaded by which operator.
CREATE TABLE "usb_ingest_events" (
    "id"               TEXT NOT NULL,
    "tenant_id"        TEXT NOT NULL,
    "screen_id"        TEXT,
    "device_serial"    TEXT,
    "bundle_version"   TEXT,
    "asset_count"      INTEGER NOT NULL DEFAULT 0,
    "total_bytes"      BIGINT NOT NULL DEFAULT 0,
    "emergency_assets" BOOLEAN NOT NULL DEFAULT false,
    "outcome"          TEXT NOT NULL,
    "reason"           TEXT,
    "operator_pin"     TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usb_ingest_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "usb_ingest_events_tenant_id_created_at_idx"
    ON "usb_ingest_events"("tenant_id", "created_at");

ALTER TABLE "usb_ingest_events" ADD CONSTRAINT "usb_ingest_events_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
