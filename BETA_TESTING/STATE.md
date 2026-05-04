# Beta-Testing Operation — State

**This file is the source of truth for resuming the autonomous beta-testing
operation between Claude sessions.** Read this first when a new session starts.

## Current cycle

- **Cycle**: 1 ✅ DONE · 2 ✅ DONE · 3 IN-PROGRESS.
- **Status**: `TESTING_DISPATCHED` for cycle 3
- **Last commit**: `ff4df07` (Cycle 2 STATE update)
- **Open after cycle 2**: ~11 P1 (mostly retail editors + a few small) + 24 P2

## Cycle 3 dispatch — running NOW

5 retest agents + 1 retail-editor cleanup agent in parallel:
- `auth` retest (verify cycle 1+2 fixes hold + find new bugs)
- `editor` retest
- `integrations` retest
- `emergency` retest (life-safety paranoia mode)
- `player + ai-imports` combined retest
- **retail-editors cleanup** — adding the 6 missing RETAIL widget editors
  (LOOKBOOK_CAROUSEL, STOREFRONT_HOURS, PRICE_CALLOUT, SALE_COUNTDOWN,
  LOYALTY_QR, WAYFINDING_MAP) deferred from cycle 2

Reports persist to:
- `BETA_TESTING/BUG_REPORTS/CYCLE-3-{auth,editor,integrations,emergency,player-ai}.md`
- `BETA_TESTING/FIX_LOG/CYCLE-3-fixes.md` (cleanup agent)

## ✅ Cycle 1 — 13 P0 closed

- `d1e8ff7` — integrations ConnectModal + multipart + PPTX mime + panic 3s
- `0898a8d` — auth-001/002, emergency-002/003/004, player-001/002/003

## ✅ Cycle 2 — 16 P1 closed (+ 9 new widget editors)

- `7b30bb1` — auth + integrations + editor + emergency-mix batches

Fixes shipped this cycle:
- **auth**: cross-tenant FK validation on schedules + playlists; Argon2 timing oracle closed
- **integrations**: POS oauth2 reject (frontend + backend); ad-network PARTNER vs DIRECT branch; PropertiesPanel picker hrefs absolute; api-types bridgeSteps
- **editor**: FITNESS_WORKOUT_TIMER editor; 9 missing widget editors (5 RESTAURANT + 4 BAR); JSON-parse leak fix in 6 array editors
- **emergency**: SOS location string bounded; allClear @AllowPanicBypass
- **player**: latest-version auth gate + throttle
- **ai-imports**: filename sanitization (200-char cap + Windows reserved chars stripped); sample-loader connection separation; AiGenerateModal a11y (role=dialog, aria-modal, focus trap, focus restoration)

## 🟡 Cycle 3 — remaining P1 work

From `BUG_REPORTS/CYCLE-1-TRIAGE.md` not yet fixed:

### editor (deferred from cycle 2)
- 6 RETAIL widget editors still missing: RETAIL_LOOKBOOK_CAROUSEL, RETAIL_STOREFRONT_HOURS, RETAIL_PRICE_CALLOUT, RETAIL_SALE_COUNTDOWN, RETAIL_LOYALTY_QR, RETAIL_WAYFINDING_MAP
- BAR_TAP_LIST + BAR_COCKTAIL_MENU have minimal cases — extend to match other RESTAURANT widgets

### emergency
- BUG-005 — Client-side WS verification only checks signature presence (acknowledged tech debt)
- BUG-006 — Per-screen audit failures silently swallowed
- BUG-008 — Floor plan dimensions from client without server-side probe
- BUG-010 — Player does NOT subscribe to `device:<screenId>` channels — Sprint 8b WS broadcasts only reach screens via HTTP polling

### player
- BUG-004 — Capability data collected but typed body drops it
- BUG-005 — SW precachePlaylist evicts entries by raw URL — Supabase signed URLs rotate hourly
- BUG-006 — `ALL_CLEAR` is in `SENSITIVE_TYPES` — race against AUTH_OK on clock-skewed kiosks
- BUG-007 — WS HELLO falls back to unsigned `dev_` tokens
- BUG-009 — Pairing code 10-attempt collision retry — 11th miss = 500

### ai-imports
- BUG-005 — Imports dropzone has no keyboard/SR path

### auth
- BUG-005 — Already covered by auth-002 fix; spot-check needed

### integrations
- (none open after cycle 2)

## 🔵 P2 — defer to cycle 4 (24 bugs across 6 areas)

See individual area reports in `BUG_REPORTS/CYCLE-1-*.md`. Mostly UX
polish, edge cases, Sprint-2 hardening.

## Cycle 3 plan

**Recommended order:**
1. **RETEST**: dispatch 6 cycle-3 tester agents to verify cycle 1+2 fixes
   hold + look for regressions introduced by the fixes
2. **P1 cleanup wave**: 1-2 agents for the remaining P1s (mostly editor
   + player + emergency leftovers)
3. **P2 batch**: low-priority fixes batched into 2-3 large agents

Token budget: cycle 3 should be roughly half a session given the smaller
P1 surface remaining.

## How to dispatch cycle 3 retest

```
Agent({
  description: "Cycle 3 retest — auth area",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: "Re-run TEST_PLAN.md Area 1 brief PLUS verify these fixes hold: auth-001 (sso.controller.ts assertTenantAccess), auth-002 (users.controller allowlist), auth-003 (schedules FK validation), auth-004 (playlist templateId gate), auth-006 (Argon2 dummy hash). Look for new regressions introduced by these fixes. Write to BETA_TESTING/BUG_REPORTS/CYCLE-3-auth.md."
})
```

Repeat for editor / integrations / emergency / player / ai-imports
(parallel).

## Files committed this run

```
a4546fa — BETA_TESTING infrastructure
fb287f6 — first 4 cycle-1 reports
d1e8ff7 — 4 cycle-1 P0 fixes
1494766 — TRIAGE doc + STATE
3c0b0f1 — fix-wave-2 dispatch state
0898a8d — 8 cycle-1 P0 fixes (auth + emergency + player bundles)
11cf4f1 — STATE update for cycle 2
7b30bb1 — cycle 2 P1 fix wave (16 fixes + 9 new editor cases)
(this commit) — STATE update for cycle 3
```

## Token-budget note for next session

Cycle 1 + Cycle 2 used roughly one full session's tokens. The user
told us tokens would run out and that was expected. State.md is
designed to make resuming trivial — read this file → know exactly
where to start.
