# Beta-Testing Operation — State

**This file is the source of truth for resuming the autonomous beta-testing
operation between Claude sessions.** Read this first when a new session starts.

## Current cycle

- **Cycle**: 1 (fixing wave 2 dispatched)
- **Started**: 2026-05-03
- **Status**: `FIXING_DISPATCHED` — 4 fix agents covering 8 remaining P0s in parallel
- **Last commit**: `1494766` (TRIAGE doc + STATE)
- **Fix agents in flight**:
  - `auth-001` — SSO cross-tenant write
  - `auth-002` — role escalation + email/password validation
  - `emergency-002+003+004` — 3 bundled (overrideId, device-scope all-clear, tenantId guard)
  - `player-001+002+003` — 3 bundled (SW emergency hash, sumCacheBytes, USB silent enable)
- **Reports persist to**: `BETA_TESTING/FIX_LOG/CYCLE-1-fixes.md`
- **Triage**: see `BUG_REPORTS/CYCLE-1-TRIAGE.md` for the full work-list

## What to do if THIS session ends before agents finish

1. Read `BETA_TESTING/FIX_LOG/CYCLE-1-fixes.md` — see what's been fixed
2. `git status` — check what files were modified by agents
3. For any bug NOT in the fix log, dispatch another agent to fix it
4. Run `pnpm preflight` — verify nothing broken
5. Commit with message listing every bug fixed: "Cycle 1 fix wave 2 — auth-001, auth-002, emergency-002+003+004, player-001+002+003"
6. Push, update STATE.md status to `CYCLE_DONE`
7. Start cycle 2 — re-test all areas (especially auth + emergency + player) for regressions

## How to resume in a fresh session

When the user says "resume beta testing" in a new session:

1. Read `BETA_TESTING/STATE.md` (this file) — confirms current cycle + status
2. Read `BETA_TESTING/BUG_REPORTS/CYCLE-1-TRIAGE.md` — that's the punch-list
3. Dispatch fix agents for the remaining P0s — one bug per agent, run in parallel
4. After fixes land, run `pnpm preflight`, commit, push
5. When all P0s clear, start cycle 2 (re-test the fixed areas + start P1 wave)

## Remaining P0 bugs (9) — pick agents up here

From `BUG_REPORTS/CYCLE-1-TRIAGE.md`:

| ID | Area | File | One-line |
|---|---|---|---|
| auth-001 | Security | `apps/api/src/sso/sso.controller.ts:140-172` | Cross-tenant SSO config write — DISTRICT_ADMIN can take over another tenant's login |
| auth-002 | Security | `apps/api/src/users/users.controller.ts:26-48` | Role escalation at user creation — no enum validation on role string |
| emergency-002 | Forensics | `apps/web/src/actions/trigger-emergency.ts:41` | All-clear hardcodes overrideId='global_clear' — breaks audit chain |
| emergency-003 | Reliability | `apps/api/src/emergency/emergency.controller.ts:520-531` | Device-scope all-clear doesn't delete screenEmergencyOverride — screens stuck on lockdown |
| emergency-004 | Security | `apps/api/src/screens/screen-emergency.controller.ts:359` | DISTRICT_ADMIN with undefined tenantId can bulk-trigger across tenants |
| player-001 | Reliability | `apps/web/public/sw-player.js refreshEmergencyCache` | SW writes emergency hash before downloads complete — emergency cache silently broken on retry |
| player-002 | Reliability | `apps/web/public/sw-player.js sumCacheBytes` | content-length missing on Supabase responses — soft-cap eviction never fires |
| player-003 | Security | (USB export endpoint) | USB auto-flips usbIngestEnabled silently — contradicts default-off opt-in policy |
| (BridgeSetupModal continue) | UX | (auto-fixed by integrations-001 fix) | ✅ Fixed via the ConnectModal default fix |

## How to dispatch fix agents (one bug each)

```
Agent({
  description: "Fix auth-001 cross-tenant SSO write",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: "<bug description from TRIAGE.md + acceptance criteria + GROUND RULES + write to BETA_TESTING/FIX_LOG/CYCLE-1-fixes.md when done>"
})
```

GROUND RULES (paste into every fix-agent prompt):

```
1. Read before edit. Read the file FULLY first.
2. Don't break TypeScript. Run `cd apps/web && npx tsc --noEmit` and
   `cd apps/api && npx tsc --noEmit` after the fix. Pre-existing test
   errors (RoleGate.test.tsx, touch-widgets.test.tsx, screens.register
   .spec.ts) are NOISE — IGNORE.
3. Preserve existing data flow. Don't refactor logic, only fix the bug.
4. NO EMOJI in code.
5. Don't write new docs / .md files unless explicitly asked.
6. DO NOT push or commit. Leave that to the orchestrator.
7. Final report: under 200 words. List exactly what changed:
   `Files changed: <path:line>`. Acceptance test that proves it works.
```

## How to dispatch round-2 testers (after P0 fixes land)

After the P0 wave clears:

```
Agent({
  description: "Cycle 2 — re-test auth area",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: "<area brief from TEST_PLAN.md + 'verify the cycle-1 P0s flagged for this area are now fixed' + look for NEW bugs introduced by the fixes>"
})
```

## Token budget tracking

Each cycle uses approximately:
- 6 testers × ~5 min each + ~50k tokens each = 300k tokens
- Triage step (orchestrator reads + writes) = 30k tokens
- Fix agents: 9 P0 × ~30k each = 270k tokens
- Preflight + commit + push = 5k tokens
- TOTAL per cycle = ~600k tokens

Cycle 1 used roughly 80% of this. Cycle 2 will be similar — likely
spans a session boundary. State.md is what makes that survivable.

## Files committed so far

```
a4546fa — BETA_TESTING infrastructure
fb287f6 — 4 of 6 cycle-1 reports saved mid-cycle
d1e8ff7 — 4 P0 fixes (integrations + multipart + Supabase mime + panic 3s)
(this commit) — TRIAGE doc + STATE update for next session
```
