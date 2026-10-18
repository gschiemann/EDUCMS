# Business profit UI implementation

`/super/profit` provides the SUPER_ADMIN-only view of committed monthly revenue, tracked receivables, recorded recurring platform costs, estimated contribution profit and margin, recommendations, and service capacity. It labels revenue and profit as estimates, exposes unpriced customers and partial cost coverage, and explains that provider bills are not automatically synced and provider plans are never upgraded automatically. The cost register records monthly estimates with budgets, next bill dates, notes, manual-source/freshness labels, and archive/restore state. Existing capacity UI is reused without modification.

The hooks use the `['super-business']` query key, are disabled until hydrated identity confirms `SUPER_ADMIN`, do not poll, and invalidate the business summary after cost mutations. Optional fields cleared in the edit form are submitted as explicit `null`. “Other” provider values remain separate from service names. Recommendation codes and values are localized in English, Spanish, and Chinese, while legacy prose remains a fallback. Currency and dates use the active locale. Dollar entry is converted directly to integer cents.

## Validation

- `pnpm --filter web exec jest --runInBand src/lib/__tests__/business-profit.test.ts src/app/super/profit/__tests__/page.test.tsx` — 2 suites, 4 tests passed.
- Target ESLint across profit page, unit tests, Playwright spec/config, hook and helper — passed.
- `pnpm --filter web exec tsc --noEmit` — passed after workspace type packages were built in this isolated worktree.
- `node apps/web/tools/check-i18n-parity.cjs` — passed, 5,102 keys in each catalog.
- `git diff --check` — passed.
- `pnpm --filter web exec playwright test --config src/app/super/profit/playwright.config.ts` — Chromium and WebKit passed create, edit, explicit nullable-field clearing, archive/restore, provider/service preservation, console check, and 375px viewport verification (2 tests total; 5.3 seconds). Screenshots: `apps/web/test-results/profit-chromium-375.png` and `apps/web/test-results/profit-webkit-375.png` (ignored test artifacts).

## SHA-256

| File | SHA-256 |
|---|---|
| `apps/web/src/app/super/profit/page.tsx` | `8dd90eaf115bd8f41ab6184382fb9dc4d1ddcedee1dcd2ae32e7a15ea3f34913` |
| `apps/web/src/app/super/profit/__tests__/page.test.tsx` | `2b09083f94bd64622ae4d5c0a8747d935e1333b431361e79d519b2a382b0cdfc` |
| `apps/web/src/app/super/profit/business-profit.spec.ts` | `ddb22c7675d944f320935bd6401f97ac60f145a15388f99d657341d65347152b` |
| `apps/web/src/app/super/profit/playwright.config.ts` | `cfc3da3a18fe0b458d0a1380731512499d9138cfe72b9dc26ef49145abac1fe3` |
| `apps/web/src/hooks/use-business-profit.ts` | `46f340fb4e91fd53933a4878f4a440f22532911efaf004e665cb36fecb9d8ed8` |
| `apps/web/src/lib/business-profit.ts` | `e16b695a7145f5d2e70325ebcb937e1d7f93dd70550d1267b9ccf1cade877c09` |
| `apps/web/src/lib/__tests__/business-profit.test.ts` | `4da0ab3b31aa40c4b6ac6f6b3490c4044f12b8cbd37936904358b9c851e6ca26` |
| `apps/web/src/i18n/messages/en.json` | `60864305b10c1cd4ce59c72ca275d408c39c1acd19d25350574eea9ee8fdd608` |
| `apps/web/src/i18n/messages/es.json` | `7d1a4f51e664bc0656f84a8f98ad653fec7af46458a24fd232c074bc8d3716bd` |
| `apps/web/src/i18n/messages/zh.json` | `d48b7219f760e49342eecf6185dcd349fc1a7e7ca9c179b918192ed6c7326f8a` |
