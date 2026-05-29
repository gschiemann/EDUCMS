# Menu-Management-at-Scale — Codebase Reality Audit
**BYO template → POS-per-location pricing → real-time Pi → auto-86 → 50-location mgmt**
**Opus 4.8, read-only, 2026-05-29. Companion: `docs/research/2026-05-28-opus48-audit/39-pizza-delivery-orderstatus-research.md` (order-status angle). This = the orthogonal MENU-PRICING angle. Documented POS scope (`api-types/src/pos.ts:19-23`) = "catalog only, not orders, not inventory."**

## Bottom line
The connect-wizard surface looks impressive (Square OAuth + webhook + idempotency + audit are REAL), but the customer's exact workflow is **broken at 3 of its 5 joints, two of them silent COSTUME**:
- BYO template **cannot bind a price field to a POS item** — posSync works only on 5 pre-built widget types, by CATEGORY, never field-level, never on `EXTERNAL_HTML` (the BYO path).
- **Per-location pricing does not exist** — price is one global scalar per item per tenant; `locationId` + `locationMap` are written-never/read-never dead code.
- **The Pi never shows live POS prices** — `MenuBoardWidget` fetches `/pos/items` with a USER-session token the player doesn't have; endpoint is RBAC-admin-locked; device token has no role → 403 → falls back to hardcoded `DEMO_ITEMS` every time. POS data never rides the manifest either.
- **Auto-86 is half-real** — DB filters `available:true` (so an 86'd item WOULD drop) but **nothing ever sets `available:false` from stock**; Square Inventory API never read despite `INVENTORY_READ` scope.
- **50-location UX does not exist** — no price-book, no per-location override, no bulk/inherit; one POS connection per tenant.

## 5-capability reality table
| # | Capability | Grade | Evidence |
|---|---|---|---|
| 1 | BYO template → bind field to live POS item | **COSTUME/PARTIAL** | posSync toggle only for RESTAURANT_MENU_BOARD/BAR_TAP_LIST/cocktails/RETAIL_PRODUCT_GRID (`PropertiesPanel.tsx:4079-4234`), binds by CATEGORY not item (`PosCategoryPickerField`). `EXTERNAL_HTML` (BYO) has NO posSync — only static `textOverrides` (`WidgetRenderer.tsx:2708-2761`). RETAIL_PRICE_CALLOUT = 100% manual. |
| 2 | POS fills pricing PER LOCATION | **MISSING (costume field)** | `PosMenuItem.priceCents` one scalar (`schema.prisma:1621`); `locationId` (:1628) never written; `locationMap` (:1597) zero readers; Square poll fetches `/v2/catalog/list` with no `location_ids`, never reads `location_overrides` (`square.ts:185-265`). |
| 3 | Price change → REAL-TIME to Pi | **COSTUME (broken on player)** | `MenuBoardWidget.tsx:282-302` calls `apiFetch('/pos/items')` w/ user-session token; player only has device token; `/pos/items` is JwtAuth+Rbac+RequireRoles (`pos.controller.ts:71-72`); device token no role → 403 → `DEMO_ITEMS` (`MenuBoardWidget.tsx:64-74,298`). Manifest carries no menu items. Fetch is one-shot on mount — no poll/WS even on dashboard. |
| 4 | Out-of-stock → AUTO-86 | **PARTIAL (filter real, trigger missing)** | `listMenuItems` filters `available=true` (`pos.service.ts:184`) ✓ but `available` only set from `!is_deleted` (`square.ts:237`); `inventory.*` webhooks only trigger catalog re-sync (no stock); `INVENTORY_READ` scope unused; no stockCount field anywhere. |
| 5 | 50-location mgmt UX | **MISSING** | one connection/tenant (`@@unique([tenantId,providerId])`); all endpoints single-tenant from `req.user.tenantId`; no price-book/override/bulk/inherit; `Tenant.parentId` hierarchy not traversed by POS. |

## Gap list (dependency order)
**Tier 0 — get POS data to the Pi AT ALL (nothing matters until this is true):**
1. Device-authed catalog read: new `GET /screens/:id/menu` (or fold into `/screens/:id/manifest`) accepting a DEVICE token (jwt-auth.guard already supports `kind:'device'`); resolve tenant + screen location. **Single highest-leverage fix.**
2. Player-side delivery: either menu-in-manifest (rides offline-cache + manifest-poll, survives WiFi loss, Sprint-7 aligned) OR a poll-a-cached-endpoint provider (the sports-module pattern). **Do NOT use the emergency pub/sub — non-emergency dies at verifyWsHmac.**
3. Fix `MenuBoardWidget` to read the device endpoint + live re-render (currently one-shot useEffect).

**Tier 1 — per-location pricing:**
4. New `PosMenuItemPrice` price-book: `{menuItemId, locationId, priceCents, salePriceCents?, available} @@unique([menuItemId,locationId])` (additive). Base price on PosMenuItem, per-location overrides.
5. First-class `PosLocation` table (today only a DTO); activate `locationMap`/`Screen.locationId`.
6. Square per-location read: pass `location_ids`, parse `item_variation_data.location_overrides[].price_money` + `present_at_location_ids`.
7. Scope read by location: screen → location → price-book row.

**Tier 2 — auto-86 from real stock:**
8. Read Square Inventory on `inventory.count.updated` webhooks (already received) → set `available` from `quantity<=threshold`. `INVENTORY_READ` already requested. Hide-filter already works; only the SIGNAL is missing.
9. Custom-webhook stock shape: already accepts `available:false` (`pos.service.ts:662`) — document `{items:[{externalId,available:false}]}` 86-push.

**Tier 3 — BYO field binding:**
10. Field-level binding token like `{{pos.item:<externalId>.price}}` resolved server-side per-location at manifest/poll build; reuse the `textOverrides`→`?text=` shim transport (`WidgetRenderer.tsx:2731-2761`) — swap static for resolved live value.
11. Per-ITEM picker UI (not just per-category); extend posSync beyond the 5 hardcoded widgets to RETAIL_PRICE_CALLOUT + BYO EXTERNAL_HTML fields.

**Tier 4 — 50-location UX:**
12. Multi-location console: per-location price grid, base+override, bulk edit, district→school inherit via `Tenant.parentId`.

## Architecture: reuse vs net-new
- **Reuse (already real + solid):** Square OAuth+refresh+webhook+HMAC+`ProcessedPosEvent` idempotency+AuditLog; the manifest+offline-cache transport (Sprint-7, device-authed, survives WiFi); the `EXTERNAL_HTML` `textOverrides`→`?text=` base64url shim + DOMParser `[data-field]` discovery (perfect for live values); `Tenant.parentId` hierarchy; the `available:true` filter.
- **Net-new:** per-location price-book model; device-authed read path to the Pi; Square Inventory signal for auto-86; the binding-token resolver + per-item picker; the cross-location price console.
- **Fastest demo path:** Tier 0 (any live price on a real Pi) → then custom-webhook `{items:[{externalId,priceCents,available}]}` push (already ingestible, `pos.service.ts:560-621`) as the per-location feed before building the full Square per-location parser.

## COSTUME flags (implies it works; backend doesn't)
1. `PosProviderConnection.locationMap` — zero readers. 2. `PosMenuItem.locationId` — never written; query param can only match null. 3. `PosLocation` DTO + `locationCount` hardcoded 0 ("populated when locationsSync runs" — never implemented; every provider advertises `locationsSync:true`, none deliver). 4. **`MenuBoardWidget` posSync on a real kiosk — demos perfectly in admin preview (session token), silently shows DEMO_ITEMS on every actual player (device token→403). Most dangerous: looks right on the laptop, dead on the wall — the exact CLAUDE.md §9 "verify on the Pi" failure mode.** 5. `INVENTORY_READ` scope requested, never used.
**Honest (not costume), for contrast:** Toast/Clover/Lightspeed/Shopify/Stripe were de-costumed 2026-05-28 (hard-reject connect with honest "not live yet"); Square + custom-webhook are the only genuinely-live catalog connectors and their catalog sync (sans location/inventory) is real.
