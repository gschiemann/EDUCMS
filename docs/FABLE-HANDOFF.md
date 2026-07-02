# Fable → Opus 4.8 Handoff — how to run VenueOS at this level

Written 2026-07-01 by Fable (the lead through July 7th), at Greg's request:
*"ensure your process, techniques, and complete management of our product is
easily explained to Opus 4.8 so it can continue to build at your level and not
drop off — document everything you found that Opus could have done better."*

This is the operating manual. CLAUDE.md is the LAW (rules, scars, checklists);
this file is the JUDGMENT — how the lead actually runs the machine. Read both.
Session state + queue live in memory (`project_app_library_and_sports_2026_06_30.md`)
and the harness task list.

---

## 1. The operating loop (what a "day" looks like)

**Audit → rank → fence → dispatch → review → merge → gate → verify → persist.**

1. **Audit first, build second.** Every build wave starts with a cheap,
   evidence-grounded audit (read-only agent or lead greps) that produces a
   RANKED list with file:line + failure scenario + effort. Never build from
   vibes or stale docs. See `docs/research/2026-07-01-launch-sprint/01-MAJORS-FOUND.md`
   for the canonical shape.
2. **Fence domains, then dispatch.** Each build agent gets ONE file domain,
   explicitly listing what OTHER agents own ("do NOT touch X — another agent
   owns it"). 9 agents ran concurrently on 2026-07-01 with zero collisions
   because the fences were explicit in every prompt.
3. **The lead owns every merge.** Per-commit cherry-picks, never bulk-merge.
   Read the diff of the CRITICAL sections yourself (auth guards, fallback
   contracts, anything security/content-delivery) — don't skim the agent's
   report and trust it. The agent report is a map, not the territory.
4. **Every fixed bug CLASS gets a CI gate the same day.** Not the instance —
   the class. Examples shipped this sprint: sport-board-parity.test (the
   "feature ships to builder but not defaults" class), playlist-delete-go-dark
   spec (the "second door into blank screens" class), clickedit e2e board list
   extended (the "redesigned board loses its shim" class), the order-clamp
   drift-catcher (the "test asserts pre-persistence value" class).
5. **Verify before claim, always.** tsc (both apps, non-incremental for api),
   targeted jest, the three guards (taurus-safety, mobile-perf, clickedit
   where relevant), preflight, push, WATCH CI TO GREEN. "Pushed, CI watching"
   is the only honest status before green.
6. **Persist the moment work exists.** Agent reports → docs/research/ BEFORE
   the user-facing summary. Plans, audits, checklists → committed. Memory
   updated at every state change. Context can compact at any time.

## 2. Techniques that measurably worked (keep ALL of these)

- **Sabotage-test your gates.** After building the parity gate, the agent
  deliberately broke the swim branch, confirmed 8 tests failed with exactly
  the target symptom, then restored. A gate you haven't watched fail is a
  hope, not a gate.
- **Drift-catcher tests assert the POST-persistence value.** The order-clamp
  bug hid because the test asserted the value BEFORE sanitizeResults. When a
  write path has a sanitizer/gate, at least one test must run the real gate
  and assert what actually lands.
- **Verify-before-flag in audits.** The majors-finder and costume-verticals
  agents both DISPROVED stale findings (CC-2 partially fixed; verticals
  already editable) instead of re-reporting them. An audit that re-flags
  fixed things burns trust and build cycles. Every audit prompt must say:
  "a finding that's already defended is a FALSE finding — check first."
- **Read-only auditors parallelize free.** Grep/Read-only agents need no
  worktree and can't collide — run them alongside build waves.
- **The dispatch prompt formula** (every build agent): mission + WHY (quote
  Greg where possible) + file map (don't make them rediscover) + architecture
  decisions ALREADY MADE by the lead ("implement exactly, do not redesign") +
  domain fence + ground rules (CLAUDE.md rule numbers) + required checks +
  required report format. Agents given decisions execute; agents given
  ambiguity redesign.
- **Salvage protocol for dead agents.** Worktrees survive the death. `git -C
  <worktree> status` → commit WIP yourself → run ITS tests as-committed → if
  green, review + merge; if not, keep the worktree and finish post-reset.
  The 2026-07-01 session-limit crash lost ZERO work this way (the AI backend
  was fully recovered: 143/143 specs green in the WIP).
- **Batch pushes; docs ride with code.** A push supersedes the previous
  in-flight Deploy Reliability run (concurrency-cancel). Accumulate reviewed
  merges locally, push 2-4 commits per batch, ONE CI run judges them.
- **The stale-base artifact.** `git diff master..agent-branch` shows YOUR
  recent master commits as deletions because the agent branched earlier.
  Check per-commit file lists (`git log master..B --name-only`) before
  crying overlap. This false alarm appears on almost every merge.
- **Chips are cross-agent bug transport.** A builder that finds an
  out-of-scope root cause files a chip with file:line + fix sketch and works
  around it locally; the lead fixes the shared layer same-day and removes
  the workaround during that agent's merge. (Lane pad → order clamp: found,
  chipped, root-fixed, workaround removed, gated — same afternoon.)
- **Efficiency is a prompt ingredient, not a phase.** Every wave-B prompt
  carried Greg's no-waste mandate: the feeds agent shipped Redis caching +
  fleet math; the limiter agent chose 1 Redis op over 3 and documented why.

## 3. What Opus-era patterns cost us (the honest list Greg asked for)

Each of these was found and corrected during this sprint. They are PATTERNS,
not one-off bugs — watch for the pattern, not the instance:

1. **Single-door fixes.** CC-2 ("screen must never go dark") was fixed inside
   ONE controller's methods; playlist-delete reached the same failure through
   a second door for weeks. When you fix a failure MODE, grep for every path
   that produces the mode and extract the defense to a shared helper. Ask:
   "what else can cause this exact end state?"
2. **Features ship to the builder but not the defaults.** Swim lanes existed
   as a widget + preset while the actual Game-Day board showed a generic
   tally (#267). The operator experiences DEFAULTS, not capabilities. Now
   CI-gated (parity test) — extend that gate whenever a new sport/surface/
   vertical capability lands.
3. **Tests that assert pre-persistence values.** The order-clamp truncation
   was invisible because the spec checked the normalizer's output, not what
   survived the sanitizer. Test through the gate.
4. **Over-claiming.** I called the App Library "world-class" while it was an
   embed-tier baseline; Greg's "is a share-link really an integration?"
   exposed it. Before superlatives: state the tier honestly (baseline /
   parity / moat) and what the next tier requires. Greg rewards honesty and
   punishes discovered overclaim far harder than admitted limitation.
5. **Trusting stale audits.** The 2026-06-27 vertical grades were 4 days old
   and mostly already fixed by intervening waves. Audits are snapshots —
   re-verify in code before building on one (cheap greps beat wasted agents).
6. **Silent scope-downs and silent caps.** If an audit/agent covers less than
   asked, it must say so on page one (CLAUDE.md already mandates this — the
   discipline is ENFORCING it in every dispatch prompt and report review).
7. **Operational traps discovered the hard way this sprint** (now written
   down so they cost nothing again): a docs-only push auto-cancels the
   in-flight code CI run; a new `@cms/*` workspace dep for apps/api MUST be
   added to the Dockerfile's hardcoded package-build list (preflight and the
   api-build job will NOT catch it — only the Docker job); a changed
   workspace package needs its dist rebuilt before local api tsc (stale-dist
   phantom errors like "no exported member").
8. **Inconsistent hardening.** The same file had one audit-write hardened
   against swallowing and a sibling `.catch(() => {})` three functions away.
   When you harden a pattern, sweep the FILE (then the module) for siblings.

## 4. Working with Greg (calibration)

- He wants **effortless over configurable** — "I don't want another fucking
  setting" is standing law. Every fix must REMOVE friction.
- He operates from an **iPhone**; the mobile-perf guard is his lived reality.
- He catches misses **on screen** — your job is to catch them in CI first.
- Give him **honest tiers** and **exact asks** ("~30 min, here are the
  clicks") — see `02-GREG-CONFIG-CHECKLIST.md` for the shape he acts on.
- Design work needs HIS screenshot approval before porting (CLAUDE.md
  Template Design Workflow). Never batch-build templates.
- "Store it" = harness task + memory + docs/research, all three.

## 5. State at handoff + resumption runbook

- **Sprint plan:** `docs/research/2026-07-01-launch-sprint/00-PLAN.md`
  (compressed rev 2). Day 1-2 delivered; Day 3 = merges + persona proofs vs
  prod + efficiency fixes (#274); Day 4 = 21-section dress rehearsal; Day 5 =
  Greg's hands-on buffer.
- **Open work is ALL in harness tasks** (#259-#276+) — each carries its own
  context. Highest first: #268 remaining FE (brief-echo chips — backend
  SHIPPED incl. /generate-designer/brief endpoint; build chips in
  templates/page.tsx + a NEW hooks file, never use-api.ts), #274 efficiency
  safe-fixes, #275 GYM mockups (re-dispatch venueos-template-designer, STOPS
  at Greg's approval), #270 sport depth, #273 needs Greg's one-sentence
  decision.
- **The editor-vs-Canva deep dive** (Greg's latest mandate) died on the
  session limit with ZERO lens output. Resume with:
  `Workflow({scriptPath: ".../editor-crush-canva-critique-wf_e3dc5383-71d.js",
  resumeFromRunId: "wf_e3dc5383-71d"})` — the script is sound (7 lenses:
  canvas manipulation, inline text, elements/assets, AI flow, Canva
  benchmark, the three-architecture seam, workflow/undo). Then the LEAD
  synthesizes the ranked plan (do not trust an in-workflow synthesis step —
  it produced a stub once; lens agents return structured findings, the lead
  writes the plan — that division worked perfectly for the App Library).
- **My hypothesis to test in that dive:** the editor's real gap vs Canva is
  (a) direct-manipulation feel — snap guides, multi-select, inline text
  editing, on-element context toolbar — and (b) the THREE editing
  architectures presenting three mental models as one product. The moat to
  amplify: live-data widgets + fleet + emergency — things Canva structurally
  cannot do. Verify, don't assume.

*Run it like it's yours — because it is. The bar is: nothing lies, nothing
blanks, nothing regresses, and Greg never finds a miss before CI does.*
