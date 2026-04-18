-- MED-2 audit fix. The original constraint was ON DELETE RESTRICT, which
-- meant any tenant that ever ingested a single USB bundle could never be
-- deleted (the events table held a reference forever). Switch to CASCADE
-- so deleting a tenant naturally drops its ingest history with it.
ALTER TABLE "usb_ingest_events"
  DROP CONSTRAINT "usb_ingest_events_tenant_id_fkey";

ALTER TABLE "usb_ingest_events"
  ADD CONSTRAINT "usb_ingest_events_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
