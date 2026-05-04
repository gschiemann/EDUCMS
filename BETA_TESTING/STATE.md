# Beta-Testing Operation — State

**This file is the source of truth for resuming the autonomous beta-testing
operation between Claude sessions.** Read this first when a new session starts.

## Current cycle

- **Cycle**: 1 ✅ DONE · 2 ✅ DONE · 3 ✅ DONE. Cycle 4 ready to start.
- **Status**: `CYCLE_DONE` after cycle 3.
- **Last commit**: `642c2b4` (Cycle 3 P0 regression fixes)
- **Open after cycle 3**: ~15 P1 (mostly small UX + asymmetry) + 30+ P2

## ✅ Cycle 1 — 13 P0 closed
- `d1e8ff7` integrations + multipart + PPTX + panic 3s
- `0898a8d` auth + emergency + player bundles

## ✅ Cycle 2 — 16 P1 closed (+ 9 new widget editors)
- `7b30bb1` auth + integrations + editor + emergency-mix batches

## ✅ Cycle 3 — 22 cycle-1+2 fixes verified GREEN, 4 P0 regressions fixed, 6 RETAIL editors added
- `b0aa3a8` retail editor cleanup + 5 retest reports
- `642c2b4` 4 P0 regressions:
  - emergency-011 device JWT missing tenantId/deviceId (WS broadcasts silently dropping in prod)
  - emergency-012 SUPER_ADMIN cross-tenant regression
  - player-014 page-side ref poisoned before SW acks (nullified player-001 fix)
  - player-015 SW v2 deleted v1 emergency cache before populating v2

## 🟡 Cycle 4 — remaining P1 work (~15 bugs)

From cycle-3 retest reports:

### auth (P1 from cycle 3)
- BUG-011 — `PUT /users/:id/role` allows SUPER_ADMIN to demote another SUPER_ADMIN in same tenant
- BUG-012 — `PUT /schedules/:id` body type drops `playlistId`; silent no-op on re-target
- BUG-013 — `DELETE /users/:id` returns HTTP 200 + `{error}` body instead of HttpException

### integrations (P1 from cycle 3)
- BUG-007 — Streaming oauth2 has no API-side reject (asymmetric vs POS); curl bypass creates orphan PENDING rows
- BUG-008 — Quick Start "Background music" card opens a permanently-disabled Connect modal (oauth2 dead-end UX)

### emergency (P1 + P2 still open from cycle 1+3)
- BUG-005 — Client-side WS verification only checks signature presence not validity
- BUG-006 — Per-screen audit failures silently swallowed (still not fixed; cycle-3 confirmed open)
- BUG-008 — Floor plan dimensions from client without server-side probe
- BUG-013 — Panic page UI string still says "1.5 seconds" but actual hold is 3000ms (cycle-3 finding)

### editor (P1 from cycle 3)
- `BAR_TAP_LIST` + `BAR_COCKTAIL_MENU` minimal editor cases — only title + posSync. Operator can't edit `taps[]` / `cocktails[]` rows when posSync is off. Same fix pattern as editor-BUG-002 cycle-2 work.

### player (P1 from cycle 1+3)
- BUG-005 — SW precachePlaylist evicts entries by raw URL — Supabase signed URLs rotate hourly, evicting entire cache
- BUG-006 — `ALL_CLEAR` is in `SENSITIVE_TYPES` — race against AUTH_OK on clock-skewed kiosks
- BUG-007 — WS HELLO falls back to unsigned `dev_` tokens
- BUG-009 — Pairing code 10-attempt collision retry — 11th miss = 500

### ai-imports (P1 + P2)
- BUG-005 — Imports dropzone has no keyboard/SR path

## 🔵 P2 — defer to cycle 5+ (30+ bugs)
See cycle-1 + cycle-3 area reports.

## Cycle 4 plan

**Recommended order:**
1. Single fix wave — 1 batch agent per area covering the remaining P1s
2. Optional: cycle-4 retest (lighter pass — only re-verify cycle 3's P0 fixes + the new P1 fixes)
3. P2 batch — 2-3 large agents for the 30+ P2s

Token budget: cycle 4 P1 wave should be a half-session.

## How to resume

When user says "resume beta testing":
1. Read this STATE.md → see cycle 3 done
2. Decide: cycle 4 P1 fix wave OR cycle 4 retest first
3. Use the same dispatch pattern as cycles 2+3 (Agent + run_in_background + GROUND RULES + write to FIX_LOG/CYCLE-4-fixes.md)
4. After fixes land, preflight + commit + push + STATE update

## Commit ledger

```
a4546fa  BETA_TESTING infrastructure
fb287f6  4 cycle-1 reports mid-cycle save
d1e8ff7  4 cycle-1 P0 fixes
1494766  TRIAGE doc
3c0b0f1  fix-wave-2 dispatch state
0898a8d  8 cycle-1 P0 fixes (full)
11cf4f1  STATE for cycle 2
7b30bb1  16 cycle-2 P1 fixes + 9 editors
ff4df07  STATE for cycle 3
49c513c  Cycle 3 dispatch state
b0aa3a8  Cycle 3 retests + 6 RETAIL editors
642c2b4  4 cycle-3 P0 regression fixes  ← current
(this commit)  STATE for cycle 4
```
