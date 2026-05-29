# Contributing to VenueOS

## START HERE — read these 5 first

In order. These are the living, accurate docs. Everything else is either
feature-specific or historical.

1. **[`CLAUDE.md`](./CLAUDE.md)** — the source of truth. Architecture, the
   monorepo layout, environment variables, conventions, the emergency-system
   safeguards, the hard-won rules (#9 render tree, #10 Chromium-83 / Taurus
   CSS), the Standard Audit Surface, and the roadmap. Read it before touching
   anything.
2. **[`docs/research/2026-05-28-opus48-audit/00-MASTER-SYNTHESIS.md`](./docs/research/2026-05-28-opus48-audit/00-MASTER-SYNTHESIS.md)**
   — the most accurate snapshot of what is *actually shipped* right now (every
   claim traced to its caller / a real curl). When CLAUDE.md describes a
   safeguard and you need to know whether it's truly wired, this is the
   ground-truth doc.
3. **[`docs/OBSERVABILITY.md`](./docs/OBSERVABILITY.md)** — Sentry, health
   endpoints, what we watch and how.
4. **[`docs/FEATURE_FLAGS.md`](./docs/FEATURE_FLAGS.md)** — how features are
   gated; wrap new/risky work in a flag.
5. **[`docs/BACKUP_AND_ROLLBACK.md`](./docs/BACKUP_AND_ROLLBACK.md)** — tag
   before risky changes; how to roll back.

> **Ignore `docs/archive/`.** Those are pre-launch April-2026 design docs
> describing a system that diverged from what shipped. They are historical
> provenance only — they will mislead you if read as current.

## The repo is public

`https://github.com/gschiemann/EDUCMS` is **public**. Treat every commit,
PR, and issue as visible to the world. Never commit `.env*`, API keys, or
PII. Secrets live in env vars; `.env` is gitignored.

## Before you push

Run the local preflight from the repo root — it runs the same non-Docker
checks CI does (lockfile + workspace builds + API + web type checks) in
under 90 seconds:

```bash
pnpm preflight
```

A green local `pnpm dev` / `nest build` is **not** enough — incremental
builds hide TypeScript errors that fail Railway's clean Docker build. When
in doubt, do a clean API type check:

```bash
rm -f apps/api/tsconfig.build.tsbuildinfo
pnpm --filter api exec tsc --noEmit --project tsconfig.build.json
```

Push only when the user asks. If you're on `master`, branch first.

## Verify before you claim

Do **not** tell anyone a change works until you've verified it — load the
rendered page (Playwright / browser MCP), `curl` the deployed asset, or
confirm the commit landed on `master` with green CI and a fresh Vercel/
Railway deploy. "Pushed, awaiting verification" beats "Done!" every time.
(CLAUDE.md → Standard Audit Surface §21.)

For user-visible UI specifically: **verify the render tree before editing.**
`grep -rn '<ComponentName'` to confirm a component is actually mounted —
green CI does not prove a file is even rendered. (CLAUDE.md rule #9.)

## Working with parallel agents (worktree discipline)

This repo is frequently worked by parallel AI agents. The standing rules
(full detail in CLAUDE.md → "Agent Dispatch Protocol"):

- **Every agent that writes code OR runs the app** (`pnpm dev` / `build` /
  Playwright) works in an **isolated git worktree** (`isolation: "worktree"`).
  Only pure read/research agents may stay in the main tree.
- **The lead owns the merge.** Agents return a branch name; the lead reviews
  the diff, audits, runs `tsc` + lint + tests, then *alone* commits and
  pushes to `master`. Agents never push to `master`.
- **Commit before dispatch** — uncommitted/untracked work has zero protection.
- **Assert the main tree is clean** (`git status --short` empty) before and
  after every agent batch.
- **Persist agent work to disk immediately** — substantial agent output goes
  to `docs/research/<date>-<topic>/` before anything else, because chat
  context can compact and lose it.

## Conventions (quick reference — see CLAUDE.md for the rest)

- **Package manager:** pnpm (`pnpm@9`). Never `npm` / `yarn`.
- **Deploy:** Railway (API) + Vercel (web). Push to `master` = production.
- **TypeScript:** `strict: true`. No `any` without a deliberate reason.
- **DB:** always via Prisma. Schema is
  `packages/database/prisma/schema.prisma`; run `pnpm db:generate` after
  changes. Migrations are **additive-only** (a live pilot tenant is in prod).
- **Tests:** Jest `*.spec.ts` next to source (API); Playwright for E2E.
- **Cross-browser:** must work in Safari/WebKit; player surfaces must also
  survive Chromium 83–87 (Taurus). Never use the `inset` shorthand / `inset-*`
  utility in widget/player styles (CLAUDE.md rule #10).
