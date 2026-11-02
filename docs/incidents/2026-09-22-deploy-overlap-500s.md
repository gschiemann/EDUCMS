# Deploys refused the new container's database connections (2026-09-22)

**Date:** 2026-09-22 (measured over 2026-09-16 → 2026-09-22)

## What happened

at the Nano default of 15, 24 of 26 deploys (09-16 → 09-22) refused the new container's connections (`EMAXCONNSESSION … pool_size: 15`) and ~140 manifest / `/emergency/messages` reads 500'd — the API's only 5xx in those six days.

## Root cause

From the reasoning that stays in `packages/database/CLAUDE.md`:

> every Railway deploy runs the old AND the new API container for ~7–19 s, each allowed `connection_limit` connections

## The rule it produced

`packages/database/CLAUDE.md` → "DATABASE_URL — why session mode on port 5432": the Supavisor pool size must stay ≥ 2 × replicas × `connection_limit` + spare.

## Evidence

- The pool size was raised to 24 on 2026-09-22 after checking headroom (`max_connections` 60, non-API ≈ 14, so 24 peaks at ~38/60).
