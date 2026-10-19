# Codex handoff — quick wins while the player team finishes native-first (2026-10-19)

You are Codex, working in this repository on the owner's machine. The Claude lead owns the player
engine, emergency alerting, the native-first integration and every release; you own the business /
admin panel and the bounded items below. Read `CLAUDE.md` and `AGENTS.md` in full before the first
edit — they are the standard, and this file only points at the parts that bite most often.

## The standard, in one page

1. **The repo is PUBLIC.** No customer names, screen ids, device fingerprints, IP addresses, emails,
   keys or tokens in code, tests, commits, branches, PR text or issues. Ever.
2. **One worktree, one branch, one PR per item.** Branch `codex/<topic>`, PR to `master`, merge
   commits (never squash — gitleaks fingerprints are per commit). Never push to `master` directly.
3. **Watch CI to green before you say anything shipped.** A push is "pushed, CI running". Required
   checks: Deploy Reliability, CI (Jest, Playwright shards + verdict), CodeQL, Emergency path,
   cross-browser, mobile-perf, a11y. Docs-only changes never satisfy the required checks
   (paths-ignore) — say so and let the owner admin-merge.
4. **Verification before claim** (CLAUDE.md §21): for any UI change, load the rendered page
   (Playwright or the browser), screenshot it, and test in **WebKit**, not only Chromium. "Works in
   Chrome" is not done. The owner runs the product from an iPhone (Safari); tables scroll, never
   add a column; keep the mobile-perf guard green (`pnpm mobile-perf-guard`).
5. **Every user-facing string ships in en + es + zh** (`apps/web/src/i18n/messages/*.json`).
6. **No new settings, toggles or controls that nobody asked for.** Engine behaviour auto-detects per
   device; env flags are lead-only kill switches, never operator settings.
7. **A schema change ships its migration in the same commit** — additive, idempotent
   (`ADD COLUMN IF NOT EXISTS`, guarded constraints); production runs `prisma migrate deploy` at boot.
8. **Never weaken an emergency safeguard.** Anything under `apps/api/src/emergency/**`, the player's
   emergency paths, the panic pages, audit logging or auth bypass needs the lead's sign-off first.
9. **Player rules you must not cross:** no new bridge method (three-file contract + canary count),
   no device owner, never mass-force an OTA, never a lower-resolution stand-in, never flip the video
   engine on the glass, the `inset` shorthand is banned in player/widget styles.
10. **Tests live next to the source.** Never run `pnpm --filter api run lint` (it auto-fixes); use
    `pnpm --filter api exec tsc --noEmit --project tsconfig.build.json` and the Jest suites you touch.
    Run `pnpm preflight` before pushing.
11. **Copy states what the evidence proves** ("no render proof for N minutes", never "frozen").
    Status reports are short bullets: what changed, what is verified, what is not.
12. **Small diffs, no refactors, no scope growth.** If an item turns out bigger than a day, stop and
    write up what you found instead of half-shipping it.

## Do not touch (in flight on the player side)

`apps/player/**`, `apps/web/src/app/player/**`, `apps/api/src/screens/native-video.ts`,
`apps/api/src/emergency/**`, `packages/api-types/src/native-end-reasons.ts`, the open player PRs
(#114 store, #117 session, the 1.1.43 defaults PR, the web/API native-first PR), `versionCode` /
`versionName`, `apps/player/HARDWARE-QUALIFICATION.md`, Railway env flags, field-build windows and
APK pushes. If a quick win needs one of these, write it up and hand it back.

## Quick wins, in priority order (one PR each)

1. **Make `apps/web/src/app/[schoolId]/assets/__tests__/media-library-v1.test.tsx` deterministic.**
   It failed on a recent PR run while being in nobody's diff; the log shows
   `advanceTimersByTime` called without fake timers (a 400 ms debounce). Fix the test (fake timers
   or a real wait), prove it passes 5× locally, no production code change.
2. **Required checks for docs-only PRs.** A PR that only touches `docs/**` can never go green
   because the required workflows skip it. Add a tiny always-run job (or adjust the required set)
   so a docs-only PR merges on its own; prove it with a docs-only PR of this handoff file.
3. **Field-build window panel on a phone** (`/super/field-builds`, your ownership): open it in
   WebKit at 390 px wide; arming a 24 h window for a candidate and cancelling it must be a
   two-tap flow with the candidate's version and digest visible. Fix only what is broken or
   unusable; no new features. Same pass for the tracked APK-push rows on the screen detail
   (NEEDS_TAP / STALLED / FAILED / EXPIRED must read clearly, with Cancel reachable).
4. **Dependabot: the default branch reports 2 high + 7 moderate.** Bump what is safe, one PR,
   `pnpm install` so `pnpm-lock.yaml` does not drift (the pre-commit hook blocks drift), full CI
   green, no major-version bumps of `argon2` / `bcrypt` (Alpine build risk — CLAUDE.md).
5. **`AGENTS.md` drift check.** Diff it against `CLAUDE.md`'s rules (database URL, migrations,
   player rules, public-repo rule) and bring it in line; update its stamp. Docs-only PR.
6. **Web player self-heal for a video that has data but never starts** — ONLY if the lead
   confirms the player files are free by then. A `<video>` with `readyState ≥ 3`, no error, still
   `paused` at `currentTime 0` for 45 s after `play()` should re-issue `play()` on visibility /
   resume, then recreate the element, then reload the page after N failures — instead of waiting
   ~11 minutes for the server's wedge reload. Unit test per branch. Ask before starting.

## How to report

For each item: the PR link, what changed, what you verified and how (screenshot / test run /
CI link), what you could not verify. Nothing is "done" before CI is green and the verification is
attached.
