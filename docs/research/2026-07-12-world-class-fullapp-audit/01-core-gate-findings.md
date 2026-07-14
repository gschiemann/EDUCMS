# Core gate findings — verified 2026-07-12

Scope: read-only full-app audit. These findings were surfaced by the core
reviewer before its usage window ended and independently reproduced by the
lead against current `master`.

## 1. In-app USB export cannot be ingested by the Android player

- The API bundle manifest uses `version: 1`, nested
  `playlists[].items[].asset`, and `storagePath`
  (`apps/api/src/usb-export/usb-export.controller.ts`).
- The Android ingester requires `schema: "edu-cms-usb-bundle/v1"`,
  `bundleVersion`, a top-level `assets[]`, and `localPath`
  (`apps/player/app/src/main/java/com/educms/player/usb/UsbIngester.kt`).
- Therefore an in-app-generated, correctly signed bundle is rejected before
  any content is copied. The standalone `scripts/usb-bundler.ts` emits the
  Android contract, proving the repository has two incompatible producers.
- The API-generated README says the player prompts for an admin PIN, while
  `UsbIngestActivity.kt` explicitly says no PIN prompt exists yet.

## 2. Accessibility lint is false-green

- `pnpm --filter web lint` exits 2 because the ESLint flat-config object that
  enables `jsx-a11y/*` rules does not register the `jsx-a11y` plugin in that
  same object.
- `.github/workflows/ci.yml` pipes lint through `tee ... || true`, then only
  counts formatted `jsx-a11y/` rule violations. A configuration crash produces
  zero matching violations and the job prints success.

Lead reproduction:

```text
ESLint: 9.39.4
A configuration object specifies rule "jsx-a11y/alt-text", but could not find plugin "jsx-a11y".
Exit status 2
```

## 3. Root Playwright E2E gate discovers zero runnable tests

- `pnpm exec playwright test --list` exits 1 and reports five
  `ReferenceError: describe is not defined` failures from
  `tests/e2e/*.test.ts`; those files use Jest globals and Supertest mock tokens
  inside the Playwright test directory.
- Several real `*.spec.ts` auth, publish, screen, and emergency scenarios are
  explicitly skipped and still contain Sprint-2 TODOs.
- The resulting listing is `Total: 0 tests in 0 files`.
- `.github/workflows/ci.yml` runs this root E2E job only on pull requests, so
  direct pushes to `master` do not exercise it.

These are release-integrity blockers because green CI currently does not mean
the lint or end-to-end gates executed successfully.
