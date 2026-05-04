-- 2026-05-04 — Operator-requested seat bump for the Chardon High School
-- pilot tenant. Tenant slug: 'chardon-high-school'. Default PILOT tier
-- is 3 seats; operator is testing a fleet and needs unlimited.
--
-- Idempotent: this migration runs once on Railway boot. It UPSERTS the
-- License row for this tenant — creates one if missing, updates it if
-- present. Cap is 100k (the SUPER_ADMIN API enforces this hard limit
-- so we stay under it).
--
-- Safe to re-run: the WHERE clauses are tenant-scoped and idempotent;
-- nothing else in the schema depends on License rows beyond the seat-
-- enforcement check in ScreenService.register(), which reads
-- seatLimit and short-circuits when seatsUsed < seatLimit.

DO $$
DECLARE
  target_tenant_id TEXT;
BEGIN
  SELECT id INTO target_tenant_id
    FROM tenants
   WHERE slug = 'chardon-high-school'
   LIMIT 1;

  IF target_tenant_id IS NULL THEN
    RAISE NOTICE 'Tenant "chardon-high-school" not found — skipping seat bump';
    RETURN;
  END IF;

  -- Upsert License row.  Schema in packages/database/prisma/schema.prisma:
  --   id, tenantId (unique), tier, seatLimit, currentSeats, billingMode,
  --   status, monthlyPriceCents, currentPeriodEnd, expiresAt, notes,
  --   createdAt, updatedAt, ...
  IF EXISTS (SELECT 1 FROM licenses WHERE tenant_id = target_tenant_id) THEN
    UPDATE licenses
       SET seat_limit = 100000,
           tier = 'PILOT',
           billing_mode = 'COMP',
           status = 'ACTIVE',
           monthly_price_cents = 0,
           notes = COALESCE(notes, '') ||
                   ' [2026-05-04 seat bump to 100k for fleet testing]',
           updated_at = NOW()
     WHERE tenant_id = target_tenant_id;
    RAISE NOTICE 'Bumped Chardon High School License to 100000 seats';
  ELSE
    INSERT INTO licenses (
      id, tenant_id, tier, seat_limit,
      billing_mode, status, monthly_price_cents,
      notes, created_at, updated_at
    ) VALUES (
      gen_random_uuid()::text,
      target_tenant_id,
      'PILOT',
      100000,
      'COMP',
      'ACTIVE',
      0,
      '2026-05-04 comp seats for fleet testing',
      NOW(),
      NOW()
    );
    RAISE NOTICE 'Created comp License for Chardon High School with 100000 seats';
  END IF;
END $$;
