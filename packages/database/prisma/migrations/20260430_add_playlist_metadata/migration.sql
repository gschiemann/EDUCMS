ALTER TABLE "playlists"
  ADD COLUMN IF NOT EXISTS "created_by_user_id" TEXT,
  ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'playlists_created_by_user_id_fkey'
  ) THEN
    ALTER TABLE "playlists"
      ADD CONSTRAINT "playlists_created_by_user_id_fkey"
      FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "playlists_tenant_id_updated_at_idx" ON "playlists"("tenant_id", "updated_at");
CREATE INDEX IF NOT EXISTS "playlists_tenant_id_created_at_idx" ON "playlists"("tenant_id", "created_at");
CREATE INDEX IF NOT EXISTS "playlists_created_by_user_id_idx" ON "playlists"("created_by_user_id");
