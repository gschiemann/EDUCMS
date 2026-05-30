# Performance Budget — Lighthouse CI

> **Last verified against repo:** 2026-05-30. Lighthouse CI runs on every PR
> but is **advisory** today (`continue-on-error: true` in
> `.github/workflows/lighthouse.yml`) — it reports, it does **not** block
> merge. The numbers below are the **assert thresholds in
> `apps/web/lighthouserc.json`**, i.e. the bar we *want* to hold; they are NOT
> a gate that fails the build yet. Accessibility is gated elsewhere (see
> "Accessibility is gated by axe-core + jsx-a11y, not by this budget" below) —
> do not cite the 0.95 here as an enforced a11y floor.

VenueOS (EDU CMS) measures a performance budget on every pull request via
[Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci). It surfaces
performance, accessibility, best-practices, and SEO regressions; while the
job is advisory it cannot block a bad PR, but the report is uploaded as an
artifact for review.

## Assert thresholds (current — `lighthouserc.json`, advisory)

| Category       | Threshold | Enforced? |
| -------------- | --------- | --------- |
| Performance    | 0.85      | Advisory — Lighthouse job is `continue-on-error` |
| Accessibility  | 0.95      | Advisory here; the **real** a11y gate is axe-core + jsx-a11y (below) |
| Best Practices | 0.90      | Advisory |
| SEO            | 0.85      | Advisory |

Thresholds are defined in `apps/web/lighthouserc.json` under
`ci.assert.assertions` (each is a Lighthouse `["error", { minScore }]`
assertion, but the *workflow* swallows the failure, so they don't gate merge).

## Accessibility is gated by axe-core + jsx-a11y, not by this budget

The Lighthouse 0.95 accessibility number is a target, not a wall. Accessibility
is actually enforced by two **blocking** checks that live outside this file:

- **`.github/workflows/a11y.yml`** boots the built app and runs **axe-core**
  (`apps/web/scripts/a11y-audit.ts`) against ~10 flagship + life-safety routes
  (login, dashboard, screens, templates, player, `/panic`, the desktop
  emergency console, reviews, onboarding/branding, fleet map). It fails the
  build on any **error-level** (critical/serious) violation; lower-impact
  warnings are reported but do not fail (yet).
- **`ci.yml` jsx-a11y lint ratchet** keeps a committed baseline of
  pre-existing jsx-a11y eslint errors in `.a11y-baseline` (**currently 99** —
  mostly form-label debt awaiting a dedicated a11y sprint). CI fails only when
  the count **exceeds** the baseline, i.e. it blocks *new* regressions and
  ratchets down over time; it does **not** assert a clean a11y slate today.

So: "a11y is enforced" is true via those two gates, but "every page scores
0.95 in Lighthouse" is **not** an enforced fact — state it as a target.

## Audited pages

Lighthouse runs against the five most user-facing routes:

1. `/login`
2. `/dashboard`
3. `/screens`
4. `/<schoolId>/templates` (seeded demo school)
5. `/player`

## Run locally

```bash
# Install deps (first time only)
pnpm install

# Build the web app (Lighthouse measures the production bundle, not dev)
pnpm --filter web build

# Run Lighthouse CI — spins up `next start`, collects audits, asserts budgets
pnpm --filter web lhci
```

Reports land in `apps/web/.lighthouseci/` (HTML + JSON per URL). Open any `*.html` in a browser for a detailed breakdown.

## CI behavior

- Workflow: `.github/workflows/lighthouse.yml`
- Trigger: pull requests. The operative branch is **`master`** (this repo's only
  long-lived branch). The workflow's `branches:` list also names `main` and
  `develop`, but those branches **do not exist** in this repo — they're
  vestigial from a template and never fire. Treat `master` as the real trigger.
- Artifact: full HTML report uploaded as `lighthouse-report` (retained 14 days)
- Failure policy: **`continue-on-error: true`** — Lighthouse reports but does
  NOT block merge. Remove that flag (after the budgets hold on a few green
  runs) to make Lighthouse a real gate.

## Updating budgets

Budgets should tighten over time, never loosen without discussion. To adjust:

1. Edit `apps/web/lighthouserc.json` → `ci.assert.assertions`.
2. Run locally and confirm the new budget passes on the current build.
3. Open a PR titled `perf: raise/lower Lighthouse budget for <category>` and include:
   - Before/after scores from your local run
   - Rationale (e.g., "we added a large hero image; relaxing performance from 0.90 → 0.85 until we lazy-load it")

## Rationale

- **Performance 0.85** — realistic ceiling for a React 19 dashboard with Turbopack and Next.js 16 App Router. Gives headroom for the template builder and player to load heavy assets.
- **Accessibility 0.95** — an aspirational target, **not** the enforced floor. K-12 districts have ADA obligations, so a11y matters — but it's enforced by the blocking axe-core + jsx-a11y gates described above (axe-core fails on error-level violations; jsx-a11y ratchets a baseline of 99 pre-existing errors downward), not by this advisory Lighthouse number. Several routes do not score 0.95 today; that's tracked as a11y debt, not a passing fact.
- **Best Practices 0.90** — catches insecure resources, console errors, deprecated APIs.
- **SEO 0.85** — login and marketing pages should be indexable; dashboards are gated, so a perfect score is neither achievable nor necessary.

## Known follow-ups

- Tune budgets after the first CI run surfaces real numbers for the five routes.
- Add LHCI GitHub App token (`LHCI_GITHUB_APP_TOKEN`) secret so results post as PR status checks instead of only as artifacts.
- Consider per-URL budget overrides if the `/player` route's emergency overlays drag down the performance score.
