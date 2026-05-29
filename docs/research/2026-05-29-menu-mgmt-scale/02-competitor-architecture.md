# Multi-Location Menu Management — External Landscape + Target Architecture
**Analyst pass, 2026-05-29, read-only. Companion to 01-codebase-reality.md (our code) — this = the external landscape + the architecture to adopt.**

## Executive summary
Every menu-board leader converges on the SAME 3-part architecture, and **VenueOS already has 2 of the 3**:
1. central menu/catalog (designed once) + 2. **per-location price & availability OVERRIDES** ("price book"/"location overrides") + 3. real-time invalidation driven by a **POS inventory webhook** for 86-ing + price changes.

**Biggest finding: nobody runs true sub-second WebSocket fan-out for menu boards.** Universal pattern = *POS webhook → middleware re-renders the affected location → screen picks it up via short poll / cache-bust* ("instant" in marketing = a few seconds in practice). That's *easier* than our emergency bus — our per-screen manifest + sports-style cached-endpoint already exceed it. **The gap is the DATA MODEL (no per-location override table, no availability/86 model, no daypart binding) + the design-once binding UX — NOT the push path.**

## Competitor matrix (who does the full workflow)
| Vendor | design-once | per-loc price book | realtime | auto-86 | 50-loc bulk | How |
|---|---|---|---|---|---|---|
| **Coates (Switchboard)** — McDonald's global CMS | ✅ | ✅ | ✅ | ✅ | ✅ | "controlled fields not redesigns," externally-managed menu+pricing data, dayparting, location customization. Gold standard, enterprise-only. |
| **Samsung VXT (DataLink)** | ✅ | ⚠️ | ⚠️ interval | ⚠️ | ✅ | DataLink server pulls external data on interval; bind each template field to a column; "thousands of boards, single template." Cleanest field-binding UX. |
| **OptiSigns (OptiSync)** | ✅ | ⚠️ | ⚠️ interval | ⚠️ | ✅ | no-code; connect Toast/Clover/Square/Sheet; Repeater turns rows→rows; placeholder auto-populate. Closest self-serve analog. |
| **Yodeck** | ✅ | ⚠️ DSMenu | ⚠️ | ⚠️ | ✅ Workspaces | DSMenu syncs products+prices across locations; Toast price sync is a FEATURE REQUEST (unverified). |
| **Mvix** | ✅ | ✅ mapped-to-location | ⚠️ | ✅ | ✅ | live DB pulls from a dozen+ POS, maps item details to specific locations/stations. |
| **Raydiant** | ✅ | ⚠️ | ✅ Toast/Square | ✅ | ✅ | "update price the second you change it in the register," auto out-of-stock + daypart auto-switch. Proprietary HW (their weakness; our edge). |
| **Spectrio** | ✅ | ✅ | ✅ | ✅ | ✅ | "all or only some restaurants receive updates" = inherit+selective override. |
| **Menuboard Manager** (Toast specialist) | ✅ | ✅ each loc←own Toast | ✅ "the moment it happens" | ✅ 86/68 | ✅ | purest self-serve example of the exact workflow; runs on Samsung/Sony/FireTV (no proprietary HW). |
| **Agilysys IG** | ✅ | ✅ overrides | ✅ | ✅ auto sold-out | ✅ | best plain-English "bulk for national consistency + location overrides where stores differ." |

**POS sources:** Square — `ItemVariationLocationOverrides.sold_out` (read-only bool, fires on inventory→0 OR manual mark) + `.price_money` per `location_id` + `present_at_location_ids`; webhook `catalog.version.updated` + `inventory.count.updated`; `sold_out` readable without `track_inventory`. Toast — 86 webhook auto-detects out-of-stock, per-restaurant menus, partner-gated, richest. Clover — stock→0 auto-flips availability, partner. Deliverect/Otter/Cuboh — stock/86 sync across POS + ALL delivery channels (snooze→all channels), partner registration (lighter gate).

## Target data model (all additive — live-pilot-safe)
- `MenuCatalog/MenuCategory/MenuItem` (central "design once," `externalId`=Square/Toast id, defaultPriceCents, allergens, tags).
- **`MenuLocationOverride { locationTenantId, menuItemId, priceCents?(null=inherit), isAvailable(=86 flag), soldOutUntil?, isHidden, source } @@unique([locationTenantId,menuItemId])`** ← the missing price-book piece.
- **Resolution rule:** price = override.priceCents ?? central.default; visible = !isHidden && isAvailable && soldOutUntil-not-future. = Agilysys "bulk + override where differ."
- `Daypart { daysOfWeek, timeStart, timeEnd, timezone }` — we own dayparting (Square has no daypart primitive); POS owns price+availability.
- Reuse `ProcessedPosEvent` (dedup), `PosProviderConnection` (creds), add `MenuSyncCursor` (Square `begin_time` delta).

