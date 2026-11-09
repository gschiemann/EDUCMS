# Tap lag on the mobile navigation (2026-06-16)

**Date:** 2026-06-16

## What happened

On 2026-06-16 the mobile bottom-nav + "More" sheet had major tap lag — and since the "More" sheet is a pure local-`useState` toggle (no fetch, no navigation), its lag proved the **main thread / GPU was busy at tap time**: app-wide contention, not the tab bar.

## Root cause

The rule records two root-cause classes, "both now fixed and checked by CI" (`Mobile Perf` workflow).

## Why our system let it reach a customer

Not recorded at the time; the organisational cause was not investigated.

## What pins it

- `apps/web/tools/check-mobile-perf.cjs`
- `.github/workflows/mobile-perf.yml`

## What worked

The "More" sheet is a pure local-`useState` toggle with no fetch or navigation, so its tap lag proved the main thread or GPU was busy at tap time and pointed at app-wide contention rather than the tab bar.

## The rule it produced

`apps/web/CLAUDE.md` → "Mobile performance standard — non-negotiable": never poll a backgrounded tab; no global focus-refetch storm; no GPU-expensive blur on always-mounted mobile chrome; keep the global chrome cheap.

## Evidence

- `apps/web/tools/check-mobile-perf.cjs` (also `pnpm mobile-perf-guard`) enforces rules 1–3; `.github/workflows/mobile-perf.yml` runs it.
