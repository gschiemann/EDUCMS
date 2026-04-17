-- CreateTable
CREATE TABLE "tenant_sso_configs" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "metadata_url" TEXT,
    "entity_id" TEXT,
    "acs_url" TEXT,
    "x509_cert" TEXT,
    "oidc_issuer" TEXT,
    "oidc_client_id" TEXT,
    "oidc_client_secret" TEXT,
    "default_role" TEXT NOT NULL DEFAULT 'RESTRICTED_VIEWER',
    "allowed_email_domain" TEXT,
    "auto_provision" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_sso_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_sso_configs_tenant_id_key" ON "tenant_sso_configs"("tenant_id");

-- AddForeignKey
ALTER TABLE "tenant_sso_configs" ADD CONSTRAINT "tenant_sso_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
