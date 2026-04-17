# E2E Testing Guide

EDU CMS uses [Playwright](https://playwright.dev/) for end-to-end tests, covering the 10 most critical user flows.

## Running Locally

Start the dev servers first (or let Playwright start them via `webServer`):

```bash
# Run all E2E tests (servers auto-start if not already running)
pnpm test:e2e

# Open the interactive Playwright UI
pnpm test:e2e:ui
```

Playwright starts both the API (`localhost:8080`) and web (`localhost:3000`) automatically if they are not already running. Set `reuseExistingServer` behavior is on by default locally.

## Running a Single File

```bash
pnpm exec playwright test tests/e2e/health-endpoints.spec.ts
pnpm exec playwright test tests/e2e/login.spec.ts --headed
```

## Updating the Admin Token Fixture

The admin token is read from the `PLAYWRIGHT_ADMIN_TOKEN` environment variable. Never hardcode a real token.

1. Add it to your local `.env` (gitignored):
   ```
   PLAYWRIGHT_ADMIN_TOKEN=eyJ...your_jwt_here
   PLAYWRIGHT_TENANT_ID=your-school-tenant-id
   ```
2. For CI, add `PLAYWRIGHT_ADMIN_TOKEN` and `PLAYWRIGHT_TENANT_ID` as GitHub repository secrets.

## Why Chromium-Only

We run only Chromium (not Firefox or WebKit) because:

- **Zero-budget constraint** — downloading and maintaining multiple browser binaries costs CI minutes and local disk space.
- **K-12 display targets** — school signage players run on Chromium-based kiosks (Chrome OS, Electron). Chromium coverage maps directly to production.
- WebKit and Firefox can be added once the project has funding/CI budget. Add them to the `projects` array in `playwright.config.ts`.

## Known Skipped Tests and What Is Needed to Unskip

Most tests are smoke-only and skip assertions that need a seeded database. All skipped tests are marked with `.skip()` and a `// TODO (Sprint 2):` comment.

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

Sprint 2 goal: run `pnpm db:seed` in CI before the E2E job and unskip all DB-dependent tests.
