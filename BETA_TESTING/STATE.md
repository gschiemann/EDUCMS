# Beta-Testing Operation — State

**This file is the source of truth for resuming the autonomous beta-testing
operation between Claude sessions.** Read this first when a new session starts.

## Current cycle

- **Cycle**: 1 → COMPLETE. Cycle 2 ready to start.
- **Started**: 2026-05-03
- **Status**: `CYCLE_DONE` — all 13 P0s from cycle 1 closed.
- **Last commit**: `0898a8d` (8 P0 fix wave + final push)
- **Open**: 27 P1 + 24 P2 — see `BUG_REPORTS/CYCLE-1-TRIAGE.md`

## ✅ Cycle 1 — DONE

13 P0 bugs found, 13 P0 bugs fixed across 4 commits:
- `d1e8ff7` — integrations ConnectModal + BridgeSetupModal (auto-fix), multipart upload, Supabase PPTX mime, panic 3s
- `0898a8d` — auth-001 (SSO), auth-002 (role escalation), emergency-002 (overrideId), emergency-003 (device-scope all-clear), emergency-004 (tenantId guard), player-001 (SW emergency hash), player-002 (sumCacheBytes), player-003 (USB silent enable)

## How to resume in a fresh session

When the user says "resume beta testing":

1. Read `BETA_TESTING/STATE.md` (this file) → confirms cycle 1 done
2. Decide next cycle:
   - **Cycle 2 P1 wave** — pick up from `BUG_REPORTS/CYCLE-1-TRIAGE.md` "P1 — fix this week" section. 27 bugs to address.
   - **Cycle 2 RETEST** — dispatch the same 6 tester agents from cycle 1 to verify the P0 fixes hold + look for regressions. If clean, move to P1 wave.
3. Recommended order: RETEST first (1 wave of 6 agents), then P1 batches (5-7 agents per batch).

## Cycle 2 plan — P1 wave

The P1 list from `CYCLE-1-TRIAGE.md`:

### auth (4)
- BUG-003 — Schedule create/update missing cross-tenant FK validation
- BUG-004 — Playlist create accepts foreign templateId
- BUG-005 — `PUT /users/:id/role` was already covered by auth-002 fix; verify no regression
- BUG-006 — Argon2 timing oracle on user-not-found path

### editor (3)
- BUG-001 — `FITNESS_WORKOUT_TIMER` has no editor case in PropertiesPanel
- BUG-002 — 12 of 19 RESTAURANT/BAR/RETAIL widgets have no editor case
- BUG-003 — JSON-parse failure leaks string into cfg.creatives / classes / quotes mid-keystroke

### integrations (4)
- BUG-003 — POS oauth2 providers save empty PENDING rows silently
- BUG-004 — Ad-network ConnectModal has no PARTNER vs DIRECT differentiation
- BUG-005 — PropertiesPanel picker links use relative `href="settings/streaming"` (404 from template builder)
- BUG-006 — `StreamProviderListItem` API type missing `bridgeSteps`

### emergency (6)
- BUG-005 — Client-side WS verification only checks signature presence not validity
- BUG-006 — Per-screen audit failures silently swallowed
- BUG-007 — SOS location string not strictly bounded
- BUG-008 — Floor plan dimensions from client without server-side probe
- BUG-009 — `ScreenEmergencyController.allClear` lacks `@AllowPanicBypass`
- BUG-010 — Player does NOT subscribe to `device:<screenId>` channels

### player (6)
- BUG-004 — Capability data collected but typed body drops it
- BUG-005 — SW `precachePlaylist` evicts entries by raw URL — Supabase signed URLs rotate hourly
- BUG-006 — `ALL_CLEAR` is in `SENSITIVE_TYPES` — race against AUTH_OK on clock-skewed kiosks
- BUG-007 — WS HELLO falls back to unsigned `dev_` tokens
- BUG-008 — `/api/v1/player/latest-version` is unauthenticated and unthrottled
- BUG-009 — Pairing code 10-attempt collision retry — 11th miss = 500

### ai-imports (4)
- BUG-003 — Filename not sanitized/length-capped in imports
- BUG-004 — Retail+restaurant sample loaders share one POS connection
- BUG-005 — Imports dropzone has no keyboard/SR path
- BUG-006 — AiGenerateModal missing `role="dialog"` / `aria-modal` / focus trap

## How to dispatch cycle 2 — RETEST first

```
Agent({
  description: "Cycle 2 RETEST — auth area",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: "Same brief as cycle-1 auth tester (TEST_PLAN.md Area 1) PLUS verify these P0 fixes hold: auth-001 (sso.controller.ts assertTenantAccess gate works), auth-002 (users.controller role allowlist + email/password validation). Also confirm no regression introduced. Write to BETA_TESTING/BUG_REPORTS/CYCLE-2-auth.md."
})
```

Repeat for editor / integrations / emergency / player / ai-imports.

## How to dispatch cycle 2 — P1 fix wave (after RETEST passes)

Group P1 bugs into batches of 5-7 per agent (each agent gets multiple
bugs from one area). Pattern:

```
Agent({
  description: "Cycle 2 fix — auth P1 batch",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: "Fix all auth P1s from CYCLE-1-TRIAGE.md (BUG-003, 004, 005, 006). One commit at the end is fine. Run typecheck after each. GROUND RULES + write summary to FIX_LOG/CYCLE-2-fixes.md."
})
```

## Token budget tracking

Cycle 1 used ~80% of a session's tokens. Cycle 2 will be similar.
Plan to span 2 sessions if necessary — STATE.md is what makes that
survivable. Save state every commit.

## Files committed

```
a4546fa — BETA_TESTING infrastructure
fb287f6 — first 4 of 6 cycle-1 reports
d1e8ff7 — 4 P0 fixes (integrations + multipart + PPTX + panic 3s)
1494766 — TRIAGE doc + STATE update
3c0b0f1 — fix-wave-2 dispatch state
0898a8d — 8 P0 fixes (auth + emergency + player bundles)  ← current
```
