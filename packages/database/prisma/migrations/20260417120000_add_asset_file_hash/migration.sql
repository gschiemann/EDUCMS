-- Add SHA-256 hash column to assets so the offline-cache Service Worker
-- can verify integrity and detect when an asset has been replaced
-- server-side without the URL changing. Nullable so existing rows don't
-- need a backfill (the API falls back to a synthetic hash from
-- url:fileSize when fileHash is null).
ALTER TABLE "assets" ADD COLUMN "file_hash" TEXT;
