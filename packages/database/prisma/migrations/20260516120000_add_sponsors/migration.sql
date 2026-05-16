-- VenueOS Sports — Sprint 13 Phase 2. Sponsorship.
-- One new table: `sponsors` (a venue's advertisers). Active sponsors
-- rotate through the scoreboard's banner slot; proof-of-play is
-- computed at read time, so there is no per-impression table and no
-- write path from the public board. Purely additive — safe to apply
-- to the live pilot tenants.

-- CreateTable
CREATE TABLE "sponsors" (
    "id"         TEXT NOT NULL,
    "tenant_id"  TEXT NOT NULL,
    "name"       TEXT NOT NULL,
    "logo_url"   TEXT,
    "tagline"    TEXT,
    "color"      TEXT,
    "tier"       TEXT,
    "weight"     INTEGER NOT NULL DEFAULT 1,
    "active"     BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sponsors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sponsors_tenant_id_active_idx" ON "sponsors"("tenant_id", "active");

-- AddForeignKey
ALTER TABLE "sponsors" ADD CONSTRAINT "sponsors_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
