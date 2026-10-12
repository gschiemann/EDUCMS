-- 2026-10-11 — SSO email-domain verification (launch security re-audit V-2).
--
-- A tenant's `allowed_email_domain` used to route every sign-in for that
-- domain to the tenant's identity provider the moment an admin typed it. Now a
-- claim routes (and auto-provisions) only once it is VERIFIED — a DNS TXT
-- record or an audited super-admin override — and a domain can be verified by
-- at most one tenant.
--
-- ADDITIVE AND NON-DESTRUCTIVE: three NULLABLE columns, no default, so every
-- existing claim reads as UNVERIFIED (NULL) — which is the intended change.
-- Production had zero tenant_sso_configs rows when this shipped.
-- IDEMPOTENT (`IF NOT EXISTS`) because dev databases take the shape via
-- `pnpm db:push` first. The partial unique index is not expressible in
-- schema.prisma; it lives here only (the service also checks before writing).

SET lock_timeout = '5s';

ALTER TABLE "tenant_sso_configs"
  ADD COLUMN IF NOT EXISTS "domain_verification_token" TEXT,
  ADD COLUMN IF NOT EXISTS "domain_verified_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "domain_verification_method" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "tenant_sso_configs_verified_domain_key"
  ON "tenant_sso_configs" (lower("allowed_email_domain"))
  WHERE "domain_verified_at" IS NOT NULL;
