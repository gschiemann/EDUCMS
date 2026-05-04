-- 2026-05-04 — Bump every PILOT-tier License row to 1000 seats.
--
-- Operator: "bro WTF, your keeping me from testing".
--
-- Two prior tenant-scoped seat bumps (chardon_seat_bump v1 + v2)
-- failed to take effect on the operator's pilot tenant. Likely
-- causes: tenant slug mismatch, pgbouncer transaction-pool
-- rejecting the DDL, or some other Supabase quirk.
--
-- This third attempt is intentionally unconditional: bumps EVERY
-- License row currently at the 3-seat pilot default, regardless of
-- which tenant it belongs to. Pre-customer (no paying tenants), the
-- only active License rows are operator's own test tenants — safe
-- to sweep.
--
-- Paired with the LicenseService.PILOT_SEAT_LIMIT default raised
-- from 3 → 1000 in the same commit. Tenants with NO License row
-- get 1000 from the default. Tenants WITH a License row at 3 get
-- bumped to 1000 here.
--
-- Idempotent: re-running on subsequent boots is a no-op except for
-- the updated_at touch on rows that match.

UPDATE licenses
   SET seat_limit = 1000,
       billing_mode = 'COMP',
       status = 'ACTIVE',
       monthly_price_cents = 0,
       notes = COALESCE(notes, '') || ' [2026-05-04 sweep: PILOT default raised 3→1000]',
       updated_at = NOW()
 WHERE tier = 'PILOT'
   AND seat_limit <= 10;
