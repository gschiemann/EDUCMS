**Scope:** how agents are dispatched, watched and merged — the Agent Dispatch Protocol and the "For AI Assistants" rules about models and reading order. It has the same authority as `/CLAUDE.md` (§11 is the always-loaded summary) and sits under `/AGENTS.md`. Moved verbatim from the old single-file `CLAUDE.md` on 2026-11-01 (move map: `docs/governance/decisions/2026-11-01-rulebook-restructure-map.md`).

# Agent dispatch

## Agent Dispatch Protocol — parallel agents in isolated worktrees

Operator demand (2026-05-26): *"kick off the agents again and run this like a professional lead developer, have the agents work in their own tree if that's the best most professional way then you take their code back, you audit it all and then you alone commit and push to the main tree, you always have the ownership."*

This is now the standing rule for every parallel-agent deployment:

1. **Worktree isolation is mandatory.** Every Agent call that writes code MUST pass `isolation: "worktree"`. Without it, agents share the same working tree and stomp each other's untracked files. Incident: `docs/incidents/2026-05-26-agent-contention.md`.

   **1b. ANY agent that RUNS the app gets a worktree too — not just code-writers (2026-05-29).** Even a "read-only" audit agent that starts a dev server, runs a build, or drives Playwright WILL write into the working tree — `.next*` build dirs, and (observed) `next.config.ts` / `tsconfig.json` edits to stand up an isolated dev server on its own port. Rule: if the agent's job involves `pnpm dev` / `build` / Playwright at all → pass `isolation: "worktree"`. Only pure web-research / pure-read (grep/Read, no app run) agents may stay in the main tree. Incident: `docs/incidents/2026-05-26-agent-contention.md`.

   **1c. Assert the main tree is clean before AND after every agent batch.** Run `git status --short`; it MUST be empty (modulo intended lead commits). Any agent-origin dirtiness is a HARD STOP — reconcile it (`git checkout HEAD -- <file>` to drop orphaned edits; cherry-pick the agent's *worktree branch* as the source of truth) before merging/pushing. And before blaming an agent for main-tree edits, VERIFY via its transcript (`grep '"file_path"' <task>.output`) whether its writes were worktree-scoped or main-tree — never assert contention without proof (the 2026-05-29 misattribution).

2. **The Lead owns the merge — and no model pushes to master.** Agents work on a branch named `<vendor>/<topic>` (rename a harness-named `worktree-agent-<id>` branch first) and return its name. The Lead reviews the diff (`git diff master..<vendor>/<topic>`), audits, and opens (or takes over) a pull request in the decision format; a consequential change is reviewed by a model from a different vendor than the one that wrote it; the Lead merges on the owner's written go (or a standing approval in `docs/governance/AUTONOMY-REGISTER.md`). Nobody — the Lead included — pushes to master (`AGENTS.md` hard stop).

3. **Commit before dispatch.** Any uncommitted local work must be committed (even WIP) before parallel agents fire. Untracked files survive nothing.

4. **Single-domain scope per agent.** Don't give two parallel agents overlapping files. Agent A touches widgets; Agent B touches branding; Agent C touches playlists. The worktrees isolate filesystem but logical conflicts can still surface at merge.

5. **Recovery via transcripts.** Every agent's full transcript is at `/private/tmp/claude-501/<project>/<session>/tasks/<agentId>.output`. If a fix vanishes, grep there first — anything the agent wrote before crashing is recoverable.

6. **Audit before merge.** Lead reads the agent's diff, runs tsc + the agent's target tests (never `pnpm --filter api run lint` — it auto-fixes files), screenshots the affected page if UI-touching. No merge without proof.

7. **Agents are tools, not authors.** Lead is responsible for what ships. "An agent did it" is never a defense for a regression.

8. **Persist agent work to disk THE MOMENT it returns.** When any
   agent returns substantive findings (≥500 words of report-form
   output OR a punch list ≥3 items OR any work the user paid real
   money for), the lead MUST write the full report to a markdown file
   under a TRACKED path, `docs/handoffs/<YYYY-MM-DD>-<topic>/` (a report that
   maps a weakness — a security finding, forensics — goes to the private
   standard repository's `decisions/` instead), BEFORE writing the
   next user-facing summary. Do NOT rely on conversation context to
   hold agent work — context can compact at any time and the work
   becomes invisible to chat, regardless of how recently it landed.

   Incident: `docs/incidents/2026-05-28-lost-agent-reports.md`.

   **Workflow:**
   - Agent dispatched → agent returns → IMMEDIATELY `Write` the
     full report to `docs/handoffs/<date>-<topic>/<NN>-<scope>.md`
     before any other tool call.
   - Add a README to the folder listing all reports + scope.
   - THEN summarize to the user.
   - The summary cites the on-disk file paths so they're discoverable
     by future agents / future sessions / a re-read of master.

### Pre-dispatch checklist (run EVERY time before spawning agents)

Operator (2026-05-26 follow-up): *"who is the boss? you or them? how are we going to control this shit moving forward? i want an army of agents working all the time but they cant be stepping all over each other and you the entire time."*

The chaos that prompted this rule wasn't agents disobeying — it was the lead skipping pre-flight discipline. Every parallel-agent dispatch MUST start with:

```bash
# 1. Confirm on master (not on a leftover agent branch).
git branch --show-current  # must print "master"

# 2. Confirm clean tree. If dirty, commit to a wip/<topic> branch first.
git status --short  # must be empty

# 3. Confirm origin is up-to-date.
git fetch origin master && git log master..origin/master --oneline  # must be empty

# 4. Clean up YOUR OWN finished worktrees so the new dispatch starts fresh. `git worktree
#    prune` ALONE IS NOT ENOUGH — it SKIPS locked worktrees, and the harness
#    locks every agent tree, so they accumulate INVISIBLY. On 2026-06-02 this
#    reached 154 leftover trees / 83 GB and made every git command slow/erroring
#    (the operator caught it, not the lead — never again). Other sessions' trees
#    (Codex, a second Claude session) are NOT yours: never remove them.
pnpm worktrees:status            # count leftover agent/session worktrees (read-only)
git worktree remove --force ".claude/worktrees/<your-finished-tree>"   # your own trees, by name
git worktree list                # none of YOUR finished trees may remain
# `pnpm worktrees:clean` sweeps EVERY idle tree under .claude/worktrees/ (backs up to ~/Desktop
# first; skips trees touched in the last 20 min) — other sessions' included. Run it only when
# no other session is working.
```

If ANY of those four fail, **stop and fix the workspace before spawning agents.** A dirty tree means a previous session left untracked work that the next agent batch will appear to "wipe" — that was the source of every "agents are stomping me" panic.

### Mid-flight monitoring (agents running in background)

```bash
# List all live agent worktrees with commit counts + dirty file counts.
for w in /Users/gschiemann/Desktop/EDU\ CMS/.claude/worktrees/agent-*; do
  br=$(git -C "$w" branch --show-current 2>/dev/null)
  cnt=$(git -C "$w" log master..HEAD --oneline | wc -l | xargs)
  sts=$(git -C "$w" status --short | wc -l | xargs)
  echo "${br}: commits=${cnt} dirty=${sts}"
done
```

Don't tail agent transcript files — they overflow context. Trust the harness notifications.

### Merge cycle (when an agent reports complete)

```bash
# 1. Read the agent's diff against master FIRST. No exceptions.
git diff master..<vendor>/<topic>

# 2. Run tsc on whatever they touched. (Never `pnpm --filter api run lint` — it auto-fixes files.)
rm -f apps/api/tsconfig.build.tsbuildinfo
pnpm --filter api exec tsc --noEmit --project tsconfig.build.json
pnpm --filter web exec tsc --noEmit | grep -v "test\.\|@testing-library"

# 3. Open the pull request from the branch — decision format, naming model, version and
#    harness — and watch its checks. NEVER push to master; never use --no-verify.
git push origin <vendor>/<topic>
gh pr create --base master --head <vendor>/<topic>   # body: Situation · Evidence · Recommendation · Risk · Validation · Rollback · Decision
gh pr checks <PR-number> --watch                     # exits non-zero if a check failed

# 4. A consequential change (emergency path, auth/secrets, migrations, billing, the native
#    player, CI/CD) is reviewed by a model from a DIFFERENT vendor before the merge (AGENTS.md).

# 5. The Lead merges on the owner's written go (or a standing approval in
#    docs/governance/AUTONOMY-REGISTER.md). A merge to master is a deploy. For a player
#    release, tag the MERGED commit (Player Reliability rule 13).

# 6. ⚠️ REMOVE YOUR OWN FINISHED WORKTREE THIS SAME TURN. Non-negotiable. The 83 GB /
#    154-tree pileup (2026-06-02) was caused by exactly this step being skipped:
#    work handed back, then the locked ~540 MB tree left behind forever.
#    Once the branch is pushed (it lives on origin) and the agent's report is on disk:
git worktree remove --force ".claude/worktrees/agent-<id>"   # the tree
git branch -D "worktree-agent-<id>"                          # the now-stale local branch
# (`pnpm worktrees:clean` sweeps every idle agent tree at once — other sessions' included; use it
#  only when no other session is working.)
```

**STANDING RULE (2026-06-02): a parallel-agent session is NOT done until none of YOUR
finished agent worktrees remain in `git worktree list`.** Leaving agent worktrees
behind is the "lazy development" that built an 83 GB invisible mess. Run
`pnpm worktrees:status` at the end of every agent batch and remove your own leftovers
before you tell the user the work shipped — never another session's tree (Codex's or a
second Claude session's): those legitimately appear in `git worktree list`.

### Workspace hygiene — `pnpm hygiene` (2026-06-02)

Incident: `docs/incidents/2026-06-02-worktree-pileup.md`.

**`pnpm hygiene`** (read-only; `pnpm hygiene:deps` adds the network vuln pass) is
the standing early-warning — it reports leftover worktrees, `.git` object/garbage
health, dirty tree, stale local/remote branches, backup-tag clutter, and
dependency CVEs, each with the fix command. Run it periodically and as part of
the pre-dispatch checklist. If `.git` ever shows thousands of loose objects or
any garbage, run `git gc`.

### Things that look like "agents stomping me" but aren't

- **File modified timestamps in the main tree.** Pre-existing uncommitted work from previous sessions. Run `git stash list` — if there are entries, those are the culprits, not the agents.
- **A new commit appearing on a branch named `agent/...`.** You drifted onto that branch by committing without confirming current branch. Switch back to master and cherry-pick.
- **Files reappearing as "M" after a stash pop.** The stash didn't fully clear them. Use `git checkout HEAD -- <file>` to force-revert.
- **An untracked file from an agent worktree appearing in the main tree.** Worktrees share `.git/objects` not working trees — this can't happen. If it looks like it did, the file existed in the main tree BEFORE the agent dispatch and you didn't notice.

### Anti-patterns that cause real contention (and DID cause the 2026-05-26 chaos)

- **Spawning agents without `isolation: "worktree"`.** They all write to the same tree and stomp each other's untracked files. Incident: `docs/incidents/2026-05-26-agent-contention.md`.
- **Committing before checking current branch.** Your commit lands on an agent branch, master stays behind, push appears to succeed (you pushed master's HEAD), but the commit isn't actually on master.
- **Cherry-picking the same logical work from two agents.** Two agents writing similar fixes (e.g. PropertiesPanel HOUSE_AD_BANNER case) will conflict at merge. Pick one, skip the other.
- **`git push --no-verify`.** Never (a hard stop in `AGENTS.md`). The pre-push hook runs `pnpm preflight`; bypassing it is how a broken build reaches master and — because Railway and Vercel deploy on push — production.

## For AI Assistants (items 1, 2 and 6 of the old list)

1. **Model routing (Foundry Standard Art. 42, 53):** cost-first — the cheapest model whose track record passes the gate for the task class, escalating only on a failed gate, a consequential change or real ambiguity; the routing table and the succession rule are in `docs/governance/standard/MULTI-AGENT.md` (Routing; Continuity when a vendor is down), and the cross-vendor review rule is in `AGENTS.md` and there. Emergency, security and architecture work always gets a frontier-class model plus a review by a different vendor.

2. **Read `AGENTS.md` first (this file imports it), then this file** — this is the application rulebook, the source of truth for the codebase. When texts disagree the precedence is (`AGENTS.md`): `docs/governance/OWNER-RULES.md` → the Foundry Standard → this file → `AGENTS.md` → your own memory.

6. **Read the owner's rules and the latest handoff:** `docs/governance/OWNER-RULES.md` (the owner's binding corrections, readable by every vendor) and `docs/handoffs/` (prior-session context). A model's private memory (Claude's `MEMORY.md` among them) is a cache of the repository, never the record — a fresh checkout has none of it.
