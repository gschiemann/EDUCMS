# Deploys refused the new container's database connections (2026-09-22)

**Date:** 2026-09-22 (measured over 2026-09-16 → 2026-09-22)

## What happened

at the Nano default of 15, 24 of 26 deploys (09-16 → 09-22) refused the new container's connections (`EMAXCONNSESSION … pool_size: 15`) and ~140 manifest / `/emergency/messages` reads 500'd — the API's only 5xx in those six days.

## Root cause

From the reasoning that stays in `packages/database/CLAUDE.md`:

> every Railway deploy runs the old AND the new API container for ~7–19 s, each allowed `connection_limit` connections

## Why our system let it reach a customer

Every deploy runs the old and the new API container together for about 7 to 19 seconds, each allowed `connection_limit` connections, and the Supavisor pool at its Nano default of 15 was smaller than that peak. The record gives no gate or alarm that compared pool size to the overlap; it was found by measuring the API's 5xx over six days.

## What pins it

Nothing pins this yet — GAP.

## What worked

Measuring the six days from 2026-09-16 to 2026-09-22 found that 24 of 26 deploys were refused and that these reads were the API's only 5xx. Raising the pool to 24 after checking `max_connections` headroom contained it.

## The rule it produced

`packages/database/CLAUDE.md` → "DATABASE_URL — why session mode on port 5432": the Supavisor pool size must stay ≥ 2 × replicas × `connection_limit` + spare.

## Evidence

- The pool size was raised to 24 on 2026-09-22 after checking headroom (`max_connections` 60, non-API ≈ 14, so 24 peaks at ~38/60).