## Sync + push architecture
`POS event → webhook controller (extend Square connector) → dedup → delta-pull → upsert MenuItem + MenuLocationOverride per location_id → invalidate location render cache → screens get it via the EXISTING per-screen manifest poll (+ optional MENU_UPDATED nudge)`.
**Reuse the manifest, NOT the emergency bus** (non-emergency dies at verifyWsHmac — proven in sports module). Backstop = menu-in-manifest (device-authed, survives WiFi). Snappier tier = copy sports `getBoard` cached-endpoint + 1-2s poll. Sub-second is NOT needed for menus.
**Auto-86:** POS webhook = trigger; `isAvailable=false` = state; renderer hides; `soldOutUntil` auto-restores (Square gives this free; Toast 68 = temporary).

## UX spec ("bind once, fill per location, override by exception")
- **Design-once:** MENU_BOARD/MenuItemRow exposes "Bind to catalog" → fields bind to placeholders `{{item.name/price/calories}}` by item-id or category+tag; price is a CONTROLLED bound field (changing price edits catalog/override, never the design); Repeater auto-generates rows so an 86'd item's row just disappears + reflows.
- **Per-location auto-fill:** one template → all 50 locations; `resolveMenuForLocation(locationId)` swaps prices/availability at render. Never 50 templates.
- **Price-book console:** grid rows=items × cols=locations(/groups), inherit-by-default (greyed central price; editing creates an override, flagged); bulk update ("set $4.99 across all/region"); region scoping via our `Tenant.parentId` hierarchy ("free"); one-click revert-to-inherited.
- **One-click 86** (manual, per-item per-location or all) + a phone "86 board" for a store manager. **POS-driven auto-86** = zero signage labor (cook marks it in Square → board hides it). Belt+suspenders periodic delta-pull catches missed webhooks.
- Onboarding (Concierge-aligned): connect POS → catalog auto-imports → pick template → bind once → assign to locations → done.

## Feasibility on our foundation
- **Days:** custom-webhook `{menu:[...]}` ingest + override model + daypart (additive, no partner gate, demoable — mirrors the doc-39 `{orders}` unlock); render via existing manifest; MENU_BOARD catalog binding (posSync precedent exists).
- **~1-2 wk:** Square catalog+inventory sync — we own the OAuth+webhook+idempotency connector; net-new = subscribe `catalog.version.updated`+`inventory.count.updated`, delta-pull, upsert overrides incl. `sold_out`. **Highest-leverage: per-location price + per-location 86 come FREE from Square natively.**
- **Weeks (no new infra):** the `MenuLocationOverride` price-book + resolution engine (the heart) + the bulk console UX + daypart engine.
- **Partner-gated:** Toast (richest + native delivery 86), Clover, Deliverect/Otter (all-channels).
- **Already have / don't build:** real-time transport (manifest + sports cached-endpoint exceed competitors' "instant"); multi-location org (tenant hierarchy); offline resilience (SW cache — most menu vendors lack this).

**One-line:** leaders all do *central catalog + per-location overrides + POS-webhook 86, rendered from one bound template per location.* We own the hard infra; missing piece = `MenuLocationOverride` model + bulk console + catalog-field binding = a **2-4 week data-model + UX build, not a new platform.** Build custom-webhook `{menu}` first (days), then Square auto-86 (per-location sold_out free), do NOT use the emergency bus.

## Unverified flags
Yodeck native Toast price sync (feature request, not shipped); Mvix/Menuboard Mgr/Raydiant exact sync mechanism (marketing "real-time"); OptiSync/DataLink refresh cadence (interval, unpublished); confirm Square OAuth scopes vs current API version; Deliverect 86 latency is multi-step (snooze→sync→publish); Coates internals inferred from press.

## Sources
Square ItemVariationLocationOverrides / sold-out monitoring / catalog webhooks · Clover inventory+webhooks · Deliverect menu-stock · Samsung DataLink · OptiSync + Toast-data · Coates (PRNewswire/QSR Mag) · Yodeck/Mvix/Raydiant/Spectrio/ScreenCloud/Menuboard Manager/Agilysys · Pickcel raw-vs-POS.
