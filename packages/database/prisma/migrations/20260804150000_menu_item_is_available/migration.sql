-- POS-sandbox bug #1 (2026-08-04): ingestPosCatalog ignored item.available,
-- so Clover/Lightspeed/Shopify items the POS marks hidden/unavailable still
-- rendered on kiosks. Catalog-level availability now lives on the item;
-- additive-only (default true = existing rows keep rendering).
ALTER TABLE "menu_items" ADD COLUMN "is_available" BOOLEAN NOT NULL DEFAULT true;
