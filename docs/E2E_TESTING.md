# E2E Testing Guide

There are **two** Playwright suites in this repo, with two separate configs.
Confusing them is the main way to think you ran a test you did not.

| | Root suite | Web suite |
|---|---|---|
| Config | `playwright.config.ts` (repo root) | `apps/web/playwright.config.ts` |
| Tests | `tests/e2e/` — 11 spec files | `apps/web/tests/e2e/` — 24 spec files |
| Browsers | **chromium only** (`playwright.config.ts:29-34`) | **chromium + webkit** (`apps/web/playwright.config.ts:61-67`) |
| Servers | Boots the real API (`:8080`) **and** `next dev` (`:3000`) | Serves a prebuilt `next build` → `next start` bundle; every API call is mocked with `page.route()` |
| Run | `pnpm test:e2e` (root) | `pnpm --filter web test:e2e` |
| In CI | **Collected only, never executed** — see below | Executed on chromium **and** webkit |

## Which command runs which browsers

- `pnpm test:e2e` — root suite, **chromium only**.
- `pnpm --filter web test:e2e` — web suite, **chromium and webkit** (both projects
  run when no `--project` is passed).
- `pnpm --filter web exec playwright test --config playwright.config.ts --project=webkit`
  — web suite, webkit only. This is the single highest-value cross-browser check
  you can run locally.

**WebKit is not optional.** CLAUDE.md ("Cross-browser support — non-negotiable")
makes it binding, because a Chrome-only dev loop shipped a WebKit-fatal
holiday-bridge bug that sat broken in Safari for two months (2026-05-09). The web
config's own header says the same thing. Do not "save CI budget" by dropping it.

The **root** config is chromium-only for a narrower reason: those specs exercise
API/health/manifest behaviour through a live NestJS server, not DOM/CSS
rendering, so a second engine buys little there. That is a scoping decision about
one suite — it is not a repo-wide policy, and the browser-rendering surfaces are
covered by the web suite above.

Firefox is not run anywhere in CI. `apps/web/package.json:9` lists
`"Firefox >= 60"` in browserslist (a build target, not a test run).

### What CI actually runs

| Workflow | Job | Browsers | What it runs |
|---|---|---|---|
| `ci.yml` | `E2E Tests (Playwright / <browser>)` (`ci.yml:453`) | matrix `[chromium, webkit]` (`ci.yml:464-465`) | the **web** suite (`ci.yml:588`) |
| `ci.yml` | same job, earlier step (`ci.yml:524-538`) | — | `pnpm exec playwright test --list` against the **root** config, as a collection gate: fails if fewer than 30 tests are discovered |
| `emergency-path.yml` | `<browser> · Emergency path` | matrix `[chromium, webkit]` (`:63-64`) | `apps/web/tests/e2e/emergency-path.spec.ts` (`:149`) |
| `cross-browser.yml` | holiday/menu/gym bridge checks (`:140`) and `test:e2e:widget-render` (`:230`) | webkit + chromium installed (`:121`, `:224`) | `pnpm --filter web run test:cross-browser`, `test:e2e:widget-render` |
| `prod-smoke.yml` | `WebKit dashboard nav (favicon-crash canary)` (`:116-117`) | webkit | `pnpm --filter web run test:webkit-nav` against the live deploy |

Note the second row: **CI never executes the root `tests/e2e/` suite** — it only
lists it to prove collection is not broken. That gate exists because collection
silently returned "Total: 0 tests" while the job stayed green (audit W0-06).
If you change anything under `tests/e2e/`, run it yourself; CI will not.

## Running the root suite locally

```bash
pnpm test:e2e        # all root E2E tests (servers auto-start if not running)
pnpm test:e2e:ui     # interactive Playwright UI
```

Playwright starts both the API (`localhost:8080`) and web (`localhost:3000`)
automatically if they are not already running (`playwright.config.ts` `webServer`).
`reuseExistingServer` is on locally and off in CI.

## Running a single file

```bash
pnpm exec playwright test tests/e2e/health-endpoints.spec.ts
pnpm exec playwright test tests/e2e/login.spec.ts --headed
```

For the web suite, pass its config explicitly:

```bash
pnpm --filter web exec playwright test --config playwright.config.ts tests/e2e/emergency-path.spec.ts
```

## Updating the admin token fixture

The admin token is read from the `PLAYWRIGHT_ADMIN_TOKEN` environment variable
(`tests/e2e/fixtures.ts:21`). Never hardcode a real token. Unset, it falls back
to the literal `STUB_ADMIN_TOKEN_NOT_REAL`, and `PLAYWRIGHT_TENANT_ID` falls back
to `test-school-1` (`fixtures.ts:26`).

1. Add them to your local `.env` (gitignored):
   ```
   PLAYWRIGHT_ADMIN_TOKEN=eyJ...your_jwt_here
   PLAYWRIGHT_TENANT_ID=your-school-tenant-id
   ```
2. For CI, both are already read from GitHub repository secrets
   (`ci.yml:591-592`).

## Known skipped tests and what is needed to unskip

Most root-suite tests are smoke-only and skip the assertions that need a seeded
database. Skipped cases are marked `test.skip()` with a `// TODO (Sprint 2):`
comment. As of this writing the root suite discovers 36 tests, 19 of them
skipped.

| Test File | Skipped Cases | Needed to Unskip |
|---|---|---|
| `login.spec.ts` | Valid credentials login | Seeded SCHOOL_ADMIN user + env vars `PLAYWRIGHT_ADMIN_EMAIL` / `PLAYWRIGHT_ADMIN_PASSWORD` |
| `panic-trigger.spec.ts` | 3-second hold trigger | Auth session cookie + live tenant + seeded DB |
| `panic-all-clear.spec.ts` | Clear active emergency | Seeded `emergencyStatus` on tenant + auth session |
| `dashboard-load.spec.ts` | Authenticated dashboard | Auth session cookie |
| `playlist-create.spec.ts` | Create + list playlists | Auth session + seeded DB |
| `screen-assign.spec.ts` | Screen assignment UI | Seeded screen + playlist + auth session |
| `schedule-publish.spec.ts` | Publish schedule + manifest | Seeded playlist + screen + auth session |
| `template-browse.spec.ts` | Template list via API + UI | Auth session + seeded system templates (`pnpm db:seed`) |
| `player-manifest.spec.ts` | Manifest content + widget zones | Seeded schedule + device token (`PLAYWRIGHT_DEVICE_TOKEN`) |

`health-endpoints.spec.ts` and `mobile-pair-qr.spec.ts` have no skipped cases.

The stated goal is to run `pnpm db:seed` before the E2E job and unskip the
DB-dependent tests. That has not happened — the `TODO (Sprint 2)` markers are
still in every file listed above, and CI does not run this suite at all.
