# §8 POS + §11 Billing audit — 2026-08-03

**Scope:** full. Both assigned sections covered; no scope-down. Read-only throughout.

**Headline:** §8 is a genuinely REAL integration domain — 4 working OAuth connectors + a custom-webhook escape hatch, encrypted creds, per-location price resolution, device-authed board feed. The 2026-06-26 "76 REAL / ~1 costume" claim **holds for this domain** with one nuance (an unearned "realtime" badge). §11 Stripe is well-hardened (idempotency, out-of-order, SERIALIZABLE, audit rows, PCI-SAQ-A clean) with **three launch-relevant gaps**: a commit-before-work idempotency ledger, an advertised-but-unenforced 14-day trial, and no test-vs-live mode disclosure while prod runs `sk_test`.

## Coverage table

| Bullet | Status | D | UX | F | Note |
|---|---|---|---|---|---|
| **§8** Square | covered | B+ | A- | A- | Full OAuth+catalog+locations+webhook+HMAC |
| §8 Toast | N-A (not built) | B | B+ | — | PARTNER; rejected at API boundary, honest UI |
| §8 Clover | covered | B+ | A- | B+ | DIRECT since 2026-06-02; no webhook (cron only) |
| §8 Lightspeed Retail | covered | B+ | A- | B+ | X-Series OAuth + catalog; cron only |
| §8 Shopify POS | covered | B+ | B+ | B | Offline token (no refresh); **realtime badge unearned** |
| §8 Stripe Terminal (in-venue checkout) | **N-A (not built)** | — | C | — | Catalog entry is Stripe *Products*, not Terminal checkout |
| §8 pull-from-POS → menu boards (price+auto-86) | covered | A- | A- | A- | Device-authed, per-location, last-good fallback |
| §8 pull-from-POS → inventory signage | deferred | — | — | — | Explicitly out of scope, `pos.ts:19-22` |
| §8 promo / happy-hour automation | covered | B | B | B+ | Via `Daypart` → `MenuCategory` binding |
| §8 per-location price binding | covered | B+ | B | A- | `resolveMenuForLocation`; 2026-07-10 fix verified |
| §8 token refresh / expiry | covered | — | B | B+ | 1h proactive window; fail-soft |
| §8 webhook vs polling | covered | — | B | B | Only Square + custom-webhook push; rest hourly |
| §8 rate limits | partial | — | — | C+ | 50-page cap; **cron not multi-replica safe** |
| §8 failure UX when POS goes RED | covered | B | B+ | B+ | `status=ERROR` + `statusReason` in UI |
| §8 graceful degrade to manual prices | covered | — | A- | A | Keeps last-good; falls to static items |
| **§11** Checkout / Portal / Invoices | covered | B+ | A- | A- | Hosted-only; duplicate-sub idempotency |
| §11 webhook idempotency | covered | — | — | **B-** | Ledger commits **before** work → loss window |
| §11 webhook ordering | covered | — | — | A | Watermark + ordering-immune invoice re-fetch |
| §11 webhook audit | covered | — | — | A | AuditLog in same tx, every mutation |
| §11 seat enforcement (SERIALIZABLE) | covered | — | B+ | A- | Real SSI; **pairing-time only** |
| §11 multi-vertical pricing tiers | partial | C+ | C+ | C | One flat per-screen price; tier names generic |
| §11 free pilot lifecycle | **gap** | C | C | **D** | Advertised 14d/3-screen ≠ enforced 1000/perpetual |
| §11 dunning / past-due UX | partial | C | C | C+ | Status renders; no dunning banner/email/CTA |
| §11 refunds | **N-A (not built)** | — | — | — | Zero refund code (2 methods) |
| §11 comp seats (SUPER_ADMIN) | covered | B | B+ | A- | `POST /license/tenants/:id/comp` |
| §11 PCI scope | covered | — | — | **A** | No card field anywhere; no Elements; no PAN logging |
| §11 graceful degrade w/o `STRIPE_SECRET_KEY` | covered | B+ | A- | A | `{enabled:false}` / `[]`, honest copy |
| §11 test-mode vs live-mode honesty | **gap** | — | **D** | — | UI says "live" while prod is `sk_test` |

## Integration reality table

