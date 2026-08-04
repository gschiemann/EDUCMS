# §8 POS/COMMERCE + §11 BILLING — re-audit at HEAD `b9122ea0`

> Census agent report, persisted verbatim 2026-08-03 evening. Read-only pass.

**Delta vs baseline: ZERO.** 24 commits since the audit doc (`4fe245e9`). Two independent methods confirm none touched this domain: (1) `git log --oneline 4fe245e9..HEAD -- '*pos*' '*billing*' '*stripe*' '*license*' '*menu*'` → empty; (2) `git diff --stat 4fe245e9..HEAD` over `apps/api/src/{billing,pos,license}`, `packages/api-types/src/{pos,billing}.ts`, `apps/web/src/lib/menu` → empty. Every §8/§11 finding below is re-verified at HEAD, not carried forward.

## 1. Provider table

| Integration | Status | Connector type | Consuming features | Evidence |
|---|---|---|---|---|
| **Square** | **REAL** (UNVERIFIED-live) | OAuth2 authorize→exchange→refresh **+ webhook** (HMAC SHA256/SHA1, raw-body) | Catalog→`PosMenuItem`; menu-platform bridge w/ **per-location price overrides**; `fetchLocations`; **auto-86 from webhook payload**; hourly cron | `providers/registry.ts:64-74`; `pos-oauth.controller.ts:271-333`; `pos.service.ts:513-537,553-557`; auto-86 `pos-oauth.controller.ts:375-386` |
| **Toast** | **COMING_SOON** (honestly gated) | none | none | PARTNER `packages/api-types/src/pos.ts:113`; absent from `registry.ts:63-105`; connect refused `pos.service.ts:99-103`; tile COMING_SOON `integrations-health.controller.ts:514`; no `TOAST_*` in `.env.example` |
| **Clover** | **REAL, poll-only** (UNVERIFIED-live) | OAuth v2 + refresh. **No webhook** | Catalog + categories → `PosMenuItem` + chain-level `MenuItem`; availability at sync time only | `registry.ts:75-84`; availability `providers/clover.ts:232`; cron `pos-sync.cron.ts:56-72` |
| **Lightspeed Retail** | **REAL, poll-only** (UNVERIFIED-live) | OAuth on fixed host, token/refresh per `{domainPrefix}`. **No webhook** | Catalog only; **no `fetchLocations`** despite `locationsSync:true` | `registry.ts:85-94`; `providers/lightspeed.ts:316-332`; over-declared cap `pos.ts:191` |
| **Shopify POS** | **REAL, poll-only** (UNVERIFIED-live) | Admin OAuth, **offline token** (`refreshable:false`). **No webhook** | Catalog only; **REALTIME badge unearned**; `locationsSync:true` with no `fetchLocations` | `registry.ts:95-104`; `realtimeUpdates:true` `pos.ts:216`; badge `settings/pos/page.tsx:343`; own comment concedes it `pos.ts:203-206` |
| **Stripe Terminal** | **NOT BUILT** (catalog entry mislabeled) | none | none | Entry is *Products/Prices*, PARTNER `pos.ts:222-239`; blocked `pos.service.ts:99-103`; tile COMING_SOON `integrations-health.controller.ts:519`. Absence 2 ways: grep `stripe.terminal|terminal.readers|connection_token|@stripe/terminal` across api+web+player → 0; no Terminal dep. |
| *Custom Webhook* | **REAL** | Shared secret, constant-time compare | Full catalog + per-location overrides + 86 push | `pos.service.ts:666-694`; `pos-oauth.controller.ts:439-556` |
| *Aloha (NCR)* / *MINDBODY* | N-A, honestly gated | — | — | `pos.ts:155,246`; refused `pos.service.ts:85-89,99-103` |

**Price-binding path, verified end-to-end:** `connector.fetchCatalog` (`pos.service.ts:491`) → `PosMenuItem` upsert (`:513-537`) → `menu.ingestPosCatalog` (`:553-557`) → `MenuItem.defaultPriceCents` + `MenuLocationOverride` per operator-mapped location (`menu.service.ts:573-621`; manual edits never clobbered `:605-607`) → device-authed `GET /screens/:id/menu` (`screens.controller.ts:4540-4546`) → `resolveMenuForLocation` (`menu.service.ts:121`) → override price wins (`:212-213`), 86 filter (`:208-210`) → `fetchDeviceMenu`/`usePosMenuItems` → `MenuBoardWidget.tsx:128` + 31 `applyMenu()` EXTERNAL_HTML boards.

**Correction to the 2026-07 memory:** "menu prices bind to **live per-location** POS data" holds for **Square and custom-webhook only**. Only `providers/square.ts:249,355` emits `locationPrices`; Clover/Lightspeed/Shopify snapshots carry a single price, so `menu.service.ts:597` iterates an empty array and **no per-location override is ever written** for them — those three bind at chain level. Auto-86 push likewise exists only for Square + custom-webhook.

## 2. Billing findings — open vs fixed at HEAD

