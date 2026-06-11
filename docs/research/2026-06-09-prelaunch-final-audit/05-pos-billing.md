# Prelaunch Final Audit — §8 POS/Commerce + §11 Billing

Auditor: frontier deep-pass (Fable 5). Date: 2026-06-09/10. Scope: Standard Audit Surface §8 (POS/commerce integrations) and §11 (Billing+commerce). Method: traced sync/OAuth/webhook code to real provider API hosts, read the seat-enforcement transaction, probed live endpoints on https://venue-os.app, queried prod DB read-only. Deduped against `2026-06-09-full-audit/REPORT.md` and `2026-06-08-launch-readiness-audit/00-MASTER-SYNTHESIS.md`.

## Coverage + lens grades

| § | Domain | Coverage | DESIGN | UX | FUNCTIONALITY |
|---|---|---|---|---|---|
| 8 | POS / commerce | **covered** | B+ | B+ | **B+** — Square/Clover/Lightspeed/Shopify connectors REAL; tiers honest; custom-webhook real; one freshness gap (no prune) |
| 11 | Billing + commerce | **covered** | A− | A− | **A−** — webhook idempotency/out-of-order/audit real; seat enforcement SERIALIZABLE+retry real; PCI clean; dunning + status-reconcile gaps |

---

## §8 POS — what's REAL (verified)

**Connectors hit real provider hosts** (`apps/api/src/pos/providers/`):
- **square.ts** — `connect.squareup.com` / `connect.squareupsandbox.com`, `/oauth2/token`, `/v2/locations`, Catalog API. Real HMAC webhook verify (`verifySquareSignature`, SHA256 + legacy). `square.ts:42-43,93,212,298`.
- **clover.ts** — `api.clover.com` / `apisandbox.dev.clover.com`, `/oauth/v2/token`, `/oauth/v2/refresh`, paginated catalog. `clover.ts:48,104,135,183`.
- **lightspeed.ts** — `{prefix}.retail.lightspeed.app/api/1.0/token` + `/api/2.0/products` with cursor pagination. `lightspeed.ts:66,87,170,266`.
- **shopify.ts** — `{shop}.myshopify.com/admin/oauth/access_token` + `/admin/api/{v}/products.json?limit=250`, Link-header pagination. `shopify.ts:113,142,248,253`.

**Registry keystone** (`providers/registry.ts`) — uniform `authorizeUrl→exchangeCode→refreshAccessToken→fetchCatalog` per provider, keyed by the @cms/api-types provider id. Adding a provider = one module + one entry. Clean.

