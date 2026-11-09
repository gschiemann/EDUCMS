# Deploys refused the new container's database connections (2026-09-22)

**Date:** 2026-09-22 (measured over 2026-09-16 → 2026-09-22)

## What happened

at the Nano default of 15, 24 of 26 deploys (09-16 → 09-22) refused the new container's connections (`EMAXCONNSESSION … pool_size: 15`) and ~140 manifest / `/emergency/messages` reads 500'd — the API's only 5xx in those six days.

## Root cause

From the reasoning that stays in `packages/database/CLAUDE.md`:

> every Railway deploy runs the old AND the new API container for ~7–19 s, each allowed `connection_limit` connections

## Why our system let it reach a customer

Every deploy runs the old and the new API container together for about 7 to 19 seconds, each allowed `connection_limit` connections, and the Supavisor pool at its Nano default of 15 was smaller than that peak. The record gives no gate or alarm that compared pool size to the overlap; it was found by measuring the API's 5xx over six days.

**Why the gap stays open (checked 2026-11-08):** the rule is about the Supavisor pool size (a Supabase project setting) against the overlap peak of 2 x replicas x `connection_limit`. The boot guard in `apps/api/src/main.ts` does not cover it: it refuses a production `DATABASE_URL` only when the URL says `pgbouncer=true` without `connection_limit>=10` and `pool_timeout>=20`, which is the single-connection-pool failure and not this one (the URL is session mode and carries no `pgbouncer`); the logic is inline in `bootstrap` and not exported, so it has no unit test to extend. The pool size is not readable from the URL or from the API's environment. What would make a mechanism possible: a scheduled check that reads the pool size and `max_connections` through the Supabase management API (a credential this repository deliberately does not hold) and compares them to the documented formula, or a boot-time probe that counts `EMAXCONNSESSION` refusals and reports them.

## What pins it

Nothing pins this yet — GAP.

## What worked

Measuring the six days from 2026-09-16 to 2026-09-22 found that 24 of 26 deploys were refused and that these reads were the API's only 5xx. Raising the pool to 24 after checking `max_connections` headroom contained it.

## The rule it produced

`packages/database/CLAUDE.md` → "DATABASE_URL — why session mode on port 5432": the Supavisor pool size must stay ≥ 2 × replicas × `connection_limit` + spare.

## Evidence

- The pool size was raised to 24 on 2026-09-22 after checking headroom (`max_connections` 60, non-API ≈ 14, so 24 peaks at ~38/60).
