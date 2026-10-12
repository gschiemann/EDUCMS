-- 2026-10-12 — VenueOS + AI plan (owner pricing decision, 2026-10-12).
--
-- Plans per screen: VenueOS $20/mo · $200/yr, VenueOS + AI $25/mo · $250/yr. AI on OUR platform
-- keys is available only to an organisation whose License says `ai_included` (or that is in its
-- free trial). The Stripe webhook stamps it from the subscription's price id; the super-admin
-- customer console toggles it for invoice / PO / comp licenses.
--
-- ADDITIVE AND NON-DESTRUCTIVE: one NOT NULL column with a constant DEFAULT (a catalogue-only
-- change in Postgres 11+, instant at any row count); every existing license reads false.
-- IDEMPOTENT (`IF NOT EXISTS`) because dev databases take the shape via `pnpm db:push` first.
-- `licenses` is read on pairing and billing paths, so fail fast rather than queue behind a lock.

SET lock_timeout = '5s';

ALTER TABLE "licenses"
  ADD COLUMN IF NOT EXISTS "ai_included" BOOLEAN NOT NULL DEFAULT false;
