-- player-stats S1: shareable public athlete profile (2026-06-22).
-- Additive + nullable: existing rows keep is_public=false / token NULL, so the
-- public endpoint 404s for every athlete until an operator opts in. Idempotent
-- guards so a re-run (or a hand-applied col) never errors.
ALTER TABLE "sports_persons" ADD COLUMN IF NOT EXISTS "is_public" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sports_persons" ADD COLUMN IF NOT EXISTS "public_share_token" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "sports_persons_public_share_token_key" ON "sports_persons" ("public_share_token");