| Provider | Auth flow | Data fetch | Renders where | Verdict | Evidence |
|---|---|---|---|---|---|
| **Square** | OAuth2 authorize→exchange→refresh | `/v2/catalog/list` cursor-paged (50-page cap) + `/v2/locations` | `PosMenuItem` → `MenuBoardWidget`, tap lists, cocktail menus, 31 EXTERNAL_HTML `applyMenu()` boards | **REAL** | `providers/square.ts:47,82,122,211,280`; `registry.ts:64-74` |
| **Clover** | OAuth v2 + refresh, `merchant_id` from callback | `/v3/merchants/{id}/items` + `/categories` | same | **REAL** | `registry.ts:75-84`; `providers/clover.ts` |
| **Lightspeed Retail** | OAuth on fixed host, token/refresh per `{domainPrefix}` | `/api/2.0/products` + `/product_categories`, version-cursor paged | same | **REAL** | `registry.ts:85-94`; `providers/lightspeed.ts` |
| **Shopify POS** | Admin OAuth, offline token (`refreshable:false`) | `/admin/api/<ver>/products.json`, Link-header paged | same | **REAL** (webhook gap) | `registry.ts:95-104`; `providers/shopify.ts` |
| **Custom Webhook** | Shared secret, constant-time compare | Operator pushes `{items:[…]}`, ≤2000/batch | same | **REAL** | `pos.service.ts:666,715`; `pos-oauth.controller.ts:439,446` |
| **Toast** | — | — | — | **N-A, honestly gated** | `pos.ts:110-123`; blocked `pos.service.ts:99-103` |
| **Stripe (Catalog)** | — | — | — | **N-A, honestly gated** | `pos.ts:221-239` — downgraded to PARTNER by prior audit |
| **MINDBODY** | — | — | — | **N-A, honestly gated** | `pos.ts:242-256` |
| **Aloha (NCR)** | — | — | — | **N-A, info-only tile** | `pos.ts:152-170`; blocked `pos.service.ts:85-89` |

No provider in this domain is a costume in the misleading sense. Every non-working provider is refused at the API boundary (`pos.service.ts:85-103`) *and* rendered with an honest tier badge (`settings/pos/page.tsx:310-330`). The `partnerOnly()` helper in `integrations-health.controller.ts:513` correctly falls through for DIRECT ids — it does not stale-label the four working connectors.

**Per-location price binding verified.** POS catalog → `menu.ingestPosCatalog` → `MenuItem` + `MenuLocationOverride` (`pos.service.ts:553-557`); the player reads device-authed `GET /screens/:id/menu` (`screens.controller.ts:4411,4454`) which calls `resolveMenuForLocation` (`menu.service.ts:121`). Auto-86 resolves via `isAvailable === false || soldOutUntil > now` (`menu.service.ts:244-252`). The 2026-07-10 "menu prices bound" fix is commit `916f2257`.

## Findings

**[P1] Stripe idempotency ledger commits before the work — a failed handler permanently loses the event — NEW**
`stripe.service.ts:362-374` INSERTs `processedStripeEvent` *before* the switch dispatches. If the handler then throws, the controller returns 500, Stripe retries the same `event.id`, and the retry short-circuits as `duplicate`. There is no compensating delete (verified: `processedStripeEvent` appears at only two sites repo-wide, one being a comment). The code itself names the consequence at `stripe.service.ts:800-805` — "a real payment_failed downgrade or payment_succeeded recovery is permanently lost." `withDbRetry` narrows the window for *transient* DB errors but does nothing for a non-transient throw (Stripe API 500 on the `subscriptions.retrieve` at line 384/774, a serialization exhaustion, a pod OOM mid-handler). Impact: an unpaid tenant silently stays ACTIVE, or a paying tenant stays stuck PAST_DUE, with no retry left. Fix sketch: move the ledger INSERT *inside* the same transaction as the mutation, or delete the ledger row in a `catch` before rethrowing. **The identical pattern exists in POS** (`pos.service.ts:851-871`, `claimWebhookEvent`) — same fix.

**[P1] Advertised 14-day / 3-screen free trial is not enforced anywhere — NEW**
`billing.ts:62-71` advertises `FREE_TRIAL` = "14 days, up to 3 screens, no credit card needed" and this is what a prospect sees on the pricing surface. Reality: a tenant with no License row gets `tier:'PILOT'`, `seatLimit: PILOT_SEAT_LIMIT` (default **1000**), `expiresAt: null` — perpetual (`license.service.ts:42-61, 77-85`). `POST /billing/activate-trial` explicitly persists nothing (`billing.controller.ts:158-177`, `committed:false`). The service comment concedes the real cap awaits "the PLAN-001A entitlement backfill." Impact: unlimited free usage forever; no trial→paid conversion pressure; the pricing page is a product-truth violation at launch. Fix sketch: either set `PILOT_SEAT_LIMIT=3` and write a real `License{tier:'FREE_TRIAL', expiresAt:+14d}` at signup, or change the marketing copy to match reality. To the code's credit, the boot warning at `license.service.ts:52-55` makes this loud rather than silent.

