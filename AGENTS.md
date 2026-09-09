# AGENTS.md — pointer only. Read `CLAUDE.md` first; it is the single source of truth.

This file exists because Codex, Cursor and other agent tools look for `AGENTS.md`
by filename convention. It is **not** a second rulebook. Everything below is a
compressed restatement of rules that already live in `CLAUDE.md`, with line
pointers so you can read the real thing. Where the two ever disagree,
**`CLAUDE.md` wins** — fix `AGENTS.md`, don't follow it.

**Why it is short now.** Until 2026-09-08 this file was a 1,091-line copy of
`CLAUDE.md` frozen at 2026-06-05, carrying the *identical* `Last Updated`
footer, so ~361 lines of drift were invisible. It told agents to use the
`6543 + pgbouncer=true` database URL that `CLAUDE.md` explicitly forbids
restoring, and it was gitignored, so repo-wide greps for that bad shape came
back clean. A duplicate that can rot silently is worse than a pointer.
Do not grow this file back into a copy.

---

## The rules an agent must not break, even before it reads CLAUDE.md

### 1. `DATABASE_URL` uses Supavisor **session mode** — port 5432, **no** `pgbouncer=true`

`CLAUDE.md:84`. Correct shape:

```
postgresql://user:pass@host:5432/postgres?connection_limit=10&pool_timeout=20
```

Do **not** "restore" the old `6543` + `pgbouncer=true` value. Measured on the
real prod DB (wire RTT 74 ms): raw `pg` on a reused connection **68 ms**;
Prisma via 6543 + `pgbouncer=true` **350 ms** (~5 round trips); Prisma via 5432
session mode **71 ms** (1 round trip). Prisma's transaction-pooling path turned
one logical read into ~5 network round trips and made `DEALLOCATE ALL` 22% of
all statements sent to the database.

`connection_limit` must stay **low** in session mode — each pool slot holds a
real Postgres connection and the instance has `max_connections=60` with ~30 used
by Supabase itself. 10 is correct. Check
`SELECT current_setting('max_connections')` before changing it. Keep
`pool_timeout=20`.

### 2. Never weaken an emergency safeguard; never skip the `AuditLog` write

`CLAUDE.md:190-219`. The emergency system fires lockdown / weather / evacuation
alerts across real screens. Any change to emergency endpoints, payload
validation, auth-bypass logic or audit logging needs explicit review and an
end-to-end trigger/all-clear test. Never weaken `@AllowPanicBypass`, never drop
the immutable `AuditLog` row, never remove the Redis-fan-out HMAC gate
(`apps/api/src/realtime/redis.service.ts`, `verifyWsHmac`) or the HTTP-polling
manifest fallback.

Beyond emergency: every privileged action writes an `AuditLog` row
(`CLAUDE.md:956-962`).

### 3. Tenant isolation is enforced by a CI gate — don't route around it

A bare-id Prisma lookup on a tenant-owned model
(`prisma.client.template.findUnique({ where: { id } })`) lets a tenant-A user
read or mutate tenant-B data. Constrain `tenantId` in the `where`, or check
ownership immediately after. The AST gate is
`apps/api/tools/check-tenant-isolation.cjs` with a ratchet baseline in
`apps/api/tools/tenant-isolation-baseline.json`, run by
`.github/workflows/tenant-isolation.yml`. The baseline only ever goes **down**.

### 4. Secrets never enter git

`CLAUDE.md:127`, `CLAUDE.md:444`. `.env` is gitignored; `.env.example` is the
template. No hardcoded credentials, API keys, tokens or PII in any commit, PR or
issue. In production the API refuses to boot without `JWT_SECRET`,
`SESSION_SECRET`, `DEVICE_SECRET_KEY`, `DEVICE_JWT_SECRET` — see
`apps/api/src/security/required-secret.ts`. Before rotating a secret, prove it
actually leaked and enumerate its consumers; a blanket rotation has 401'd live
devices before.

### 5. Verify before claiming done — and watch CI to green

`CLAUDE.md:1007-1018` and `CLAUDE.md:650-679`. Before you tell anyone a fix
shipped, do one of: load the rendered page in Playwright and look at it; drive
the live deploy in a browser; `curl` the deployed asset and grep for your
change; or confirm the commit is on master **and** CI is green **and** the
deployment timestamp is newer than your push.

`pnpm preflight` is **not** proof CI will pass — it skips Docker and runs on a
machine where native modules are already built. After every push, watch the run
to completion (`gh run watch`) and react to red *before* reporting. A job that
dies before its tests run is not a pass, and in-progress is not green.
"Pushed, CI watch running" is honest. "Done" before green is not.

### 6. No `inset` shorthand in player or widget styles

