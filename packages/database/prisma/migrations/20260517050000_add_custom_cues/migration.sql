-- VenueOS Sports — the cue deck.
-- An operator-defined trigger: a named button with uploaded content
-- that fires a full-screen takeover on the scoreboard. Per-tenant,
-- reusable across games. New table only; fully additive.
CREATE TABLE "custom_cues" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "media_url" TEXT,
    "color" TEXT,
    "duration_ms" INTEGER NOT NULL DEFAULT 6000,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "custom_cues_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "custom_cues_tenant_id_sort_order_idx"
    ON "custom_cues"("tenant_id", "sort_order");
