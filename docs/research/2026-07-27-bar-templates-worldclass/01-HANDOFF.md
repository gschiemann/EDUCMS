# HANDOFF — bar-template world-class redesign (stopped at usage wall, 2026-07-27)

The 10-agent redesign fleet was stopped mid-flight at Greg's request (4% usage left).
**Nothing was lost** — state below. Read `00-REVIEW.md` first (full review + the 4 traps
encoded into the agent brief).

## Fleet state at stop (workflow run `wf_f191bb7f-3e0`)

| Board | Worktree branch | State |
|---|---|---|
| 04-happy-hour | `worktree-wf_f191bb7f-3e0-4` @ `9028e1be` | ✅ DONE — "Press Room" letterpress poster, all verifications passed |
| 07-bottle-service | `worktree-wf_f191bb7f-3e0-7` @ `a017cf6a` | ✅ DONE — "The Gold Room" nightclub luxe, all verifications passed |
| 08-game-day | `worktree-wf_f191bb7f-3e0-8` @ `a3d75375` | ✅ DONE — "Broadcast Truck", 0 errors both browsers, 0 overflow both orientations, applyMenu overlay + both re-skin paths verified, shims byte-identical |
| 01-tap-list | `worktree-wf_f191bb7f-3e0-1` @ `47e9c168` | 🟡 WIP rescued (uncommitted work committed at stop — UNVERIFIED, treat as draft) |
| 03-bottle-list | `worktree-wf_f191bb7f-3e0-3` @ `c1986440` | 🟡 WIP rescued (same) |
| 05-now-pouring | `worktree-wf_f191bb7f-3e0-5` @ `35c01cdb` | 🟡 WIP rescued (same; board is QUARANTINED — see de-quarantine steps in 00-REVIEW.md) |
| 06-tonight-live | `worktree-wf_f191bb7f-3e0-6` @ `8a87fdbe` | 🟡 WIP rescued (same) |
| 02-cocktail, 09-hours, 10-hiring | — | ⬜ Not started (worktrees were clean / auto-removed) |

Full structured agent reports (direction, field counts, verification numbers) are in
`journal-wf_f191bb7f-3e0.jsonl` in this folder (the 3 `"type":"result"` rows).

## How to resume (next session)

1. **Resume the workflow with cache** — completed agents return instantly, unfinished re-run:
   `Workflow({scriptPath: "~/.claude/projects/-Users-gschiemann-Desktop-EDU-CMS-apps-web/801b8ee0-86c2-44ec-a860-c7a158e32193/workflows/scripts/bar-templates-worldclass-wf_f191bb7f-3e0.js", resumeFromRunId: "wf_f191bb7f-3e0"})`
   (If that session dir is gone, the same script content can be re-issued; the 3 finished
   boards can instead be harvested directly from their branches — see 2.)
   NOTE for the WIP boards: agents resume FRESH (no memory of their draft) — point them at
   their rescued WIP commit as a starting draft, or let them start over.
2. **Harvest a finished board without the workflow:**
   `git show worktree-wf_f191bb7f-3e0-8:"apps/web/public/templates/signage/bar/08-game-day.html" > apps/web/public/templates/signage/bar/08-game-day.html`
   (same pattern for -4 / -7). Branches survive worktree removal.
3. **Lead merge gates before commit (per board):** `node docs/research/2026-07-27-bar-templates-worldclass/key-gate.cjs <repoRelPath> <newFile>` (old keys ⊆ new, from HEAD);
   grep `applyMenu` + `EDUCMS-CLICK-V2` present; no `inset:`/`inset-*`;
   then `node apps/web/scripts/inject-click-shim.cjs signage`;
   `node apps/web/tools/check-taurus-safety.cjs`;
   `pnpm --filter web exec playwright test tests/e2e/external-html-clickedit.spec.ts`;
   after-screenshots via `shoot-bar-boards.cjs` (this folder; `--portrait` flag exists) and
   eyeball vs `before/` (before-screenshots of all 10 old boards, also this folder).
4. **05 de-quarantine** (only after 05 verified fixed): remove its URL from
   `packages/api-types/src/quarantine.ts`, deploy, add `preset-sig-bar-05` to
   `scripts/reactivate-dequarantined-boards.cjs` REACTIVATE, run with `--apply`.
5. **Cleanup after harvest:** `pnpm worktrees:clean` + delete `worktree-wf_f191bb7f-3e0-*`
   branches. Do NOT clean before harvesting (per the standing worktree rules, a batch is
   not done until `git worktree list` shows only the main tree).
6. Leave the three `redesign-tap-list-v*` candidate files untouched (candidate history).
   Present Greg a BEFORE/AFTER (old left, new right) at the end.