**Tier honesty — verified honest** (`packages/api-types/src/pos.ts`):
- DIRECT (real, self-serve, has connector): `square`, `clover`, `lightspeed-retail`, `shopify-pos`, `custom-webhook`.
- PARTNER (gated, not live): `toast`, `stripe-terminal`, `mindbody` — **rejected at the API boundary**, `pos.service.ts:99-102` throws BadRequest ("isn't live yet"). No ready-but-silent-no-sync costume.
- CLOSED (no public API): `aloha-ncr` — `tierReason` explains CSV-import fallback; connect blocked `pos.service.ts:87`.
- Resolves the 2026-06-09 REPORT.md "~3 wired vs ~30 clickable" flag for POS. NOTE: 2026-06-08 synthesis listing Toast/Clover/Lightspeed/Shopify as "honest N-A" is now STALE — Clover/Lightspeed/Shopify are DIRECT with real connectors (commit `POS connector keystone`, task #224). **Verify-fixed.**

**Per-location pricing — REAL** (`menu.service.ts resolveMenuForLocation` + `ingestPosCatalog:552-558,597-599`): default price on MenuItem + per-location `MenuLocationOverride` (price+availability+86); POS bridges overrides ONLY for operator-mapped PosLocations. Prod DB: 8 menu_items, 6 location overrides.

**Auto-86 + menu-board pull — REAL** (`screens.controller.ts:3605` `GET :id/menu`, device-authed): resolves effective location tenant (POS-mapping wins, else screen tenant) + catalog-owning chain (parentId), `resolveMenuForLocation`. `?includeUnavailable=1` returns 86'd items as `available:false` so boards grey them (`:3616-3651`). Player polls device-authed feed; editor uses `/pos/items` (`use-pos-menu-items.ts:38-42`). Boards render via baked `applyMenu()` (`WidgetRenderer.tsx:2847`).

**custom-webhook — REAL** (`pos-oauth.controller.ts:418`): `POST /pos/webhook/custom-webhook` + `x-webhook-secret`, constant-time match across decrypted creds (`pos.service.ts:666`), per-eventId dedup, normalized ingest. Unknown providerId → 404 (`:425`). Resolves task #170.

**OAuth CSRF state — REAL** (`pos-oauth.controller.ts:165,205-211`): nonce persisted (Redis + in-mem fallback), verified on callback, 10-min TTL.

**Creds encrypted at rest** — envelope encryption (sealCredentials/openCredentials). Disconnect audit-logged in tx (`pos.service.ts:152`).

---

## §11 Billing — what's REAL (verified)

**Webhook idempotency** (`stripe.service.ts:335-347`): INSERT-first dedup on `processed_stripe_events` PK (`schema.prisma:565`); P2002 → 200 no-op; atomic at DB.
**Out-of-order protection** (`:481-491,577-587,656-666`): every License-mutating handler compares `event.created` vs `stripeLastEventCreatedAt`, skips stale.
**Audit row on EVERY mutation** (`:524,597,676`): `tx.auditLog.create` in the SAME `$transaction` as the upsert/update; `STRIPE_WEBHOOK_*`, from/to status+tier. Resolves task #71. Tenant fallback by `stripeCustomerId` (`:429-441`) closes the Portal stale-License hole.
**Seat enforcement** (`screens.controller.ts:1180-1213`): seat check + screen claim in one `Serializable` `$transaction` wrapped in `withDbRetry` (P2034 → re-run; 402 LICENSE_EXHAUSTED re-thrown immediately). `assertSeatAvailable` (`license.service.ts:99`) enforces status, expiry, and used≥limit, each a structured 402. Resolves tasks #10/#184.
**Quantity sync** (`stripe.service.ts:164-206`): fire-and-forget after pair/unpair/delete (`screens.controller.ts:1241,1243,1346,2391`, `billing.controller.ts:113`), prorates, idempotent, skips INVOICE/PO/cancelled. Daily reconcile cron with `LICENSE_RECONCILED` audit row as multi-replica dedup guard.
**PCI — CLEAN**: grep `card_number|cvv|cvc|last4|exp_month|pan` across api+web = ZERO card-data handling. 100% Stripe-hosted Checkout/Portal (SAQ-A). No PAN in logs.
**Graceful degradation** (`stripe.service.ts:111`, `billing.controller.ts:63,92,108`): `enabled()` gates on STRIPE_SECRET_KEY; unset → checkout/portal `{enabled:false}`, invoices `[]`. Prod License: 1 row PILOT/COMP/ACTIVE, no stripe ids — live pilot unaffected.
**Webhook hardening** (`billing-webhook.controller.ts`, `csrf.middleware.ts:89`): rawBody:true, sig-verified, CSRF-exempt with sound justification. Live: `POST /billing/webhook` → 400 (missing sig, non-retryable); `/billing/status` unauthed → 401.

---

## NEW findings

### P2 — POS sync is upsert-only; items deleted at the POS render forever
`pos.service.ts:513-537` (PosMenuItem) and `menu.service.ts ingestPosCatalog` (MenuItem) UPSERT every snapshot item but NEVER prune items absent from the snapshot. grep `deleteMany|notIn|tombstone|stale` in both = only an unrelated connection-delete (`:153`). An item the operator DELETES at Square/Clover (not just marks unavailable) stays `available:true` and keeps rendering on the board indefinitely — a real freshness hole for "POS drives the board." (Marking unavailable at POS IS handled via `item.available`; only hard delete leaks.) Fix: after a full-catalog sync, hide rows whose externalId wasn't in the snapshot (full syncs only, never on a partial webhook delta).

### P2 — Dunning is silent: PAST_DUE set with zero customer notification
`stripe.service.ts:634` flips License→PAST_DUE on `invoice.payment_failed` + writes audit, but grep for any email/SMS/notification on PAST_DUE/payment_failed = NOTHING. The customer is never told their card failed unless they open Settings→Billing (which shows a badge, `billing/page.tsx:306`). Churn/involuntary-cancel risk for a paid SaaS. Fix: send a "payment failed — update card" email + global dashboard banner on PAST_DUE. (Enabling Stripe's own dunning emails in the dashboard is a config-level stopgap.)

### P2 — Reconcile cron fixes quantity drift but NOT status drift
`license-reconcile.cron.ts:131-138` selects `status != CANCELLED` and only calls `syncSubscriptionQuantity` (quantity only). If a `customer.subscription.deleted`/`.updated`→canceled webhook is ever MISSED (the silent-failure class the cron exists to catch), the License stays ACTIVE forever — the cron never re-reads `sub.status`. The most reconcile-worthy case (dead subscription, dropped terminal webhook) is the one the safety net misses. Fix: in the daily pass also `subscriptions.retrieve` + re-map status when it differs (timestamp-guarded), not just quantity.

### P3 — `processed_stripe_events` ledger never pruned
INSERT-only (`stripe.service.ts:336`), no retention job → unbounded growth. Prod count 0 (Stripe off), latent. Fix: periodic `deleteMany` of rows >90d (Stripe stops retrying after ~3d).

### P3 — Per-item sequential awaits in sync loop
`pos.service.ts:499-537` awaits each upsert serially; at 50 locations × hundreds of items this is slow (off the request path, fail-soft). Fix: chunked `$transaction([...])`. Correctness fine.

---

## KNOWN-OPEN (verified still open; confirming, not re-reporting)

- **KNOWN-OPEN: PILOT_SEAT_LIMIT = 1000** — `license.service.ts:33` still `static readonly PILOT_SEAT_LIMIT = 1000`. Greg-task (2026-06-08 P1-2). Prod tenant is COMP/100000 so moot for it, but a NEW signup with no License row gets 1000 free seats. Flip before first paying customer.
- **KNOWN-OPEN: Stripe TEST-mode keys live** — code-readiness audited only (per assignment). CODE is launch-ready. Greg-task: go-live test-card pass + swap keys/prices/webhook secret (2026-06-08 B-3).
- **Stale doc header** — `license.service.ts:7-8` docblock says "Pilot tier... 3 seats" while constant is 1000 (`:33`). Cosmetic/misleading; fix when flipping the limit (matches 2026-06-08 synthesis note).

## N-A (honest, not faked)
- Trial lifecycle: `POST /billing/activate-trial` (`billing.controller.ts:142`) is a deliberate read-only no-op (`committed:false`) — free tier is the default no-License state. A real trial-to-paid Setup-Intent flow is genuinely not built (documented `:138-141`). Not a costume.
- Refunds/comp seats: SUPER_ADMIN path via `super-license.controller.ts` exists; not deep-audited (out of focus, no live data).
