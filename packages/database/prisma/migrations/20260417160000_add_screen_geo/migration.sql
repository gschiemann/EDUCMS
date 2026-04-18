-- Sprint 8 — fleet map view. Adds geo + photo to Screen so districts
-- with 100+ displays can manage them on a map instead of a flat list.
-- All nullable; existing screens unaffected until an admin sets a
-- location.
ALTER TABLE "screens" ADD COLUMN "address"   TEXT;
ALTER TABLE "screens" ADD COLUMN "latitude"  DOUBLE PRECISION;
ALTER TABLE "screens" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "screens" ADD COLUMN "photo_url" TEXT;

-- Composite index speeds up the bounding-box query the map view does
-- when zoomed in (WHERE lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?).
CREATE INDEX "screens_lat_lng_idx" ON "screens"("latitude", "longitude")
WHERE "latitude" IS NOT NULL AND "longitude" IS NOT NULL;
