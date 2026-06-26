# Wave D — POS / commerce reality (§8)

**Agent:** CD2 (POS / commerce)
**Date:** 2026-06-26 (final pre-launch beta audit)
**Surface:** §8 POS / commerce integrations — Square, Toast, Clover, Lightspeed, Shopify, Stripe Terminal/Catalog (+ Aloha/NCR, MINDBODY, Custom Webhook)
**Scale tier:** 50-location self-serve menu-management platform (chain operator maps POS stores → child location tenants → per-location price book → live menu boards). Verified against the multi-location bridge.
**Standard Audit Surface §§ covered:** §8 (POS/commerce — full), with spill into §16 (forensic: webhook idempotency/dedup) and §15 (the CSRF-exempt class that bit OTA/CTS/sponsor before).

Method: read every provider module + registry + OAuth/webhook controller + menu resolution path; traced applyMenu/per-location pricing end-to-end; curled live prod (`api-production-39a1.up.railway.app`). Read-only — no source edited.

---

## Provider-by-provider classification table

| provider / integration | Verdict | Evidence (file:line / curl) | Notes |
|---|---|---|---|
| **Square** (Catalog) | **REAL** | `providers/square.ts:93,128,212,298` (real `fetch` to `/oauth2/token`, `/v2/locations`, catalog); registry `registry.ts:64-74`; OAuth `pos-oauth.controller.ts:123-267`; webhook receiver `pos-oauth.controller.ts:271-383` (HMAC SHA256+SHA1, idempotent, auto-86). | DIRECT. OAuth + catalog sync + multi-location + inbound webhook all coded. **BUT inbound webhook is CSRF-blocked in prod — see F1.** Needs `SQUARE_CLIENT_ID/SECRET` + `SQUARE_WEBHOOK_SIG_KEY` (DEFERRED on creds, code REAL). |
| **Clover** | **REAL** | `providers/clover.ts:104,135,183,211` (real `fetch` to OAuth v2 `/token`,`/refresh`, `/v3/merchants/{id}/items`+`/categories`); registry `registry.ts:75-84`. Promoted PARTNER→DIRECT 2026-06-02 (`pos.ts:124-147`, task #178). | DIRECT, self-serve OAuth. Sandbox/prod host switch via `CLOVER_ENV`. realtimeUpdates:false (cron + manual sync only — honest). DEFERRED on `CLOVER_CLIENT_ID/SECRET`. |
| **Lightspeed Retail** (X-Series) | **REAL** | `providers/lightspeed.ts:170,208,266,302` (real `fetch` to `/api/1.0/token`, `/api/2.0/products`+`/product_categories`); registry `registry.ts:85-94`. Promoted PARTNER→DIRECT 2026-06-02 (`pos.ts:170-190`). | DIRECT, self-serve OAuth, version-cursor paged. DEFERRED on `LIGHTSPEED_CLIENT_ID/SECRET`. |
| **Shopify POS** (Admin API) | **REAL** | `providers/shopify.ts:142,253` (real `fetch` to `/admin/oauth/access_token`, `/admin/api/<ver>/products.json`); registry `registry.ts:95-104`; shop-domain sanitizer `pos-oauth.controller.ts:83-91`. Promoted 2026-06-02 (`pos.ts:192-215`). | DIRECT, offline token (refreshable:false). Shop domain collected at authorize-time. REST Admin is Shopify-"legacy"; GraphQL migration tracked separately (honest comment). DEFERRED on `SHOPIFY_CLIENT_ID/SECRET`. |
| **Custom Webhook** (BYO POS) | **COSTUME (in prod)** / built-but-blocked | Controller built `pos-oauth.controller.ts:418-531` (3 payload shapes: menu / availability-86 / legacy items, secret-auth, idempotent). **Curl prod: `POST /api/v1/pos/webhook/custom-webhook` → HTTP 403 `CsrfError`** (both no-secret and with-secret). Not in CSRF exempt list `csrf.middleware.ts:17-125`. | **THE P0.** DIRECT, self-serve, no creds needed — the one POS path that should "just work" for launch, and the documented workaround for every PARTNER provider (`settings/pos/page.tsx:416`). Dead in prod. See F1. |
| **Toast** | **NOT-BUILT** (honest PARTNER) | `pos.ts:109-123` integrationTier PARTNER; no `providers/toast.ts` (none found); registry has no `toast` entry. FE shows "connector is in development" panel, no Connect button (`settings/pos/page.tsx:403-418`). | Honestly tiered. Real public Menus API exists but gated on Toast Partner Program. Not a costume — UI tells the truth. |
| **Stripe (Catalog)** | **NOT-BUILT** (honest PARTNER) | `pos.ts:218-236` — explicitly downgraded DIRECT→PARTNER 2026-05-28 (P1-6) because it had no sync handler; comment says so. No `providers/stripe*.ts`. FE PARTNER panel. | Distinct from the (REAL) Stripe *billing* integration. As a menu source it's NOT-BUILT and labeled "Connector in development." Honest. |
| **MINDBODY** (fitness) | **NOT-BUILT** (honest PARTNER) | `pos.ts:240-253` PARTNER; no provider module; FE PARTNER panel. | Public API exists, partner registration required. Honest. |
| **Aloha (NCR)** | **NOT-BUILT** (honest CLOSED) | `pos.ts:149-167` CLOSED, `salesLedOnly:true`; FE renders info-only tile linking to docs (`settings/pos/page.tsx:309,313`). | No public API; CSV-export workaround documented. Correctly an info tile, no fake form. |
| **Stripe Terminal (in-venue checkout)** | **NOT-BUILT** | Not present anywhere; the `stripe-terminal` id maps to the *Catalog* source above, not in-venue payment-terminal checkout (§8 line item). No Terminal SDK / reader code. | Genuinely absent. Out of scope for a signage CMS at launch; flag as a §8 gap, not a costume. |

**Tally:** REAL = 4 (Square, Clover, Lightspeed, Shopify — all DIRECT with live `fetch`). COSTUME = 1 (Custom Webhook — built but CSRF-blocked in prod, the most damaging kind: an advertised, documented, no-credential path that 403s). NOT-BUILT = 5 (Toast, Stripe-Catalog, MINDBODY, Aloha, Stripe-Terminal — all honestly labeled; UI never shows a fake Connect button for the PARTNER/CLOSED set).

The "keystone" task #224 verified: the 3 tiers it flipped (Clover, Lightspeed, Shopify) are honestly DIRECT now — each has a real provider module wired through the registry, not a dropdown. Front-end is honest: PARTNER → no Connect button (`page.tsx:485-487`), CLOSED → info link only.

---

## Findings table

| # | Sev | Area | What | Repro | Evidence |
|---|---|---|---|---|---|
| **F1** | **P0** | Custom-webhook + Square webhook | Both inbound POS webhook endpoints are **403 CSRF-blocked in prod** before reaching the controller. External POS systems (Square's servers; any BYO custom system) send `X-Webhook-Secret` / `x-square-hmacsha256-signature` headers, NOT a browser cookie and NOT `Authorization: Bearer`, so they fail the CSRF middleware. The endpoints are built and correct — they're just never reached. Same class as the OTA / CTS-snapshot / sponsor-impression bugs the codebase already fixed by exempting those paths; the POS webhooks were missed. | `curl -X POST https://api-production-39a1.up.railway.app/api/v1/pos/webhook/custom-webhook -H 'X-Webhook-Secret: x' -d '{"menu":[]}'` → **HTTP 403 `{"code":"CsrfError"}`**. Same for `/webhook/square`. | CSRF exempt list `csrf.middleware.ts:17-125` (has `/billing/webhook` L89, sports `/feed` L98, `/cts-snapshot` L106, sponsor `/impression` L124 — **no `/pos/webhook/*`**); Bearer exemption `csrf.middleware.ts:199-202` doesn't apply (webhooks use custom headers). Controller is otherwise correct: `pos-oauth.controller.ts:271,418`. FE tells operator to POST there: `settings/pos/page.tsx:438`. |
| **F2** | **P1** | Workaround copy lies | The PARTNER-provider panel (Toast/Stripe/MINDBODY) tells operators: *"you can push your catalog through the **Custom Webhook** provider above — it works today."* It does NOT work today (F1). So every operator who hits a PARTNER provider is routed to a 403'ing dead end. Amplifies F1 from "one broken provider" to "the advertised escape hatch for 5 providers is broken." | Read the panel string. | `settings/pos/page.tsx:416`; broken target proven by F1. |
| **F3** | **P2** | Square auto-86 webhook latency claim | The Square inbound webhook's `inventory.count.updated` → instant auto-86 (`pos-oauth.controller.ts:354-365`, "sub-second latency") is unreachable in prod for the same CSRF reason (F1). Catalog still refreshes via the hourly cron + manual Sync, so 86'ing degrades from "sub-second" to "up to 1 hour" — functional but not as advertised. Sub-finding of F1; listed separately because it's a freshness/SLA regression, not a hard break. | Same curl as F1 (square webhook 403). | `pos-oauth.controller.ts:354-365`; cron fallback `pos-sync.cron.ts`. |
| **F4** | **P2** | Stripe Terminal (in-venue checkout) | §8 lists "Stripe Terminal (in-venue checkout, distinct from billing)" — genuinely NOT-BUILT. No reader/SDK code. Acceptable for a signage CMS at launch but should be on the honest "not built" list, not implied by the `stripe-terminal` provider id (which is actually the Catalog menu-source, also not built). The id is slightly misleading. | grep — no Terminal SDK. | absence; `pos.ts:218` id `stripe-terminal` is the Catalog source. |

No P0/P1 found in the per-location pricing engine, the OAuth/CSRF-state handling, or the four REAL provider modules — those are production-grade (see below).

---

## What works end-to-end (verified, so the report isn't all-negative)

**applyMenu / per-location pricing — REAL, traced end-to-end:**
- POS sync: `pos.service.ts:415-559` `syncConnection` → `connector.fetchCatalog` → upserts `PosMenuItem`/`PosCategory` → bridges into the menu-platform `MenuCatalog`/`MenuItem` (L551-559).
- Multi-location mapping: operator maps each synced `PosLocation` → a child location tenant (`pos.controller.ts:97-118`, `mapConnectionLocation`); the bridge writes per-location `MenuLocationOverride` rows only for mapped locations.
- Resolution rule: `menu.service.ts:121-240` `resolveMenuForLocation` — `price = override.priceCents ?? item.defaultPriceCents` (L212-213); daypart filter by location-local time (L178-190); 86 filter `available && !hidden` (L201-210).
- Device render: `screens.controller.ts:3706-3715` calls `resolveMenuForLocation(locationTenantId, {catalogTenantId})` and shapes it for `MenuBoardWidget` (name/description/priceCents/badges). Front-end has 31 `applyMenu()` menu boards (`public/templates/signage/{qsr,menus-pos,bar}`).
- Custom-webhook ingest logic (`menu.service.ingestCustomWebhookMenu`, `applyAutoEightySix`) is correct and idempotent — **the only thing wrong is the door is locked (F1).**

**Webhook security/correctness:** Square HMAC verify SHA256+SHA1 (`pos-oauth.controller.ts:301-320`); idempotency via `claimWebhookEvent` / `ProcessedPosEvent` (L336, L459); custom-webhook secret is constant-time matched and tenant resolved entirely server-side from the secret (L433-439). OAuth CSRF-state is Redis-first with single-use atomic GET+DEL (L591-643) + provider-mismatch defense (L218). This is genuinely good code.

---

## Coverage — what I could NOT reach + why

- **Could not complete a live OAuth round-trip** (Square/Clover/Lightspeed/Shopify): requires real provider `*_CLIENT_ID/SECRET` on prod that I can't supply, and `/pos/oauth/:provider/authorize` is JWT-gated (curl `/pos/providers` → 401 confirms auth gate). DEFERRED on credentials — code path read in full and is correct.
- **Could not POST a real custom-webhook catalog** end-to-end because F1 blocks it at the edge (that IS the finding). I verified the 403 is CSRF (not the controller's 401/404) by the response body `{"code":"CsrfError"}`.
- **Did not exercise the 31 front-end `applyMenu()` boards in a browser** (no Playwright/dev-server per read-only rule). Verified the data contract matches by reading the screens-controller shaping; visual render unverified.
- **Toast/Stripe/MINDBODY live APIs** not exercised — they're NOT-BUILT, nothing to reach.

---

## Grade per Greg's 3 lenses (§8 POS / commerce)

- **DESIGN — B+.** Provider picker is clean and *honest* (PARTNER → no fake Connect button, CLOSED → info link, DIRECT → real OAuth). The PARTNER "in development / email sales" panel is the right pattern. Only blemish: the workaround copy points at a broken endpoint (F2).
- **UX — B.** Self-serve OAuth for the 4 DIRECT providers is genuinely one-click *once creds are set*. Multi-location store→tenant mapping is a real, usable flow. Loses a grade because the headline "no more wrong burger prices" promise depends on either OAuth (needs deploy-time creds) or the Custom Webhook (broken in prod, F1) — a launch operator with a non-DIRECT POS has no working path today.
- **FUNCTIONALITY — C+.** Four REAL connectors with live `fetch` + a correct per-location pricing engine is a real C+-and-climbing, NOT a costume floor. But the single most reachable, credential-free path (Custom Webhook) 403s in prod (F1), and it's the documented fallback for 5 other providers (F2). One ~1-line exempt-list addition lifts this to B/B+. Until then, "pull-from-POS auto-86 in real time" is only true for Square-with-creds, and even that loses its webhook (F3).

**Bottom line for the lead:** the POS subsystem is mostly REAL and honestly tiered — the keystone work landed. The launch-blocker is a single missed CSRF exemption that bricks both inbound webhook paths in production. It is the exact bug-class the codebase has fixed five times already (OTA, CTS-snapshot, CTS-cue, sponsor-impression, feed) — the POS webhooks just never got added to `csrf.middleware.ts` EXEMPT_PATHS.
