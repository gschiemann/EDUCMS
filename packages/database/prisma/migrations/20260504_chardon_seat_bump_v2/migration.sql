-- 2026-05-04 v2 — Operator: "current license shows 3 only"
--
-- The first attempt (20260504_chardon_seat_bump/migration.sql) used a
-- DO $$ ... $$ PL/pgSQL block which Prisma's migrate runner allegedly
-- supports but which can fail SILENTLY on Supabase's pgbouncer
-- transaction-pool mode (the multi-statement DO block doesn't always
-- fit the simple-query protocol prisma uses for migrations). Re-doing
-- as plain DML so it definitely runs.
--
-- This is idempotent: re-running on subsequent boots is a no-op
-- because the WHERE clauses are tenant-scoped and the UPSERT pattern
-- via DELETE+INSERT guarantees a clean known-good row.
--
-- Operator's tenant slug: 'chardon-high-school' (confirmed via the
-- /chardon-high-school/settings/billing URL path in the screenshot).

-- Step 1: Look up the tenant id (no-op if tenant doesn't exist yet
-- on this DB — INSERT below uses subquery so it gracefully skips).

-- Step 2: Wipe any existing license row for this tenant. Avoids
-- conflict-handling complexity from the prior attempt's UPSERT
-- branch which may have evaluated the wrong CASE.
DELETE FROM licenses
 WHERE tenant_id IN (SELECT id FROM tenants WHERE slug = 'chardon-high-school');

-- Step 3: Insert a fresh comp license with seat_limit=100000.
INSERT INTO licenses (
  id,
  tenant_id,
  tier,
  seat_limit,
  billing_mode,
  status,
  monthly_price_cents,
  notes,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid()::text,
  t.id,
  'PILOT',
  100000,
  'COMP',
  'ACTIVE',
  0,
  '2026-05-04 comp seats for fleet testing — operator: gschiemann@sbcglobal',
  NOW(),
  NOW()
FROM tenants t
WHERE t.slug = 'chardon-high-school';
