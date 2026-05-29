# Pizza (multi-vendor) + DoorDash-type Delivery Order-Status — Feasibility + Plan

> Opus 4.8 read-only, 2026-05-29. POS module + sports module + vendor API docs verified.

## Bottom line
Opposite of Domino's: for independent/regional pizza on **Square (self-serve) or Toast (partner)**,
a real order-status feed IS buildable — and we already shipped the architecture in the **sports
module** (poll-a-cached-endpoint + HMAC feed token). Order status = "the score"; the make-line/driver
board = "the scoreboard." **You do NOT integrate DoorDash/UberEats/Grubhub directly** (NDA + must-be-a-POS
+ accept-order obligation) — you read delivery orders AFTER the merchant's POS (Toast natively ingests
all delivery channels; Square Orders API) or an aggregator (Deliverect/Otter/Chowly) consolidates them.

## Pizza-vendor POS feasibility
| POS | order-event API? | path | verdict |
|---|---|---|---|
| **Square** | ✅ `order.updated` + `order.fulfillment.updated` (⚠️ `order.created` does NOT fire for in-store POS-app orders → must also poll `SearchOrders`) | extend existing Square OAuth+webhook+idempotency: add ORDERS_READ scope + `order.*` cases + a SearchOrders poller | 🟢 buildable ~1wk, foundation exists, self-serve |
| **Toast** | ✅ richest — `order_updated` (full order on any change); natively ingests DoorDash/Grubhub/UberEats/Caviar as native orders | needs Toast Partner Program (commercial gate); code mirrors Square | 🟡 best data source, partner-gated |
| **Clover** | ✅ orders+webhooks | catalog connector doesn't exist yet (PARTNER) → 2 builds away | 🟡 lower priority |
| **Slice/SpotOn/Revel/PAR/HungerRush** | ⚠️ closed/partner/enterprise | none | 🔴 defer |
| **Custom-webhook (ours)** | ✅ live but catalog-only | teach it a `{orders:[...]}` shape | 🟢 pragmatic unlock, days |

## Delivery-service feed (the core ask) — brutally honest
| Service | direct signage API? | verdict |
|---|---|---|
| DoorDash Drive | ✅ webhooks BUT merchant's-own-courier only, per-merchant creds | 🟡 niche |
| DoorDash/UberEats/Grubhub **Marketplace** | ✅ exist BUT 🔴 must BE a certified order-mgmt POS (NDA, `eats.pos_provisioning` scope, accept-order obligation, multi-month) | 🔴 **aspirational — do NOT promise** |
| **Aggregators (Deliverect/Otter/Chowly/Cuboh)** | ✅ order + order-status-update webhooks unifying ALL delivery channels; Deliverect docs literally mention "signage and status updates … couriers receive orders" | 🟢/🟡 **the realistic all-channels path** (partner registration, lighter gate) |
| **Merchant POS already consolidates** (Toast/Square) | ✅ read delivery orders from the POS feed you already built | 🟢 **best — delivery status free with the POS feed** |

**Truth:** no signage vendor subscribes to DoorDash/UberEats/Grubhub directly; read them after the merchant POS/aggregator consolidates — exactly the "POS feeds the template" intuition.

## Architecture — copy the sports module (proven in prod)
- **DO NOT use the emergency pub/sub bus** — code comment (sports Audit-Fix 2) confirms non-emergency messages "land on the bus and DIE" (only emergency scope is verifyWsHmac'd). Sports switched to **poll-a-cached-endpoint**.
- Pattern: ingress (Square webhook+poll / Toast / custom-webhook `{orders}`) → `ProcessedPosEvent` idempotency (exists) → **PosOrder** table (new, additive) → public HMAC-token-scoped cached read `GET /pos/orders/board/:token` (copy `getBoard` 1s cache) → `OrderBoardProvider` (copy `GameStateProvider`, poll 1-2s) → widgets.
- Buildable: custom-webhook `{orders}` + widgets = days; Square order feed ~1wk; Toast/Deliverect after partner enrollment. Direct delivery-co + live driver GPS + Domino's consumer tracker = aspirational/costume (don't promise).

## New widgets + templates
- **RESTAURANT_ORDER_STATUS** (make-line/pickup: PREPARING|READY columns — `03-order-ready.html` made real) + **RESTAURANT_DELIVERY_DISPATCH** (driver board: "#1234 · DoorDash · READY · rack B" so a driver self-serves; channel logo per row). Both follow the existing `({config,live})` contract + posSync precedent (`PropertiesPanel.tsx:~4079`). Reskin off cream default via brand shim.
- Schema (additive, live-pilot-safe): `PosOrder {tenantId, connectionId, externalId, channel, state, orderNumber, customerLabel?, itemCount?, shelfLabel?, …} @@unique([connectionId,externalId])`. Reuse ProcessedPosEvent + PosProviderConnection.
- Templates: 1 make-line board, 2 driver/delivery board (the differentiator), 3 customer status, 4 menu (reuse), 5 deals (reuse), 6 allergen/hours (reuse).
- Guardrails: tenant from connection not client; AuditLog every config; order PII (customer name) default to order-number-only on public boards; Chromium-83-safe widgets.

## Decisions needed from Greg
1. **Build order first?** Rec: (a) custom-webhook `{orders}` + the 2 widgets (days, real demo, no gate), then (b) Square (self-serve ~1wk). Defer Toast/Deliverect to a pilot.
2. **Confirm we scope OUT direct DoorDash/UberEats/Grubhub** (reach delivery only via merchant POS/aggregator — the no-costume line).
3. **Greenlight a partner application?** (Toast Partner Program or Deliverect/Otter for the consolidated all-channels board — want a one-pager?)
4. **Target pilot vendor + POS + reference images.**
5. **Customer-name display policy** on public boards (order-number-only default vs first-name+initial).