**[P1] Billing UI cannot distinguish test mode from live mode, and prod is on `sk_test` — NEW**
`GET /billing/status` returns only a boolean and the string "Stripe is configured — checkout, portal and invoices are live" (`billing.controller.ts:135-143`). `enabled()` is `!!process.env.STRIPE_SECRET_KEY` (`stripe.service.ts:112-114`) — it never inspects the `sk_test_` vs `sk_live_` prefix. Launch-readiness confirms prod still runs test keys. Grep for `test mode|sk_test|livemode` across the billing page and controller returns nothing. Impact: an operator (or Greg demoing) sees "live" while checkout is a sandbox; invoices are test invoices; a real customer could believe they've paid. Fix sketch: derive `mode: key.startsWith('sk_live_') ? 'live' : 'test'` and render a persistent amber "Test mode" banner on the billing page.

**[P2] License status never gates playback — an expired/cancelled tenant's screens run forever — NEW**
Verified two ways: (1) grep for `assertSeatAvailable|LICENSE_EXHAUSTED|LICENSE_EXPIRED|LICENSE_INACTIVE` across `apps/api/src` returns exactly one caller — `screens.controller.ts:1534`, inside `pair()`; (2) grep for any license reference in the manifest/player serving path returns nothing. So enforcement is **pairing-time only**. A tenant who cancels, charges back, or lapses keeps every already-paired screen playing indefinitely. Impact: revenue leak, and no lever to enforce non-payment. May be *intentional* for a life-safety product (screens must not go dark), but nothing documents that decision. Fix sketch: either document it as deliberate, or add a soft degrade (watermark / reduced feature set) on `SUSPENDED`/`CANCELLED` while leaving emergency paths untouched.

**[P2] POS sync cron is not multi-replica safe — NEW**
`pos-sync.cron.ts:31-45` uses `setInterval` + an **in-process** `lastRunBucket`. Every Railway replica runs the full hourly sweep over every ACTIVE connection independently. CLAUDE.md §17 explicitly requires "in-memory caches → Redis when load-bearing." Impact: N× the Square/Clover/Shopify/Lightspeed API calls per hour, burning provider rate limits and risking 429-driven `status='ERROR'` flapping on customer connections. Upserts are idempotent so data stays correct. Fix sketch: a Redis `SET NX EX 3600` bucket lock, matching the pattern the POS OAuth state store already uses (`pos-oauth.controller.ts:98,584`).

**[P2] Shopify advertises a "realtime" badge with no webhook receiver — NEW (nuances the "76 REAL / ~1 costume" claim)**
`pos.ts:216` sets `realtimeUpdates: true` for `shopify-pos`, and `settings/pos/page.tsx:344` renders a green REALTIME badge off that flag. But only two webhook receivers exist: `@Post('webhook/square')` (`pos-oauth.controller.ts:271`) and `@Post('webhook/:providerId')` which hard-rejects anything but `custom-webhook` (`:439,446`). Shopify's own registry comment admits "webhook receive isn't wired yet" (`pos.ts:204-206`). Impact: an operator picks Shopify expecting instant price/86 propagation and gets up-to-60-minute staleness — exactly the "we changed the burger price and the screens still say $7.99" failure the module was built to kill. Fix sketch: flip to `realtimeUpdates:false` until the receiver ships (one-line honesty fix), or wire the Shopify webhook. Toast/Aloha carry the same over-declared capability blocks but are unreachable, so they're cosmetic only.

**[P2] Stripe price documentation contradicts the shipped catalog — NEW**
`stripe.service.ts:16-17` documents `STRIPE_PRICE_MONTHLY` as "$15/screen/mo" and `STRIPE_PRICE_ANNUAL` as "$150/screen/yr". The actual catalog is $25/mo and $240/yr (`billing.ts:26-27,82-84,101-113`), matching CLAUDE.md. Impact: whoever creates the Stripe Products at go-live follows the nearest docstring and mis-prices the product by 40%. Fix sketch: correct the docblock.

