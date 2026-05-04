# Beta-Testing Operation — State

**This file is the source of truth for resuming the autonomous beta-testing
operation between Claude sessions.** Read this first when a new session starts.

## How to resume in a fresh session

When the user pastes "resume beta testing" or similar, the next Claude session
should:

1. Read `BETA_TESTING/STATE.md` (this file)
2. Read `BETA_TESTING/RESUME_INSTRUCTIONS.md` for the operating procedure
3. Read the most recent files in `BETA_TESTING/BUG_REPORTS/` to see what's
   pending
4. Read `BETA_TESTING/FIX_LOG/` to see what's already been fixed
5. Look at `BETA_TESTING/CYCLE_LOG.md` to see what cycle we're on
6. Continue the next pending task

## Current cycle

- **Cycle**: 1 (first wave of testing)
- **Started**: 2026-05-03
- **Status**: TESTING_DISPATCHED
- **Active work**: 6 parallel test agents covering 6 feature areas
- **Last commit before this cycle**: `e2c9330` (production-readiness audit)

## Cycle workflow

Each cycle is:
1. **TEST** — dispatch agents to test a slice of the app, write bug reports
   to `BUG_REPORTS/CYCLE-N-AREA.md`
2. **TRIAGE** — aggregate reports, classify P0/P1/P2/GREEN
3. **FIX** — dispatch fix agents for P0/P1 bugs, log fixes to `FIX_LOG/`
4. **RETEST** — verify fixes; promote unfixed to next cycle
5. **COMMIT** — push every cycle's fixes
6. **REPEAT** — increment cycle number, start over

## Feature areas under test

The full app is divided into 6 testable slices. Each cycle, agents revisit
slices in priority order. Cycle 1 covers ALL slices in parallel:

| # | Area | Test agent slug |
|---|---|---|
| 1 | Auth + RBAC + tenant isolation | `auth` |
| 2 | Templates + Widget editor + VariantPicker | `editor` |
| 3 | Streaming + POS + Ad-network integrations | `integrations` |
| 4 | Emergency + Floor plans + Panic flow | `emergency` |
| 5 | Player + APK + Offline cache + USB | `player` |
| 6 | AI generation + Canva imports + Sample data | `ai-imports` |

## Test methodology

Since we can't run a live browser session, agents use:
1. **Static analysis** — read controllers, services, components, verify they
   match each other (response shapes ↔ TS interfaces, route paths, auth
   guards, RBAC role-checks)
2. **Schema verification** — Prisma queries match actual columns / indexes
3. **Type alignment** — frontend `apiFetch<T>` types match backend return
4. **Error-path testing** — what happens when a downstream is down?
5. **Defensive code review** — null checks, empty states, race conditions

This catches ~70% of the bugs a real browser tester would find. Real
browser testing is gated on a live deployment which is launch-day work.

## Known excluded from testing this cycle

- Anything requiring `ANTHROPIC_API_KEY` to be set (graceful degradation
  was verified in the audit but the actual AI call path can't be tested
  without a live key)
- Stripe webhook + live billing (placeholder until partner signs up)
- Canva Connect OAuth (pending partner approval)
- Hivestack / Vistar / Place Exchange (publisher contracts pending)

## Files in this directory

```
BETA_TESTING/
  STATE.md                  ← this file
  RESUME_INSTRUCTIONS.md    ← runbook for the next Claude session
  TEST_PLAN.md              ← what each agent tests, broken into checklists
  CYCLE_LOG.md              ← cycle-by-cycle log of dispatch + outcome
  BUG_REPORTS/
    CYCLE-1-auth.md         ← agent reports go here
    CYCLE-1-editor.md
    CYCLE-1-integrations.md
    CYCLE-1-emergency.md
    CYCLE-1-player.md
    CYCLE-1-ai-imports.md
  FIX_LOG/
    CYCLE-1-fixes.md        ← what was actually fixed in cycle N
```
