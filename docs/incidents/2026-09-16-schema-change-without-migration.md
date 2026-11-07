# A schema change shipped without a migration (2026-09-16)

**Date:** 2026-09-16

## What happened

On 2026-09-16 commit `684f8576` added three columns to `Screen` in `schema.prisma` and shipped **no migration**. The regenerated client selected columns that did not exist, on the table every manifest poll / heartbeat / register reads, and the fleet errored until the code was reverted.

## Root cause

Every CI gate was green, and `db:push` had made it work on the author's machine — which is exactly why nothing looked wrong.

## What made it last three days

It was then misdiagnosed for three days as "Greg needs to run `db:push`", because two comments in this repo said Railway never migrates. They were stale (true before 2026-05-04).

## The rule it produced

`packages/database/CLAUDE.md` → "A schema change ships a MIGRATION FILE, or it takes production down", rules 1–5; production applies migration files at boot (`scripts/railway-start.sh` → `prisma migrate deploy`).

## Evidence

- Commit `684f8576` is the change that shipped without a migration; the gate `scripts/check-schema-has-migration.cjs` was verified against it ("red").
- The pattern for a correct migration: `packages/database/prisma/migrations/20260919120000_screen_faces/`.