**[P2] POS OAuth env vars are absent from CLAUDE.md's env table — NEW**
`SQUARE_CLIENT_ID/_SECRET/_WEBHOOK_SIG_KEY/_ENV`, `CLOVER_*`, `LIGHTSPEED_*`, `SHOPIFY_*` are all defined in `.env.example:255-284` and read at `providers/square.ts:52,86-87` etc., but grep for `SQUARE_|CLOVER_|SHOPIFY_|LIGHTSPEED_` in CLAUDE.md returns nothing. Also missing: `PILOT_SEAT_LIMIT` and `POS_CRON_DISABLED`. Impact: CLAUDE.md is declared "the source of truth"; an operator or agent configuring a QSR/retail tenant has no signal these keys exist, so POS silently stays unconfigurable. Fix sketch: add a POS block to the env table.

**[P2] Dunning is state-tracking only — no operator-facing recovery flow — NEW**
`PAST_DUE` is computed correctly and stored, and the billing page renders the status string (`settings/billing/page.tsx:306`). But there is no past-due banner, no "update your card" CTA, no dunning email (grep for `dunning|payment failed|grace` across the billing page and `LicenseCard.tsx` returns only that one status branch). Impact: a failed card silently degrades to a status word the operator will never notice. Fix sketch: an amber banner + direct Customer Portal deep-link on `PAST_DUE`, plus a Resend email on the `invoice.payment_failed` handler (`stripe.service.ts:730`).

**[P2] Refunds have no path at all — NEW**
Two independent methods (grep `refund` across `apps/api/src` + `apps/web/src`; grep `refunds\.|creditNotes|credit_note` for SDK usage) both return zero. Comp seats exist (`super-license.controller.ts:193-203`) but a refund requires the Stripe dashboard. Acceptable for launch given hosted Portal handles cancellation; flagging so it isn't mistaken for built.

## What's genuinely strong (don't regress)

- **PCI-SAQ-A is clean and verified.** No card-entry field anywhere in `apps/web/src` (sweep for `cardNumber|cvv|cvc|creditCard|securityCode|autocomplete="cc-`), no `@stripe/stripe-js` / `CardElement` dependency, no raw webhook-payload logging. Card entry is Stripe-hosted Checkout + Portal only.
- **Webhook ordering** is better than most production systems: a SERIALIZABLE read-check-write closing the TOCTOU (`stripe.service.ts:537-611`), plus a deliberately ordering-*immune* invoice path that re-fetches live subscription truth rather than trusting event order, with an advance-only watermark (`stripe.service.ts:730-833`).
- **Seat enforcement** is a real PG SSI transaction with `withDbRetry` on P2034, not an advisory check (`screens.controller.ts:1529-1572`).
- **Menu-board degradation** is exactly right for a live service: first-load failure → static items; any later failure → keep last-good, never blank mid-service (`use-pos-menu-items.ts:78-86`). The device-auth fix in `device-menu.ts` closed a real "demoed on the laptop, dead on the wall" bug.
- **Credential handling**: envelope encryption per row, OAuth state nonce Redis-first with in-process fallback, provider-match replay defense (`pos-oauth.controller.ts:211-216`), constant-time webhook-secret compare that deliberately doesn't early-return (`pos.service.ts:686-692`), and tenant-scoped POS dedup keys after the 2026-07-03 cross-tenant fix (`pos.service.ts:851-871`).

## Unverified / open questions

1. **Whether any POS connector has been exercised against a live sandbox.** All four are code-complete and unit-tested, but no evidence of a real end-to-end OAuth round-trip. Square most likely to work first-try; Lightspeed's per-retailer host and Shopify's shop-domain-at-authorize are the shapes most likely to have a live-only bug.
2. **Whether `STRIPE_PRICE_MONTHLY`/`_ANNUAL` in prod point at $25/$240 or the docstring's $15/$150.** Requires reading prod env — out of scope per the secrets rule.
3. **Replica count on Railway.** The multi-replica cron finding's severity is P2 at 1 replica and P1 at 3+.
4. **Clover/Lightspeed refresh-token rotation semantics.** Refresh call sites and the 1-hour proactive window verified (`pos.service.ts:451-478`), but not whether each provider returns a rotating vs static refresh token — a provider that rotates and whose refresh silently fails will decay to `status='ERROR'` after expiry rather than at failure time (the catch at `:474-477` deliberately continues with the old token).
5. **Whether the "no runtime license gating" behavior is a deliberate life-safety decision.** No ADR or code comment states it either way.
