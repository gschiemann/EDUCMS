# Resume Instructions — for the next Claude session

You are picking up an autonomous beta-testing operation that was started in
a previous session. The user is one person who told us to "spin up an army
of beta testers, find bugs, fix them, repeat — save state when tokens run
out so we can keep going."

## Step 1 — Read these files in order (under 60 seconds)

```
BETA_TESTING/STATE.md                ← cycle, status, last commit
BETA_TESTING/CYCLE_LOG.md            ← what each cycle did
BETA_TESTING/BUG_REPORTS/            ← latest agent reports
BETA_TESTING/FIX_LOG/                ← what's already fixed
```

## Step 2 — Identify the current phase

The cycle status field in STATE.md tells you what to do next:

| Status                | Next action                                            |
|-----------------------|--------------------------------------------------------|
| `TESTING_DISPATCHED`  | Tester agents may still be running. Check cycle logs.  |
| `TESTING_COMPLETE`    | Aggregate reports → triage → dispatch fix agents       |
| `TRIAGED`             | Dispatch fix agents from the triage list               |
| `FIXING_DISPATCHED`   | Fix agents running. Wait for completion.               |
| `FIXING_COMPLETE`     | Re-test cycle: dispatch tester agents again            |
| `CYCLE_DONE`          | Commit + push, increment cycle number, start new cycle |

## Step 3 — Operating procedure for each phase

### Phase: TESTING_DISPATCHED → wait → TESTING_COMPLETE

Tester agents are autonomous. When they finish, their reports land in
`BETA_TESTING/BUG_REPORTS/CYCLE-N-AREA.md`. The agents follow the brief in
`TEST_PLAN.md`. If you launched them and they're still running, the
runtime sends you completion notifications.

If you arrive in a fresh session and reports already exist, move to
TRIAGED phase.

### Phase: TESTING_COMPLETE → TRIAGED

Read every `BUG_REPORTS/CYCLE-N-*.md` and aggregate findings into a
`BUG_REPORTS/CYCLE-N-TRIAGE.md` ranked P0 / P1 / P2 / GREEN. Format:

```markdown
# Cycle N Triage — YYYY-MM-DD

## P0 — fix this cycle (block ship)
- [ ] AREA · BUG-001 · `path/to/file:line` · one-line fix

## P1 — fix this cycle
- [ ] ...

## P2 — defer
- [ ] ...

## Promote from previous cycle
- [ ] (anything not fixed last time)
```

Update STATE.md status to `TRIAGED`.

### Phase: TRIAGED → FIXING_DISPATCHED

Dispatch fix agents from the P0/P1 list. Bake the GROUND RULES from
`memory/feedback_agent_failure_patterns.md` into every agent prompt.
Each fix agent gets a single bug to fix (small scope = high success rate).

Update STATE.md status to `FIXING_DISPATCHED`.

### Phase: FIXING_COMPLETE → CYCLE_DONE

After fixes land, run `pnpm preflight` to confirm green. If broken, fix
the immediate breakage then re-run preflight.

Stage the fixes, write a commit message that lists every CYCLE-N-BUG-XXX
fixed, push to master.

Increment STATE.md cycle number, status `TESTING_DISPATCHED`, dispatch
the next round of testers (rotate priorities — areas with the most bugs
get higher priority next round).

## Step 4 — How to dispatch tester agents

Use `Agent` tool with `general-purpose` type, `run_in_background: true`.
Each agent gets the brief from `TEST_PLAN.md` for one area + the GROUND
RULES block. Example pattern:

```
Agent({
  description: "Test cycle N — auth area",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: "<paste the area's brief from TEST_PLAN.md + GROUND RULES + write your report to BETA_TESTING/BUG_REPORTS/CYCLE-N-auth.md>"
})
```

You can dispatch all 6 areas in parallel. Don't wait between dispatches.

## Step 5 — How to dispatch fix agents

Each fix agent gets a SINGLE BUG. Pattern:

```
Agent({
  description: "Fix CYCLE-N-BUG-001",
  subagent_type: "general-purpose",
  run_in_background: true,
  prompt: "<bug description + file paths + acceptance criteria + GROUND RULES + write to BETA_TESTING/FIX_LOG/CYCLE-N-fixes.md when done>"
})
```

## Step 6 — When to stop

Three legitimate stopping points:

1. **Tokens running low** — save state to STATE.md, commit + push, tell
   the user to start a new session and paste "resume beta testing"
2. **Cycle complete and zero bugs found** — declare ship-ready, archive
   the operation, tell the user
3. **User explicitly stops** — same as #1

## Step 7 — How to save state before stopping

Before responding to the user with "I'm running low, here's where we are":

1. `BETA_TESTING/STATE.md` — update Current Cycle + Status + Last commit
2. `BETA_TESTING/CYCLE_LOG.md` — append a one-line summary of where we
   stopped mid-cycle
3. Stage + commit + push the BETA_TESTING/ directory + any code fixes
4. Tell the user the exact phrase to start the next session with

## GROUND RULES (paste into every agent prompt)

```
GROUND RULES — read before doing anything:

1. Read before edit. Every file you touch — read it FULLY first.
2. Don't break TypeScript. Run `cd apps/web && npx tsc --noEmit` and
   `cd apps/api && npx tsc --noEmit` after every fix. Pre-existing test
   errors (RoleGate.test.tsx, touch-widgets.test.tsx, screens.register
   .spec.ts) are noise — IGNORE.
3. Preserve existing data flow. Don't refactor logic, only fix the bug.
4. NO EMOJI in code. lucide-react icons throughout the codebase.
5. Don't write new docs / .md files unless explicitly asked.
6. Do NOT push or commit. Leave that to the orchestrator.
7. Run preflight before reporting "done": `cd ROOT && pnpm preflight`.
   Pre-existing OneDrive sync flake on Windows is OK if compile +
   static-pages succeeds.
8. Final report: under 200 words. List exactly what changed and the
   acceptance test that proves it works. Format:
   `Files changed: <path:line>`. No essay.
9. If you can't fix it cleanly in your time budget, REPORT that and
   stop. Don't half-fix. Half-fixes are worse than open bugs.
```
