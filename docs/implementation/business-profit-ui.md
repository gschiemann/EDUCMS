# Business profit UI implementation

`/super/profit` provides the SUPER_ADMIN-only view of committed monthly revenue, tracked receivables, recorded recurring platform costs, estimated contribution profit and margin, recommendations, and service capacity. It labels revenue and profit as estimates, exposes unpriced customers and partial cost coverage, and explains that provider bills are not automatically synced and provider plans are never upgraded automatically. The cost register records monthly estimates with budgets, next bill dates, notes, source/freshness labels, and archive/restore state. Existing capacity UI is reused without modification.

The hooks use `['super-business']` for the summary and `['super-business-provider-usage']` for provider observations; both are enabled only after the hydrated owner check. Neither polls. Cost mutations invalidate the summary. Provider observations have a five-minute stale time and an explicit refresh action. Live accrued usage is displayed separately from profit, with source state, scope, period, observation time, items, and provider console link; the UI clearly identifies it as partial-period usage rather than a complete monthly bill. Supabase is identified as manual, with capacity readings kept separate from bills. No provider credentials are entered or changed in the UI.

Cleared optional cost fields are submitted as explicit `null`. “Other” provider values remain separate from service names. Recommendation codes and values are localized in English, Spanish, and Chinese, with legacy prose as fallback. Currency and dates use the active locale. Dollar entry converts directly to integer cents. The summary metric grid uses two columns at 375px and four at wide desktop widths; estimate details can be expanded.

## Validation

- `pnpm --filter web exec jest --runInBand src/lib/__tests__/business-profit.test.ts src/app/super/profit/__tests__/page.test.tsx` — 2 suites, 4 tests passed.
- Target ESLint across the profit page/panel, tests, hook, and helper — passed.
- `pnpm --filter web exec tsc --noEmit` — passed after workspace type packages were built in this isolated worktree.
- `node apps/web/tools/check-i18n-parity.cjs` — passed, 5,125 keys in each catalog.
- `git diff --check` — passed.
- Browser suite: `pnpm --filter web exec playwright test --config src/app/super/profit/playwright.config.ts`. The config starts `next dev` on port `3263` (`http://127.0.0.1:3263`) with `NEXT_PUBLIC_API_URL=http://localhost:8080/api/v1`; browser fixture routes intercept API requests and keep the check isolated from the main tree. Chromium and WebKit each passed cost create/edit/null clearing/archive/restore, provider usage rendering, console check for business endpoint errors, 375px no-horizontal-overflow check, and two-column summary layout (2 tests passed, 20.4 seconds).
- Full-page 375px screenshots were generated and visually reviewed: `apps/web/test-results/profit-chromium-375.png` (SHA-256 `36cf7a0e048d4a7307619e6c23aa217ebbe75c3680b1f3eb5cae3a4b19b7d1c4`) and `apps/web/test-results/profit-webkit-375.png` (SHA-256 `fdbe62e17a4595b1fd0728ecba237fc5ab2187828ae60fe575b4819f51987812`). They are ignored Playwright artifacts, not tracked source files.

## SHA-256

| File | SHA-256 |
|---|---|
| `apps/web/src/app/super/profit/page.tsx` | `ec8f7a7024fc6e55e1b01a97c7c4102ec980626a51745a043813be3c853cf274` |
| `apps/web/src/app/super/profit/ProviderUsagePanel.tsx` | `a8a9af410eeae718e27213b13e8f0cf677167f73ce376ffa816be4d92ddafb4d` |
| `apps/web/src/app/super/profit/__tests__/page.test.tsx` | `c61cc64d4e8d96a16faebf8434eda2d0c04d956502831ee14cd27321485d1c7e` |
| `apps/web/src/app/super/profit/business-profit.spec.ts` | `905276cd7f84a12fb54534c0b6ededbc614c87f0954c32f71532f8c900863670` |
| `apps/web/src/app/super/profit/playwright.config.ts` | `cfc3da3a18fe0b458d0a1380731512499d9138cfe72b9dc26ef49145abac1fe3` |
| `apps/web/src/hooks/use-business-profit.ts` | `87c2870b9912ad97c68f86e585fccb48ee3037274a68bf2842418b817a616800` |
| `apps/web/src/lib/business-profit.ts` | `e6efbaadb2d6449ed69ca3f13c7df2b20364f311a65eceb13e633ad441926a5e` |
| `apps/web/src/lib/__tests__/business-profit.test.ts` | `4da0ab3b31aa40c4b6ac6f6b3490c4044f12b8cbd37936904358b9c851e6ca26` |
| `apps/web/src/i18n/messages/en.json` | `3e93a556d5dccbfdd3967f0903fc7a9e46512b4073a440005f3698e8657d8c6b` |
| `apps/web/src/i18n/messages/es.json` | `ad671bf551de52c20e581bc87c678bb8fbbfb69f94c2410d4391e2967b800ca9` |
| `apps/web/src/i18n/messages/zh.json` | `fb437f874fd4c8e040bb936b0629e883404e84a89a8a9790399aa449f429077c` |