| # | Finding | State | Evidence |
|---|---|---|---|
| a | **Stripe idempotency ledger commits before handler work** | **OPEN** | INSERT at `stripe.service.ts:362-374`, `switch` at `:376`. No compensating delete. Controller bubbles → 500 → Stripe retries → short-circuits `duplicate` (`billing-webhook.controller.ts:15,49`). Code names the consequence itself at `stripe.service.ts:800-805`. |
| b | **Same claim-before-work in POS** | **OPEN, worse nuance** | `pos.service.ts:851-871`. Custom-webhook caller `pos-oauth.controller.ts:485` claims then awaits → throw = 5xx + operator retry dropped as duplicate. Square caller `:363` claims then dispatches **fire-and-forget** (`void …catch` `:380-386,:397-402`) and returns 200 — a failed sync is lost with *no* retry at all. |
| c | **No test-vs-live key detection; UI implies live** | **OPEN** | `enabled()` = `!!STRIPE_SECRET_KEY` (`stripe.service.ts:112-114`); no prefix inspection anywhere (2-method sweep); `GET /billing/status` returns "Stripe is configured — checkout, portal and invoices are live." (`billing.controller.ts:139-141`). **Prod key is TEST-prefixed → the string is false in prod.** |
| d | Advertised 14-day / 3-screen trial unenforced | **OPEN** (KNOWN/deliberate per audit correction) | Copy `billing.ts:62-70`; reality `license.service.ts:42-61,77-85`; `activate-trial` persists nothing (`billing.controller.ts:158-177`). |
| e | POS cron not multi-replica safe | **OPEN** | In-process `lastRunBucket` + `setInterval`, no Redis lock (`pos-sync.cron.ts:21,31,42-44`). |
| f | Price docstring contradicts catalog | **OPEN** | `stripe.service.ts:16-17` says $15/$150; catalog 2500¢/24000¢ (`billing.ts:83,113`). |
| g | POS env keys missing from CLAUDE.md | **OPEN** | Defined `.env.example:255-284`; zero CLAUDE.md hits. |

**Seat enforcement — INTACT.** `assertSeatAvailable` (`license.service.ts:127-160`) inside a `Serializable` `$transaction` + `withDbRetry` (`screens.controller.ts:1534-1577`). Exactly one caller — pairing-time only. **License-lapse-never-stops-playback still true** (2 methods). **New aggravator:** `apps/web/src/app/terms/page.tsx:61` publishes "Failed credit-card payments result in a 10-day grace period before downgrading to read-only" — **no read-only mode exists** (grep sweep → zero). No longer just an undocumented owner decision; it contradicts the shipped Terms.

**PCI — CLEAN, re-verified.** No card field in web (full selector sweep → only lucide `CreditCard` icons). No `@stripe/stripe-js`; server SDK only. Hosted-only checkout + portal. No PAN logging.

**Dunning/invoices/portal.** Invoices **REAL** (hosted URL + PDF links). Portal **REAL**. Dunning **STUB** — status pill + chip only; no banner/CTA/email (sweep → zero). Refunds absent (2 methods).

## 3. Ranked open findings

1. **P1 — Stripe idempotency commit-before-work** (`stripe.service.ts:362-374`): permanent loss of `payment_failed`/`payment_succeeded` transitions.
2. **P1 — Billing UI claims "live" on a test key** (`stripe.service.ts:112-114` + `billing.controller.ts:139-141`): prod is on `sk_test`; a real prospect can believe money moved. One-line fix: derive mode from prefix + amber banner.
3. **P1 — POS claim-before-work** (`pos.service.ts:851-871`): Square variant loses failed syncs entirely; webhook variant blocks operator retry.
4. **P1 — Advertised trial not enforced** (known/deliberate, but copy still overstates).
5. **P2 — License lapse never gates playback, and Terms promise it does** (`terms/page.tsx:61`).
6. **P2 — Shopify REALTIME badge with no receiver** (`pos.ts:216` → `settings/pos/page.tsx:343`).
7. **P2 — Per-location price binding is Square-only** among OAuth connectors while POS page copy promises location-driven prices (`settings/pos/page.tsx:113`).
8. **P2 — POS cron not multi-replica safe** (`pos-sync.cron.ts:21,42-44`).
9. **P2 — Dunning is state-only** (`LicenseCard.tsx:86-88`).
10. **P3** — price docstring off 40%; POS env keys absent from CLAUDE.md; Lightspeed/Shopify `locationsSync:true` with no `fetchLocations`.

## 4. Grades at HEAD

| Subdomain | D | UX | F |
|---|---|---|---|
| **§8 POS / Commerce** | **B+** | **A−** | **B+** |
| **§11 Billing** | **B** | **C+** | **A−** |

Unchanged from baseline — consistent, since no code in the domain moved.

## 5. UNVERIFIED

1. Every tenant-level POS connection is UNVERIFIED-live (no platform keys in prod; DB rows unreadable; no evidence of a live OAuth round-trip in-repo).
2. Whether `STRIPE_PRICE_MONTHLY`/`_ANNUAL` point at $25/$240 or the docstring's $15/$150 (needs prod values).
3. Railway replica count (sets severity of the cron finding).
4. Clover/Lightspeed refresh-token rotation semantics.
5. Whether no-runtime-license-gating is deliberate — no ADR; now in tension with `terms/page.tsx:61`. Owner decision.
