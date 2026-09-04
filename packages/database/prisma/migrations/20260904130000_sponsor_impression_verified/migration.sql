-- SEC-007 follow-up (2026-09-04) — proof-of-play evidence gets a real column.
--
-- The beacon-capability fix could tell a verified sponsor impression from an
-- anonymous one, but had nowhere to put the answer: the agent that wrote it
-- could not run `prisma generate` in its worktree, so it recorded verified
-- impressions as an attestation row in `game_events` and derived the split
-- with a join. That works, and it stays (it is the forensic record, carrying
-- the nonce and sequence). It is not where a contractual number should live.
--
-- ADDITIVE AND NON-DESTRUCTIVE, deliberately:
--   • `verified BOOLEAN NOT NULL DEFAULT false` — Postgres 11+ stores a
--     non-volatile default in the catalogue, so this is instant and rewrites
--     no rows no matter how large the table is;
--   • EVERY EXISTING ROW THEREFORE READS AS UNVERIFIED, which is exactly
--     the required outcome — those impressions were reported by anonymous
--     beacons and cannot be graded as evidence — and no customer row is
--     read, rewritten or deleted to say it;
--   • `screen_id` is nullable with no FK, on purpose: it is provenance, not
--     a relation, and a deleted screen must never cascade away a sponsor's
--     proof-of-play history.
--
-- `IF NOT EXISTS` so a database that already took this shape from a
-- `db push` applies it as a no-op.

ALTER TABLE "sponsor_impressions" ADD COLUMN IF NOT EXISTS "verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "sponsor_impressions" ADD COLUMN IF NOT EXISTS "screen_id" TEXT;
