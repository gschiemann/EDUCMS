# Business profit UI implementation

`/super/profit` provides a SUPER_ADMIN-only view of committed monthly revenue, tracked receivables, recorded recurring platform costs, estimated contribution profit and margin, and service capacity. It labels revenue and profit as estimates, exposes unpriced customers and partial cost coverage, and states that provider bills are not synced and no provider plan is upgraded automatically. The cost register records manual entries, budgets, next bill dates, notes, observed timestamps, and archive/restore state. The existing capacity card is reused without modification.

The data hooks use the `['super-business']` query key, are disabled until the hydrated user is confirmed as `SUPER_ADMIN`, do not poll, and invalidate the business summary after cost mutations. Amount entry converts decimal dollar strings directly to integer cents.

## Validation

- `pnpm --filter web exec jest --runInBand src/lib/__tests__/business-profit.test.ts src/app/super/profit/__tests__/page.test.tsx` — 2 suites, 4 tests passed.
- `pnpm --filter web exec eslint src/app/super/profit/page.tsx src/app/super/profit/__tests__/page.test.tsx src/hooks/use-business-profit.ts src/lib/business-profit.ts src/lib/__tests__/business-profit.test.ts` — passed.
- `pnpm --filter @cms/api-types build` and `pnpm --filter @cms/scoreboard-cts build` — passed in this isolated worktree.
- `pnpm --filter web exec tsc --noEmit` — passed after workspace type packages were built.
- `node apps/web/tools/check-i18n-parity.cjs` and `git diff --check` — passed.

## SHA-256

| File | SHA-256 |
|---|---|
| `apps/web/src/app/super/profit/page.tsx` | `c9c05ebb52fd05b9d4b6031ab014a6e3007b1248bdf83a3d06f1ee28ad6f5edb` |
| `apps/web/src/app/super/profit/__tests__/page.test.tsx` | `9cbfb355f122dab585725ca4009937d7521a2b6f61068e7133d905dc5ceeea44` |
| `apps/web/src/hooks/use-business-profit.ts` | `4f4024e299798c916d0b0f79ea4f635c45059412adf8ecfe9835a7e6688acc78` |
| `apps/web/src/lib/business-profit.ts` | `c8d814100d60ef80bbe4e8c9670f6235ca23be13181fbc9288c28a1efc173a06` |
| `apps/web/src/lib/__tests__/business-profit.test.ts` | `1c509944d97d5554811a3c7f809f524935fd386d9975b10ed03c3310cbab4873` |
| `apps/web/src/i18n/messages/en.json` | `1cc3f05c644689fb2023ab473c9d280fc285e4f7878a77c197a0d04f89283ea2` |
| `apps/web/src/i18n/messages/es.json` | `297b3fd8d7a1430f3ee5a33509b99d5e7cb4c36fae8604241c1d0e2a36e693a9` |
| `apps/web/src/i18n/messages/zh.json` | `cb60673790b3f96c109f173920a1f20777f356c264abed77ceb0e4766475d5f5` |
