# Executed evidence and deep-pass findings

Date: September 15, 2026. Baseline: f0d42376. This extends the source audit in README.md. All fixtures are synthetic and contain no school/customer data. Application code was not changed.

## What ran

| Layer | Executed | Scope and interpretation |
|---|---:|---|
| Existing parser Jest suite | 12 tests | Actual PPTX parser and builder helper; baseline passes |
| New import/controller audit suite | 18 tests | Actual parser and controller method; DB/storage/auth dependencies mocked |
| Native template-envelope audit suite | 6 tests | Actual export/import methods; DB/services mocked; no full JSON import commit |
| Imported-widget contract suite | 5 tests | Actual WidgetPreview and shared text-style rules in jsdom; not complete builder/player |
| Actual PDF runtime | 7 checks | TypeScript compiled with NodeNext/ES2023; actual pdfjs-dist; Node v20.20.2 |
| Chromium component harness | 12 checks | Actual import page and Tailwind utilities; Next navigation/API mocked, all external requests blocked |
| **Total** | **60 tests/checks** | Many are defect reproductions. Green means the documented behavior was reproduced, not that the feature is ready. |

Results: [API Jest](evidence/api-jest-results.json), [widget Jest](evidence/widget-jest-results.json), [PDF runtime](evidence/pdf-runtime-results.json), [browser](evidence/browser-results.json).

The 41 Jest tests all completed successfully. There were no skipped tests in these runs. The PDF parser logged standardFontDataUrl warnings but completed; this is recorded rather than treated as a clean rendering qualification. Browser screenshots were inspected after transitions settled. Synthetic source PDF pages were rendered with Poppler and inspected.

## New findings beyond the original report

### P1: numeric text changes meaning

Actual parser reproduction: source PPTX text `00123` becomes string `123` in defaultConfig.content. XML tag-value coercion occurs before the code converts it back to a string. This matters for room numbers, identifiers and any text where leading zeros are meaningful. The existing test only used ordinary prose and missed it. Preserve text nodes as strings and test exact content, not just approximate geometry.

Evidence: `evidence/import-audit-20260915.spec.ts`, test “numeric-looking text loses leading zeros”.

### P1: ordinary PDF artwork and whole pages disappear

Real three-page fixture: page 1 has a colored background, white heading, two separated text columns and a colored rectangle; page 2 has graphics only; page 3 has text. `parsePdf` sees all three pages, but `buildTemplates` emits only Page 1 and Page 3. The output has zero extracted media. Page 1's separate labels become `Left column Right column` in one zone. A second real 41-page PDF produces only 40 parsed pages with no warning field.

This is not based solely on mocks. See `evidence/mixed-layout.pdf`, `evidence/forty-one-pages.pdf`, source PNGs and `evidence/pdf-runtime-results.json`. These small benign fixtures are not a full corpus of real-world PDFs.

### P1: native JSON export is not a complete template round-trip

Existing routes are `/templates/:id/export` and `/templates/import`; hooks are `useExportTemplate` and `useImportTemplate`. The gallery exposes Export template, but the Import design button routes to the file-conversion page. `handleImportClick` exists in the gallery source but is not called there; the conversion screen does not accept JSON.

Actual export-method test: source scenes, isTouchEnabled, idleResetMs, zone sceneId, locked and touchAction are absent from the exported envelope. Config media URLs remain source URLs rather than an independent asset bundle. This is a portability/integrity gap, not proof of a cross-tenant access exploit. Repair the existing capability instead of adding duplicate APIs. Preserve intentional source/destination isolation and remap authorized dependencies.

Positive controls: export queries tenant-owned OR system templates, strips template identity fields, and import rejects wrong format/version. Those safeguards should remain.

### P2: imported regular text is rendered semibold, with added layout defaults

Actual WidgetPreview test confirms `bold:false` yields fontWeight 600. The default wrapper adds 5% padding and vertical centering; source geometry alone does not preserve source text layout. Introduce a source-faithful import contract without globally changing legacy widgets.

**Correction to the investigative hypothesis:** the raw default TEXT renderer uses a capped em size, but both BuilderZone and the player apply `buildTextStyleRules`, which emits the actual imported pixel size with !important. A negative-control test confirms 59px survives that rule. Therefore a universal 48px/3em cap in the complete builder/player is NOT asserted. No full browser rendering of that entire application path was performed.

### P2: component treats resolved `ok:false` as completion

With an injected resolved response `{ok:false, message: ...}`, the actual import page shows Import complete. Current controller success paths return ok:true and throw on normal failures, so this is a defensive contract weakness reproduced with an injected response, not an observed current production API response. Validate the expected successful result schema before entering done.

