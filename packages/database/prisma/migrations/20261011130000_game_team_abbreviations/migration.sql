-- 2026-10-11 — TEAM ABBREVIATIONS (Muse beta S-04 / DEV-028).
--
-- Two nullable columns on `games`: the operator-set short name for each team
-- (1–5 of A–Z / 0–9). NULL means "derive it from the team name" — which is
-- exactly how every existing game behaves, so no backfill.
--
-- SQL generated with:
--   prisma migrate diff --from-schema-datamodel <master schema> \
--                       --to-schema-datamodel prisma/schema.prisma --script
-- then made idempotent (IF NOT EXISTS) per CLAUDE.md, because dev databases
-- take the same shape through `pnpm db:push`.
--
-- ADDITIVE: nullable, no default, no table rewrite. `lock_timeout` because the
-- public board reads `games` every poll: fail fast and let railway-start retry
-- rather than queue the boards behind a lock.

SET lock_timeout = '5s';

ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "home_abbrev" TEXT;
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "away_abbrev" TEXT;
