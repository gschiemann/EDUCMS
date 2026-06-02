# 50-location / 150-screen scale + POS-driven per-location pricing (2026-06-02)

Read-only Explore-agent investigation. Scenario assessed: *"50 locations, 150+
screens. See them all on a map. Pick a template once; its data (price, specials,
inventory/86, market content) updates per location/market automatically. POS
drives pricing but it varies by location — one global mapping won't work. POS
systems expose location/market hierarchy (Square Locations, Shopify Locations,
Lightspeed Outlets, Clover per-merchant); map POS-location → our-location."*

## Verdict table

| Requirement | Status | Notes |
|---|---|---|
| (a) 150 screens / 50 locations on a map (clustered, performant) | **WORKS** | Leaflet markercluster; 50 bubbles → 150 pins at zoom 14+ |
| (b) Location modeled first-class | **WORKS** | child Tenant + `PosLocation` + `Screen.posLocationId` |
| (c) Per-location price/86 override exists | **WORKS** | `MenuLocationOverride` + `resolveMenuForLocation` |
| (d) **POS multi-location pricing captured** | **MISSING** | no sync of Square/Shopify/Lightspeed locations or per-location price |
| (e) POS-location → our-location mapping | **PARTIAL** | FK exists; `locationMap` JSON declared but **unused**; no assignment UI |
| (f) One template auto-varies data by location | **WORKS** | `/screens/:id/menu` resolves per that screen's location |
| (g) Market/region rollup | **MISSING** | only 2-level chain→location hierarchy |

## 1. Fleet map at scale — WORKS

`apps/web/src/components/screens/ScreenMap.tsx:1-720`. Leaflet.markercluster
(`:310-345`, maxClusterRadius 60, spiderfyOnMaxZoom), cluster color by worst
status (`:315`), every screen has lat/lng (`schema.prisma:668-669`), tenant
lat/lng geocode fallback (`:140-142`, ScreenMap `:374/439/668`), fit-all
(`:226-259`), command-center stats strip (`:499-504`), live search/filter
(`:461-474`), colocated-screen "store" rollup by normalized address (`:90-169`),
44px touch targets (`:670-680`). Holds at 150 screens / 50 location bubbles.

## 2. Model — WORKS (naming aside)

`Tenant.parentId` 2-level hierarchy (`schema.prisma:14`, children `:55`):
chain (parentId null) → location (child). `Screen.tenantId` + optional
`Screen.screenGroupId`. **New (2026-05-29):** `Screen.posLocationId` →
`PosLocation` FK (`:684-685`). `PosLocation` (`:1878-1899`): externalId,
`locationTenantId?`, name, address, isActive, `screens` reverse (`:893`).
```
Chain (parentId null)
├─ Location 1 (child)  └─ Screen 1-3
├─ Location 2 (child)  └─ Screen 4-6
└─ … Location 50       └─ Screen 147-150
PosConnection
├─ PosLocation 1 (externalId Square_loc_ABC → locationTenantId loc1)
└─ … PosLocation 50
```

## 3. Per-location override — WORKS

`MenuLocationOverride` (`schema.prisma:1851-1871`): `priceCents?` (null =
inherit `MenuItem.defaultPriceCents`), `isAvailable` (86), `soldOutUntil?`,
`isHidden`, `source`. Resolution `menu.service.ts:120-239`:
`priceOverridden = ov?.priceCents != null; priceCents = priceOverridden ?
ov.priceCents : item.defaultPriceCents` (`:211-212`); availability/86 (`:207-209`).
Design-once + vary-by-location is real.

## 4. POS multi-location capture — MISSING (the crux)

`PosLocation` model + `Screen.posLocationId` + `PosMenuItem.locationId?`
(`:1666`) + `PosProviderConnection.locationMap` JSON (`:1630-1632`,
`{ 'screenId': 'externalLocationId' }`) all **exist in schema** — but:
- **No code fetches Square `/v2/locations`** (or Shopify Locations / Lightspeed
  Outlets) and upserts `PosLocation` rows. `square.ts` shows OAuth + token only.
- `locationMap` is declared but **never populated or read**.
- Catalog sync pulls **one flat catalog per connection** — `PosMenuItem.locationId`
  is never set per-location; no per-location pricing/inventory is captured.
- No screen→POS-location assignment UI/API.

So per-location pricing today must be entered **manually** as
`MenuLocationOverride` rows — the POS does not drive it.

## 5. Template data per location — WORKS

`screens.controller.ts:3519-3598` `GET /screens/:id/menu`: resolves
`locationTenantId = screen.posLocation?.locationTenantId || screen.tenantId`,
`catalogTenantId = screen.tenant?.parentId || locationTenantId`, then
`menu.resolveMenuForLocation(locationTenantId, { catalogTenantId, … })`. One
template, many locations, data auto-varies — the resolution path is wired; it's
the POS-side feed (§4) that's empty.

## 6. Market/region — MISSING

Only chain→location (2 levels). `ScreenGroup` (`:606-617`) is for bulk
scheduling, not market rollup. No region field; "all Texas stores get X" needs
per-store override rows today.

## Prioritized gap list

**P0 (blocking auto per-location pricing)**
1. **POS Locations sync** — fetch each provider's locations (Square `/v2/locations`,
   Shopify Locations, Lightspeed Outlets; Clover = per-merchant) → upsert
   `PosLocation` (name, address, timezone).
2. **Per-location inventory/86 trigger** — Square `inventory.count.updated`
   carries location_id; route auto-86 with location context (logic exists, needs wiring).
3. **Screen → POS-location assignment UI** — set `Screen.posLocationId`
   (show PosLocation name/address) + populate `PosProviderConnection.locationMap`.

**P1**
4. Per-location item sync (populate `PosMenuItem.locationId`; a location shows
   only what it stocks + its price).
5. Use `locationMap` in sync to reject orphaned POS-location data.
6. Operator dashboard CRUD for `MenuLocationOverride` (today mostly webhook-ingested).

**P2**
7. Market/region tenant tier (3-level chain→region→location) for regional price rules.
8. Per-location custom-webhook routing by location id.
9. CSV bulk price-override import (location_name, item_name, price_cents).

## Executive summary

Map ✅, per-location template architecture ✅, but the **POS layer captures the
connection + base catalog only — not the location hierarchy or location-level
price/inventory.** A 50-store Square chain can launch today with **manual** per-
location price entry; to make the POS drive it, P0 #1-3 must ship (~2-3 eng-weeks
for Square; repeat per provider).
