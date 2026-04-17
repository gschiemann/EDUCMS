# Performance Budget — Lighthouse CI

EDU CMS enforces a performance budget on every pull request via [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci). This catches performance, accessibility, best-practices, and SEO regressions before they reach production.

## Budgets (current)

| Category       | Minimum score |
| -------------- | ------------- |
| Performance    | 0.85          |
| Accessibility  | 0.95          |
| Best Practices | 0.90          |
| SEO            | 0.85          |

Budgets are defined in `apps/web/lighthouserc.json` under `ci.assert.assertions`.

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
- Trigger: pull requests targeting `main`, `master`, or `develop`
- Artifact: full HTML report uploaded as `lighthouse-report` (retained 14 days)
- Failure policy: currently `continue-on-error: true` while we tune budgets after the first green run. Remove that flag once numbers stabilize to make Lighthouse truly blocking.

## Updating budgets

Budgets should tighten over time, never loosen without discussion. To adjust:

1. Edit `apps/web/lighthouserc.json` → `ci.assert.assertions`.
2. Run locally and confirm the new budget passes on the current build.
3. Open a PR titled `perf: raise/lower Lighthouse budget for <category>` and include:
   - Before/after scores from your local run
   - Rationale (e.g., "we added a large hero image; relaxing performance from 0.90 → 0.85 until we lazy-load it")

## Rationale

- **Performance 0.85** — realistic ceiling for a React 19 dashboard with Turbopack and Next.js 16 App Router. Gives headroom for the template builder and player to load heavy assets without breaking CI on every PR.
- **Accessibility 0.95** — non-negotiable floor. K-12 districts have ADA obligations. We already ran axe-core through Sprint 2 and expect this score on every page.
- **Best Practices 0.90** — catches insecure resources, console errors, deprecated APIs.
- **SEO 0.85** — login and marketing pages should be indexable; dashboards are gated, so a perfect score is neither achievable nor necessary.

## Known follow-ups

- Tune budgets after the first CI run surfaces real numbers for the five routes.
- Add LHCI GitHub App token (`LHCI_GITHUB_APP_TOKEN`) secret so results post as PR status checks instead of only as artifacts.
- Consider per-URL budget overrides if the `/player` route's emergency overlays drag down the performance score.
