# Section 8 + 11 Audit: POS Integrations + Billing
**Date:** 2026-06-10  
**Auditor:** Sonnet 4.6 (subagent)  
**Repo:** /Users/gschiemann/Desktop/EDU CMS (master / cf5772ae)  
**Scope:** Section 8 (POS / commerce) + Section 11 (Billing + commerce) of the Standard Audit Surface

---

## Coverage Summary

| Section | Name | Coverage | Design | UX | Functionality |
|---|---|---|---|---|---|
| 8 | POS / commerce integrations | covered | B | B+ | B (4 of 5 direct providers wired end-to-end; Toast PARTNER-tier correctly labeled) |
| 11 | Billing + commerce | covered | B | B | A- (Stripe engine is excellent; 3 open gaps) |

---

## Section 8 — POS / Commerce Integrations

### 8.1 Per-provider tier labels — honesty check

All five providers audited against `packages/api-types/src/pos.ts`:

| Provider | Tier label | Has real connector? | Honest? |
|---|---|---|---|
| Square | DIRECT | Yes — `providers/square.ts` full OAuth + catalog poll + webhook | Yes |
| Clover | DIRECT | Yes — `providers/clover.ts` (promoted from PARTNER 2026-06-02) | Yes |
| Lightspeed Retail | DIRECT | Yes — `providers/lightspeed.ts` (promoted from PARTNER 2026-06-02) | Yes |
| Shopify POS | DIRECT | Yes — `providers/shopify.ts` (promoted from PARTNER 2026-06-02) | Yes |
| Toast | PARTNER | No connector (`providers/` has no toast.ts); UI route redirects to partner-program docs | Yes — tier is honest |

**Verdict:** The tier-label honesty problem that existed as a P1 finding (P1-6 in the 06-08 audit, Clover marked DIRECT with no sync) was fixed in commit noted in task #224. All DIRECT providers now have a real `providers/<name>.ts` connector. Toast as PARTNER is correctly labeled — no connector ships and the blurb says "Partner Program required."

### 8.2 Sync code traced to real API calls

**Square:** `squareFetchCatalog()` → real `GET /v2/catalog/list?types=ITEM,CATEGORY` with cursor pagination (capped at 50 pages). OAuth token exchange at `squareApiBase()/oauth2/token`. Webhook signature via `X-Square-HmacSha256-Signature` with `timingSafeEqual`. All real — confirmed by reading `providers/square.ts` in full.

**Clover:** `cloverFetchCatalog()` → real `GET /v3/merchants/{merchantId}/items` + `/categories`. OAuth at `apisandbox.dev.clover.com` (sandbox) / `www.clover.com` (prod). Proactive token refresh when within 1h of expiry (`pos.service.ts:448`).

**Lightspeed:** `lightspeedFetchCatalog()` → real `GET https://{domainPrefix}.retail.lightspeed.app/api/2.0/products` with version-cursor pagination. Token URL is per-retailer host.

**Shopify:** `shopifyFetchCatalog()` → real Shopify Admin REST API `/admin/api/2024-01/products.json` with `page_info` cursor pagination.

**Registry:** `pos/providers/registry.ts` maps all four `providerId → PosConnector` and `getConnector()` returns `null` for `custom-webhook` and unbuilt providers — correctly preventing a 404/crash on unregistered ids.

### 8.3 Menu-board pull (price + auto-86)

**Catalog sync path:**  
- Cron: `pos-sync.cron.ts` fires hourly, iterates all `ACTIVE` `posProviderConnection` rows with a registered connector, calls `pos.service.ts:syncConnection()`. Clover/Lightspeed/Shopify fall back to this poll; Square also has real-time webhook push.
- Upsert: `MenuService.ingestPosCatalog()` writes `MenuItem` rows (default price) + `MenuLocationOverride` per mapped location (per-location price/availability from `NormalizedItem.locationPrices`).

**Auto-86 path (Square):**  
`pos-oauth.controller.ts:354` intercepts `inventory.count.updated` from the Square webhook, calls `menu.applySquareInventoryCounts()` which calls `menu.applyAutoEightySix()`. This sets `MenuLocationOverride.isAvailable=false` per (item, location). The `resolveMenuForLocation()` hide-filter in `menu.service.ts:121` drops unavailable items. Sub-second, no extra API call needed.

**Custom-webhook auto-86:**  
`custom-webhook` provider ingests `{ items: [{externalId, available:false}] }` and calls `applyAutoEightySix()` for BYO POS systems.