`CLAUDE.md:1279-1448`. NovaStar Taurus LED controllers run Chromium 83-87;
`inset` landed in Chrome 87, so on the oldest units the declaration is dropped
entirely and the element collapses to 0×0. This bans **both** the CSS property
`inset: 0` and the Tailwind `inset-0` / `inset-x-*` / `inset-y-*` utilities.
Use the four physical longhands (`top`/`right`/`bottom`/`left`, or
`top-0 right-0 bottom-0 left-0`).

Third variant, invisible to grep: a React inline `style` object supplying all
four sides gets re-serialized by the browser's own CSSOM into the `inset`
shorthand. Drop to three sides plus an explicit `width`/`height`. Detector:
`node apps/web/tools/check-inset-serialization.cjs`. Grep for the first two
forms:

```bash
grep -rnE 'inset:[[:space:]]*0|inset(-x|-y)?-[0-9]' \
  apps/web/src/components/widgets apps/web/src/app/player \
  apps/web/src/components/player
```

**Scope:** this governs code shipped to a Taurus LED controller only. Standard
LCD players, desktop and mobile browsers, and the admin dashboard have no such
constraint — never dumb their visuals down for it.

### 7. Agents work in isolated worktrees; the lead owns the merge

`CLAUDE.md:1026-1076`. Every agent that writes code — or merely *runs* the app
(`pnpm dev`, a build, Playwright) — gets `isolation: "worktree"`. Agents never
push to master. The lead reads the diff, runs the type-check and target tests,
verifies UI changes, then commits and pushes.

Corollary: **edit only the files you were assigned.** Another agent in the same
wave owns the rest. If you think a file outside your list is wrong, say so in
your summary instead of editing it.

And a batch is not finished until `git worktree list` shows only the main tree
again (`pnpm worktrees:status` → `pnpm worktrees:clean`). Skipped cleanup is
what built a 154-tree / 83 GB pileup.

### 8. Never discard agent work

`CLAUDE.md:1044` and `CLAUDE.md:1050-1074`. "Kill" means stop the process, not
throw away the output. Salvage uncommitted worktree work **before** removing any
worktree. Persist a returning agent's substantive report to disk immediately —
context can compact at any time and take the report with it. Every agent's full
transcript is at
`/private/tmp/claude-501/<project>/<session>/tasks/<agentId>.output`; grep there
first when work appears to have vanished.

---

## Where the detail lives

| Topic | Read |
|---|---|
| Everything, authoritatively | `CLAUDE.md` |
| New here | `CONTRIBUTING.md` |
| Env vars, one row each | `CLAUDE.md:78-165`, `.env.example` |
| Emergency system | `CLAUDE.md:190-219` |
| Player reliability (credential lifecycle, manifest gate, recovery) | `CLAUDE.md:220-321` |
| Hardware qualification before any player release | `apps/player/HARDWARE-QUALIFICATION.md`, `docs/player/HARDWARE-QUAL-CHECKLIST.md`, `scripts/check-hardware-qual.cjs` |
| Frame-locked multi-screen sync | `CLAUDE.md:322-366` |
| Templates, EXTERNAL_HTML boards, the click-to-edit shim | `CLAUDE.md:367-435`, `docs/design/FLAGSHIP-TEMPLATE-STANDARDS.md`, `.claude/agents/venueos-template-designer.md` |
| Cross-browser / WebKit rules | `CLAUDE.md:446-525` |
| Mobile performance standard | `CLAUDE.md:526-568`, `pnpm mobile-perf-guard` |
| Deploy, health endpoints, rollback | `CLAUDE.md:569-706`, `docs/BACKUP_AND_ROLLBACK.md` |
| Standard Audit Surface (21 sections — the map every audit must cover) | `CLAUDE.md:799-1025` |
| Agent dispatch protocol | `CLAUDE.md:1026-1182` |
| Player gateway + client-IP trust chain | `apps/web/src/app/player/gatewayPaths.ts`, `apps/web/src/app/player/trustGuards.ts`, `apps/api/src/security/client-ip.ts` |
| Roadmap / sprint plans (context, not rules) | `docs/roadmap/ROADMAP.md` |

CI gates live in `.github/workflows/` — `deploy-reliability.yml`,
`taurus-safety.yml`, `cross-browser.yml`, `tenant-isolation.yml`,
`mobile-perf.yml`, `a11y.yml`, `emergency-path.yml` among them. Run
`pnpm preflight` locally before pushing, then watch the real run.

**`docs/research/` is gitignored** (`.gitignore:98`) — those audit and research
notes exist on the lead's machine only, so a fresh clone will not have them. If
`CLAUDE.md` points you at a `docs/research/...` path you cannot find, that is
why; it is not a broken link.

---

AGENTS.md is a pointer. `CLAUDE.md` is authoritative and is the file to update
when a rule changes. Do not add a `Last Updated` footer here — an identical
footer on both files is exactly what hid the last year of drift.
