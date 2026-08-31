-- Fleet pulse history (2026-08-31): the dashboard's 24h fleet chart needs
-- stored samples to be honest. Additive only; pruned at 7 days by the
-- sampler itself.
CREATE TABLE "fleet_samples" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "online" INTEGER NOT NULL,
    "offline" INTEGER NOT NULL,
    "not_painting" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "fleet_samples_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "fleet_samples_tenant_id_created_at_idx" ON "fleet_samples"("tenant_id", "created_at");