**Player endpoint:**  
`GET /screens/:id/menu` (screens.controller.ts:3606) is device-JWT-authenticated via `verifyDeviceForScreen`. Resolves location from `screen.posLocationId → posLocation.locationTenantId` (POS location mapping) or falls back to the screen's own tenant. Calls `resolveMenuForLocation()`. The `?includeUnavailable=1` flag lets menu boards grey-out (not drop) 86'd items.

**Verdict: FUNCTIONAL end-to-end.** The chain Square → OAuth → catalog poll/webhook → MenuItem upsert → per-location override → player menu endpoint is completely implemented. Auto-86 is wired for Square and custom-webhook.

### 8.4 Per-location pricing

`NormalizedLocationPrice` from `providers/square.ts` captures per-`location_id` price overrides from Square variation `location_overrides[]` and `absent_at_location_ids[]`. `MenuService.ingestPosCatalog()` writes a `MenuLocationOverride` for each mapped location. Tests in `pos-multilocation.spec.ts` exercise the full chain end-to-end (no mocks on the fetch layer, mocked Prisma).

The POS store-mapping UI (`/settings/pos`) lets operators map Square `location_id` → their location tenant. `GET /menu/locations` returns the operator's child tenant columns for the price-book console.

### 8.5 Custom-webhook endpoint

`POST /api/v1/pos/webhook/:providerId` in `pos-oauth.controller.ts`. For `custom-webhook`: extracts `X-Webhook-Secret` header, calls `svc.findCustomWebhookConnectionBySecret()` which iterates all `custom-webhook` connections, decrypts credentials via `openCredentials()`, and does `timingSafeEqual` on the decrypted secret (length-check before compare; prefix attacks blocked). If no match → 401. For any other `providerId` → 404 (prevents shadowing real provider receivers). Tests in `pos-webhook.spec.ts` cover all edge cases including evil-tenantId injection, missing-id items, wrong-length prefix attacks.

**This was a P0-5 finding in the 06-08 audit; it is now FIXED and fully wired.**

### 8.6 Missing providers (N-A / deferred)

| Provider | Status |
|---|---|
| Toast (restaurant) | PARTNER — requires commercial enrollment; no connector. Honestly labeled. |
| Stripe Terminal (in-venue checkout) | COMING_SOON — health endpoint (`integrations-health.controller.ts:509`). Correctly labeled. No implementation. |
| MINDBODY (fitness) | Referenced in comments but no `providers/mindbody.ts`. No tier label found in `pos.ts`. |

**Finding 8-F1 (P2):** MINDBODY is mentioned as a future provider in two places (`pos.service.ts:92`, `pos.module.ts:17`) but has no entry in `POS_PROVIDERS` in `api-types/pos.ts` and no connector. If a MINDBODY tile is ever shown in the UI, it would have no tier label and would fail silently. Add an explicit PARTNER/COMING_SOON entry or remove the references.

---

## Section 11 — Billing + Commerce

### 11.1 Stripe Checkout / Portal / Invoices

**Checkout (`POST /api/v1/billing/checkout`):**  
Creates a `stripe.checkout.sessions.create` with `mode: 'subscription'`, passes `client_reference_id: tenantId` and `subscription_data.metadata.tenantId`. Reuses existing `stripeCustomerId` if the License row already has one (no duplicate customers). Returns `{ url }` or `{ enabled: false }` when `STRIPE_SECRET_KEY` is unset. Guard: `DISTRICT_ADMIN | SCHOOL_ADMIN | SUPER_ADMIN` only.

**Portal (`POST /api/v1/billing/portal`):**  
Creates `stripe.billingPortal.sessions.create`. Returns `{ noSubscription: true }` if no `stripeCustomerId`. Graceful degradation when Stripe unconfigured.

**Invoices (`GET /api/v1/billing/invoices`):**  
Fetches `stripe.invoices.list({ customer, limit: 24 })`. Fire-and-forget `syncSubscriptionQuantity()` on every read (self-healing backstop). Returns `{ stripeEnabled, invoices: [] }` when Stripe unconfigured — no throw.

**All three use Stripe-hosted pages.** Card numbers never reach the server. PCI-SAQ-A scope.

### 11.2 Stripe webhook — idempotency + audit rows

This was P0-7 in the 06-08 audit. Verified FIXED in `stripe.service.ts`.