### P2: file-selection edge cases remain confusing

Browser checks confirm a PDF File with empty MIME is accepted by filename but has no preview; multiple dropped files silently select only the first. Processing has no Cancel control; stepper lacks aria-current=step. Existing good behavior: keyboard picker works, oversized files are rejected locally, an API rejection returns to preview with file retained, retry exposes the builder action, and the isolated component fits 390px without horizontal overflow.

## Strengthened findings from the original report

Actual controller/parser tests reproduce:

- Picture-before-text source order becomes text-before-picture output order.
- Group transform origin is ignored; an expected translated child remains at local x=0.
- A geometry-inheriting placeholder is omitted.
- 61 slides truncate to 60; 81 text boxes truncate to 80.
- Missing extracted media can eliminate an image-only slide while success copy says fully editable.
- Legacy/non-ZIP PPT input returns success with IMAGE configured to the original `.ppt` URL; WidgetPreview renders a literal img for that URL.
- Template action creates an original-file playlist; playlist action creates no converted templates.
- Contributor original is PENDING_APPROVAL; extracted image is APPROVED; template is ACTIVE. Full publish authorization was not exercised.
- Injected AuditLog failure still returns success.
- Injected second-template creation failure occurs after original/playlist/first-template writes, without a successful import audit.
- Generic PPTX MIME is passed through unchanged to storage. Live bucket rejection was not tested.
- A square image is placed on a fixed 1920×1080 landscape canvas.

Additional player source trace: `apps/web/src/app/player/page.tsx:10894` distinguishes PDF as an iframe document, while non-video/non-web assets fall through to an img around `:11119`. There is no per-page slideshow created by this import endpoint for the original PDF. This reinforces the need to convert selected pages into real playable items; no live display test is claimed.

## Files and reproduction

Tests/scripts are preserved under `evidence/`. Run them in an isolated checkout at the baseline with installed workspace dependencies; do not run them on production. The controller tests mock authorization classes to isolate behavior and therefore do NOT exercise HTTP guards, cookies, CSRF, upload middleware, live RBAC or tenant attack paths.

Place:

- `import-audit-20260915.spec.ts` → `apps/api/src/imports/`
- `native-import-audit-20260915.spec.ts` → `apps/api/src/templates/`
- `import-render-contract-audit.test.tsx` → `apps/web/src/components/widgets/__tests__/`
- `audit-pdf-fixtures.py`, `audit-pdf-runtime.cjs`, `audit-browser.cjs` → isolated checkout root

Then:

```sh
node apps/api/node_modules/jest/bin/jest.js --config apps/api/package.json --runInBand --watchman=false --runTestsByPath apps/api/src/imports/parsers/imports-parsers.spec.ts apps/api/src/imports/import-audit-20260915.spec.ts apps/api/src/templates/native-import-audit-20260915.spec.ts
node apps/web/node_modules/jest/bin/jest.js --config apps/web/jest.config.js --runInBand --watchman=false --runTestsByPath apps/web/src/components/widgets/__tests__/import-render-contract-audit.test.tsx
python3 audit-pdf-fixtures.py
node apps/api/node_modules/typescript/bin/tsc --module nodenext --moduleResolution nodenext --target es2023 --skipLibCheck --esModuleInterop --outDir audit-evidence/compiled apps/api/src/imports/parsers/pdf-parser.ts apps/api/src/imports/parsers/import-builder.ts
```

The compiled PDF modules must resolve the API's pdfjs-dist dependency (this audit linked `audit-evidence/compiled/node_modules` to the isolated checkout's API dependencies). Then run `node audit-pdf-runtime.cjs`. Browser harness paths pin the inspected installed esbuild 0.28.1, Tailwind 4.2.2 and Playwright 1.59.1; update those paths explicitly for another lockfile. Run `node audit-browser.cjs` after creating audit-evidence/. It opens no dev server and makes no live API calls. Component fixture PPTX bytes are deliberately placeholders: these tests exercise selection/UI only; parser tests construct actual ZIP/XML fixtures separately.

The browser harness initially needed fixes for package export-path resolution and Playwright's MIME inference/50-MB in-memory input limit. Final results are from the completed rerun; failed setup attempts are not counted as product failures.

## Not yet proven

Production bucket configuration or anonymous retrieval; real scanner coverage; full HTTP authorization and CSRF paths; a real DB/storage commit; actual third-party exports with complex layouts; save/reopen/edit/undo through the full builder; cross-browser app shell behavior; full player/offline/hardware rendering; concurrency/load budgets; external converter licensing; legal compliance; CI/deploy status. These remain release gates, not hidden assumptions. No new app changes were implemented or deployed.
