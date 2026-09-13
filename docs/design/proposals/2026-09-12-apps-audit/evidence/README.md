# Evidence and reproducibility

Audit baseline: `e4e018bb`, September 12, 2026. Production code was not edited. This folder preserves the audit harnesses and outputs, not a production patch.

## Executed checks

| Evidence | Result | What it establishes |
|---|---|---|
| `apps-audit-20260912.test.tsx` | 37 passed | Inventory, 15 nonempty-input form→mock-store smoke checks, ordinary conversions and deterministic defect reproductions. Tests named “reproduces” intentionally assert the bad behavior. |
| Existing `streaming-embed-allowlist.test.ts` | 11 passed | Normalization and allowlist cases covered by the repository; not playback. Existing handle/live test expects unvalidated channel=handle behavior and needs stronger provider-correct acceptance criteria. |
| Existing `feed-widgets.test.tsx` | 8 passed | Real RSS and CALENDAR renderers consume mocked server feed responses. Does not prove Google Calendar tile, real upstream access, or private-source security. |
| Existing `touch-widgets.test.tsx` | 15 passed | Existing native interactive widget behavior. Not an audit of every touch or QR variant. |
| Existing `qr-scannable.test.tsx` | 6 passed | New QrCodeWidget-generated images decode to their payloads. Does not test the old Apps TOUCH_POINT QR variant or real scan distance. |
| `audit-browser-results.json` | Four Chromium checks, no page errors | Actual AppConfigForm and registry; mocked WidgetPreview, store, tenant/AI hooks. Three defects reproduced (invalid URL add, empty config on conversion failure, AI source omission); coming-soon Add correctly disabled. |
| `audit-design-results.json` | Passed | Proposed UI only: 8 recommended / 11 source / 4 roadmap entries, example-only Add gating, no horizontal overflow at 736/520/390/320px. Not production testing. |

Total Jest: **77/77 across five suites**. The initial run had 41 passing tests and one suite that could not load `pngjs`; it was not a passing suite. The final run resolved already-installed `pngjs` and `jsqr` through explicit module paths, without modifying manifests or dependencies. The first attempt also hit a Watchman sandbox permission error; the final command disables Watchman.

The agent-browser skill's CLI was unavailable. Used the installed Playwright Chromium runner as a fallback. The local-only harness initially needed module-resolution corrections, then permission to bind a loopback port/run Chromium. Its successful run made no production or external-provider request. Browser/server closed when complete.

## Re-run in an isolated worktree

Use normal repository dependency installation for a fresh environment. Put the preserved audit test into `apps/web/src/components/apps/__tests__/apps-audit-20260912.test.tsx` in that **temporary worktree**, not directly onto master. Restore the browser harness files to worktree root if reproducing those checks. Harness `audit-browser-entry.tsx` expects source relative to worktree root. The design-check harness points to this thread’s local visualization file and is not portable without updating that artifact path.

The executed Jest command was:

```sh
node node_modules/jest/bin/jest.js \
  --config apps/web/jest.config.js --watchman=false --runInBand \
  --modulePaths='/Users/gschiemann/Desktop/EDU CMS/node_modules/.pnpm/pngjs@5.0.0/node_modules' \
  --modulePaths='/Users/gschiemann/Desktop/EDU CMS/node_modules/.pnpm/jsqr@1.4.0/node_modules' \
  --runTestsByPath \
  apps/web/src/components/apps/__tests__/apps-audit-20260912.test.tsx \
  apps/web/src/components/widgets/__tests__/streaming-embed-allowlist.test.ts \
  apps/web/src/components/widgets/__tests__/feed-widgets.test.tsx \
  apps/web/src/components/widgets/__tests__/qr-scannable.test.tsx \
  apps/web/src/components/widgets/__tests__/touch-widgets.test.tsx \
  --json --outputFile=audit-test-results-final.json
```

Absolute module paths reflect this machine. For a portable fix, declare test dependencies in the correct workspace and regenerate the lockfile through the normal dependency workflow; do not treat reaching into `.pnpm` as the permanent CI solution. Browser harness also uses the locally installed esbuild package path. `node audit-browser.cjs` runs its isolated fixture checks.

## Not done / cannot infer

- No authenticated CMS navigation, add/save/reload through real server, role/tenant switching runtime test or deployment validation.
- No real provider video playback, Google/Office/Canva accounts, published document fixtures, OAuth lifecycle or production API credentials inspected.
- No real player/LED hardware, school network, DRM, geo/age restriction, CORS/CSP variation or 24-hour soak.
- No full penetration test, independent security certification or legal compliance review.
- No “fixes shipped”: these are evidence, recommendations and UI concepts only.

The normal form smoke fixtures intentionally include generic nonempty URLs, demonstrating permissive mutation—not provider validity. Convert them to provider-specific valid/invalid fixtures when implementing the repairs. Invert the defect assertions to desired behavior before making them regression gates.