**Idempotency:** `ProcessedStripeEvent.create({ data: { id: event.id, type } })`. Unique primary key on `event.id`. A `P2002` (unique violation) short-circuits to `{ duplicate: true }` with 200 (Stripe doesn't retry). Atomic — INSERT is the lock; no SELECT-then-INSERT race.

**Out-of-order protection:** `event.created` vs `License.stripeLastEventCreatedAt`. If incoming event is OLDER than last-processed event, skip. Equal timestamps are allowed (Stripe same-second minting). Covers `checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.payment_failed`.

**Tenant recovery:** When `metadata.tenantId` is absent (Customer Portal flows don't propagate it), falls back to `license.findFirst({ where: { stripeCustomerId } })`. Warn-logged.

**Audit rows:** Every `syncLicenseFromSubscription`, `applySubscriptionDeleted`, `applyPaymentFailed` writes an `AuditLog` row in the SAME `$transaction` as the License upsert. `auditActionFor()` produces `STRIPE_WEBHOOK_CUSTOMER_SUBSCRIPTION_UPDATED` etc. — consistent with the SUPER_ADMIN audit page format.

**Webhook signature:** `constructWebhookEvent` uses `stripe.webhooks.constructEvent(rawBody, sig, secret)`. Raw body is `req.rawBody` (Buffer). Returns 400 on signature failure (Stripe must not retry — correct). Returns 500 on DB errors (Stripe retries — correct). Endpoint is on the CSRF exempt list.

### 11.3 Seat enforcement — SERIALIZABLE + withDbRetry

**Verified solid** (`screens.controller.ts:1163-1210`):

```
withDbRetry(
  () => prisma.$transaction(
    async (tx) => {
      if (isNewPair) await license.assertSeatAvailable(tenantId, tx);
      return tx.screen.update({ ... pairedAt: new Date() });
    },
    { isolationLevel: 'Serializable', timeout: 20000, maxWait: 10000 }
  ),
  { label: 'screen.pair.seatClaim' }
)
```

`assertSeatAvailable()` checks both `status !== 'ACTIVE'` and `expiresAt < now` (expiry check added in Audit fix #13) and `usedSeats >= seatLimit`. Both the count and the write are inside the SERIALIZABLE transaction. `withDbRetry` re-runs the entire thunk on a serialization failure so the loser doesn't stomp the winner's count. This was P1-13; it is FIXED.

**`LicenseService.assertSeatAvailable()`** returns structured errors with `code: 'LICENSE_INACTIVE' | 'LICENSE_EXPIRED' | 'LICENSE_EXHAUSTED'` and HTTP 402. All three paths covered.

### 11.4 PILOT_SEAT_LIMIT state (P1 concern)

**Finding 11-F1 (P1):** `LicenseService.PILOT_SEAT_LIMIT = 1000` (license.service.ts:33). The comment says:

> "When we onboard the first paying customer, drop this back to 3 (or whatever the contracted seat count is) and verify the License upsert path works end-to-end."

This is a **named TODO that has not been executed** and is now in production. A pilot tenant with no License row can claim up to 1000 screens for free. This was bumped from 3 → 1000 during internal testing (2026-05-04 comment) and was never reset. Two risks:

1. **Revenue loss:** A new district or QSR customer who doesn't go through the Stripe checkout can pair 1000 screens for free forever — there is no expiry on the PILOT tier.
2. **Inaccurate upgrade prompt:** The `activate-trial` endpoint explicitly says `committed: false` and `isPilot: true`, meaning nothing in the License table changes when someone "activates" the free tier. The pilot is perpetual by design, but 1000 seats is far beyond any intended free tier.

**Fix:** Reset `PILOT_SEAT_LIMIT` to the intended free-tier limit (3 seats as per the comments, or 5 for a more generous free tier) before adding any paid customer. Also document the explicit go-live checklist item to do a real License upsert for the first paying tenant via SUPER_ADMIN console.

### 11.5 Trial lifecycle

**No formal trial-lifecycle system exists.** The `POST /billing/activate-trial` endpoint is intentionally read-only (billing.controller.ts:142–168, comment: "nothing was persisted"). The free pilot tier is the default state — there is no time-bounded trial that converts to paid.

**Honest assessment:** For the current pilot (one K-12 school) this is fine. But when selling to multiple tenants simultaneously, there is no mechanism to:
- Start a 14-day trial with automatic expiry
- Send a trial-expiring email at day 7 and day 13
- Block screen pairing when trial expires (only `assertSeatAvailable` checks `expiresAt`, but the PILOT tier returns `expiresAt: null`)

**Finding 11-F2 (P2):** No trial-to-paid conversion funnel in the code. The `activate-trial` endpoint looks like a commitment but makes none. If trial lifecycle is needed before launch, a `POST /billing/start-trial` that upserts a License row with `expiresAt = now+14d, tier='TRIAL', seatLimit=5` is required.

### 11.6 Dunning / PAST_DUE UX

**Backend:** `invoice.payment_failed` webhook correctly sets `License.status = 'PAST_DUE'` in a `$transaction` with an AuditLog row. Out-of-order protection applies. `assertSeatAvailable()` blocks new pairings when `status !== 'ACTIVE'` with error code `LICENSE_INACTIVE`.

**Frontend billing page (`settings/billing/page.tsx:306`):**
```
status === 'PAST_DUE' ? <amber banner> : ...
```
The amber banner exists and shows status. `LicenseCard.tsx:83` also has `data.status !== 'ACTIVE' && <AlertTriangle>`.

**Finding 11-F3 (P2):** The PAST_DUE warning is only on the `/settings/billing` page. There is no **app-wide dunning banner** (e.g., a top-of-page "Your payment failed — update billing to avoid service interruption"). An operator on the Screens or Templates page has no indication their account is PAST_DUE until they navigate to Billing. This means a school admin could miss the alert for days.

**Dunning emails:** No `invoice.payment_failed` webhook handler sends a notification email (no call to `EmailService` in `stripe.service.ts`). Stripe's own Smart Retries + customer notification emails may handle this, but it depends on Stripe being configured to send them — not guaranteed.

### 11.7 PCI sweep

**No card numbers in code:** PCI sweep across all billing, POS, and logging code found zero instances of `card_number`, `cardNumber`, `cvv`, `cvc`, `pan` in any non-comment context. All card entry is on Stripe-hosted Checkout + Customer Portal pages. The `stripe.service.ts` header explicitly confirms: "Card entry happens entirely on Stripe's hosted Checkout + Customer Portal — a card number never reaches our servers (PCI-SAQ-A)."

**Log sweep:** No sensitive card data logged in any billing/webhook handler. Webhook details logged: `eventId`, `eventType`, `subscriptionId`, `stripeCustomerId`, `fromStatus/toStatus` — all safe.

**PCI scope: CLEAN — SAQ-A confirmed.**

### 11.8 Reconcile cron

`license-reconcile.cron.ts` is solid:
- Daily UTC-bucket dedup via `lastRunBucket` (in-process) + `AuditLog` row (multi-replica dedup)
- Only scans `billingMode: CARD, status: { not: CANCELLED }, stripeSubscriptionId: { not: null }`
- Calls same `syncSubscriptionQuantity()` path used by event-driven callers (idempotent — only writes to Stripe when quantity actually differs)
- `skipped` on any Stripe error (never aborts the batch)
- `LICENSE_RECONCILED` audit row written per corrected tenant (with `from/to` quantities)
- `LICENSE_RECONCILE_DISABLED=1` env escape hatch for manual ops
- Tests in `license-reconcile.cron.spec.ts`

This was P1-8; it is FIXED and properly implemented.

### 11.9 Stripe TEST-mode key (known Greg-task)

Per assignment scope: auditing **code readiness only**, not the operational flip.

**Code is ready:** `StripeService.priceIdFor()` reads `STRIPE_PRICE_MONTHLY` / `STRIPE_PRICE_ANNUAL` from env — never hardcoded. `getClient()` lazily constructs `new Stripe(key)` — the same code path works for test and live keys. Price IDs in checkout sessions come from env at call time, not compile time. Swapping `sk_test_...` → `sk_live_...` + updating the two `STRIPE_PRICE_*` env vars on Railway + pointing the webhook secret at the live endpoint is the complete operational step. **No code changes required.**

---

## Findings Summary

### P1 Findings

#### 11-F1: PILOT_SEAT_LIMIT stuck at 1000 — free-tier revenue leak
**Severity:** P1  
**File:** `apps/api/src/license/license.service.ts:33`  
**Evidence:** `static readonly PILOT_SEAT_LIMIT = 1000;` with comment "When we onboard the first paying customer, drop this back to 3"  
**Risk:** Any tenant without a License row can claim 1000 screens for free permanently. The PILOT tier has `expiresAt: null` so there is no automatic enforcement.  
**Fix:** Reset to 3 (or negotiated free-tier limit) before first paid customer. Add to go-live checklist. Optionally add `expiresAt` to PILOT tier or block at the trial-start action.

### P2 Findings

#### 11-F2: No trial-to-paid conversion funnel exists
**Severity:** P2  
**Evidence:** `activate-trial` endpoint (billing.controller.ts:142) explicitly says `committed: false`; no License row is written.  
**Risk:** Cannot run a time-bounded free trial — only a perpetual pilot. Not a launch blocker for the current pilot customer, but blocks multi-tenant commercial sales.  
**Fix:** Add `POST /billing/start-trial` that upserts `License { tier: 'TRIAL', seatLimit: 5, expiresAt: +14d }`. Add expiry email at day 7 and day 13 via Resend.

#### 11-F3: Dunning only visible on /settings/billing — no global banner
**Severity:** P2  
**Evidence:** `settings/billing/page.tsx:306` shows amber badge only on billing settings page. LicenseCard shows only on `/settings/billing` and super admin console.  
**Risk:** A PAST_DUE operator may continue working without knowing their account is delinquent until screens stop pairing.  
**Fix:** Add a global `<LicenseBanner>` component in the shell layout that renders an amber warning strip when `license.status === 'PAST_DUE' || license.status === 'SUSPENDED'`. 10-line fix.

#### 8-F1: MINDBODY mentioned in comments but missing from POS_PROVIDERS registry
**Severity:** P2 (cosmetic risk — no customer-visible surface today)  
**Evidence:** `apps/api/src/pos/pos.service.ts:92`, `pos.module.ts:17` mention MINDBODY but no `POS_PROVIDERS` entry exists.  
**Fix:** Either add a COMING_SOON entry to `api-types/pos.ts` or remove the references to keep the registry honest.

---

## What Is Solid (do not re-spend effort)

1. **Stripe webhook engine** — Idempotency (ProcessedStripeEvent unique-key dedup), out-of-order protection (stripeLastEventCreatedAt), tenant recovery by stripeCustomerId, AuditLog in every $transaction — complete, production-grade.
2. **PCI scope** — SAQ-A confirmed. Zero card data touches the server; all flows through Stripe-hosted pages.
3. **SERIALIZABLE seat-pair transaction** — `assertSeatAvailable` + `screen.update` in one `$transaction(isolationLevel: 'Serializable')` wrapped in `withDbRetry()`. TOCTOU closed.
4. **Provider tier honesty** — All five listed providers correctly labeled. Toast is PARTNER (correct — no connector). Three providers promoted from PARTNER to DIRECT on 2026-06-02 have real connectors.
5. **Custom-webhook endpoint** — Built, tested, constant-time secret compare, no cross-tenant IDOR, evil-tenantId injection blocked.
6. **Per-location pricing (Square)** — Location overrides captured from variation `location_overrides[]`, persisted to `MenuLocationOverride`, resolved by `resolveMenuForLocation()`, served to player via `GET /screens/:id/menu`. Tested in `pos-multilocation.spec.ts`.
7. **Auto-86** — Square `inventory.count.updated` webhook wired to `applySquareInventoryCounts` → `applyAutoEightySix`. Sub-second, no additional API call.
8. **License reconcile cron** — Daily safety net with multi-replica dedup, idempotent, skips non-CARD tenants, writes forensic AuditLog row on drift.
9. **Stripe TEST-mode flip readiness** — All price IDs and secrets are runtime env vars. Zero code changes needed to go live.

---

## Missing Features (Section 8 — per Standard Audit Surface checklist)

- **Toast (restaurant-grade)** — PARTNER, not wired. Requires Toast Partner Program enrollment before a connector can be built. N-A until commercial relationship exists.
- **Stripe Terminal (in-venue checkout)** — COMING_SOON. Distinct from billing Stripe integration; no POS item catalog flow. N-A.
- **Inventory/promo automation beyond Square** — Auto-86 from Clover/Shopify/Lightspeed inventory webhooks not yet implemented (those providers use catalog-level `available` in the catalog poll, not real-time inventory count webhooks). Each provider's inventory webhook API differs.
- **Pull-from-POS for inventory signage (retail)** — Only restaurant menu pattern implemented. Retail "price callout" boards (e.g., Lightspeed product list as a promotional display) not specifically built, though the same catalog sync plumbs into `PosMenuItem` rows that any widget can read.

---

*End of report. Section 8 + Section 11 audit complete.*
