# How leading signage CMSs model multi-location — competitor research (2026-06-02)

Web research (general-purpose agent, sources cited inline). Triggered by the
operator's question: *"look at what all the other large CMS apps do for [multi-
location] and see how we can make ours even more user friendly — we don't want
to charge professional services for anything because this will be so easy."*
Plus the operator's hunch: *"maybe we add location at the group level and use
groups as the store locations."*

## Comparison table

| Platform | "Location" term + model | Hierarchy | Screen → location | Per-location content | Per-location PRICING | Self-serve? | Map |
|---|---|---|---|---|---|---|---|
| **Yodeck** | **Workspace** (self-contained area) | Org → Workspace → sub-Workspace → Screen | registered into a Workspace; + tags | per-Workspace libs, cross-ref allowed | data-feed driven; no native price-book | DIY; CSV import; tags + bulk | **Yes — map** + tag filter |
| **OptiSigns** | **Folders + Tags** (Region→State→City→Store); Sub-Accounts only past ~50 | folders nest; Teams overlay | placed in folder and/or tagged | per-folder/team; push by tag | via POS apps (Square/Toast/Clover) | **Strongly DIY**; Mass Provisioning CSV | **Yes — Map View** (lat/lng) |
| **ScreenCloud** | **Space** (flat — no nesting) | Org → Space → Screen | assigned to a Space; groups within | isolated per Space; shareable | data-integration driven | DIY "New Space" | list/grid, less geo |
| **Rise Vision** | **Sub-Company** (full child org) | Org → Sub-Company → Display | isolated per Sub-Company | fully separated; parent pushes down | n/a (EDU/enterprise) | DIY but **heavy** to set up 50 | org-tree |
| **NoviSign** | screen **groups** | Org → Group → Screen | grouped | menus/prices from POS | **Yes — POS sync** | DIY ($) | — |
| **Raydiant/Displai** | **"Locations"** + rules engine | Org → Location → Screen | grouped by location | per-site rules | **Yes — Square + Toast real-time price/availability** | DIY dash, enterprise tier | multi-site dash |
| **Spectrio** | **Location** (franchise) | Org → Location → Screen | per-location displays | central + local | **Yes — Clover; CSV product lib** | mixed (services common) | — |
| **Mvix** | screen **groups** + per-device data filters | Org → Group → Screen | publish to groups; filter per device | **one feed, filtered per device** | **Yes via Square/Toast** | DIY + paid Implementation | — |
| **Navori QL** | **device tags / per-player variables** | Org → tags → Player | device tags + variables | **one template, per-player data (gold standard)** | per-player variables / feeds | integrator-leaning | enterprise |
| **Skykit** | **tenant** = a location's device group | Org → Tenant(location) → Group → Screen | belongs to a tenant | corp push + local; dayparting | n/a | DIY 10→10k screens | single dash group-by-location |
| **AppSpace** | **Location** (first-class; nests) | Org → Location → Device | assigned to a Location; **props inherit to devices** | targeted per Location; **inheritance** | n/a (workplace) | DIY enterprise | **maps + floor-plans per Location** |
| **WAND Digital** | Location (QSR specialist) | Brand → Location → Screen | cloud CMS | dayparting; 1,500 templates | **Yes — deep POS price updates** | **pro-services / managed** | enterprise |
| **Coates (Switchboard)** | Location (QSR, McDonald's-scale) | Brand → Location → Screen | real-time data | analytics-driven | enterprise QSR | **pro-services / managed** | enterprise |

## The three camps (by how heavy a "location" is)

- **Camp A — sub-account / child-org** (Rise Vision Sub-Company, Skykit tenant, OptiSigns Teams past 50, Yodeck Workspace). Hard isolation, each location a setup project. **OptiSigns itself reserves this for 50+** and warns it's heavier. **This is the tier that charges onboarding.**
- **Camp B — folder / group / tag in ONE account** (OptiSigns folders+tags [their documented default], ScreenCloud Spaces, NoviSign/Mvix/Skykit groups). Lightweight, most self-serve, but flat-group collides with multi-group-per-store (ScreenCloud users fall back to "groups *within* a Space" — two tiers).
- **Camp C — first-class Location/Site with data resolved per location** (AppSpace Location + property inheritance, Navori per-player variables). The location is a real object (geo/address), screens belong to it, **config + data cascade down**. Most capable.

## The dominant pattern for "design once, vary per store"

Every advanced platform uses **device-tag / per-location-variable resolution of ONE shared template** — Navori: *"a unique template sent to many players where each loads data according to its assigned variables… no longer necessary to duplicate templates."* **None make operators duplicate the template per store.** That is the explicit thing they advertise against.

## Per-location PRICING is delegated to the POS (not a CMS price-book)

- **Square** → `ItemVariationLocationOverrides` (per-location price on each variation) + Locations API.
- **Toast** → **Multi-Location Management "Location-Specific Pricing."**
- **Shopify** → per-`Location` `InventoryLevel` (stock/86; price at variant level).

Winning play: **VenueOS holds the template + the location list; the POS holds per-location prices; VenueOS resolves "this screen's location → that location's POS price" at render.** (Raydiant, Spectrio, NoviSign, Mvix all do exactly this.)

## Terminology: call it **"Location"**

Plurality winner + vertical-neutral (AppSpace, Raydiant, OptiSigns, Skykit, Spectrio all say "location"). "Store" is too retail; "Site"/"Workspace"/"Space"/"Sub-Company" leak the data model. Entity = `Location`; **display label per vertical** via the existing `DistrictSchoolsCard` COPY map (Store / Restaurant / Gym / Office / Parish / School).

## Recommendation for VenueOS — Option C ✅

| Option | Model | Verdict |
|---|---|---|
| **A** | location = child **Tenant** (`parentId`) — *what we shipped the per-location engine on* | ❌ 50 tenants = 50 setup projects; fights "design once"; the model competitors charge onboarding for. Keep ONLY for genuinely separate brands/franchisee entities. |
| **B** | location = **ScreenGroup** (operator's hunch) | ⚠️ lightweight but ScreenGroup = "cluster *within* a site"; collides when a store has drive-thru + lobby groups; **no address/lat-lng → nothing for the map**; nowhere clean to hang the POS-location binding. Forces you to grow a Location entity anyway. |
| **C** | location = **new first-class `Location`** (name + address + lat/lng + `posLocationId` + per-location overrides); `Screen.locationId`; ScreenGroup stays the within-location sub-tier | ✅ **Hits every requirement.** Design-once template + per-location data resolution (Navori/AppSpace); `Location.posLocationId` ↔ Square/Toast/Shopify location for native per-store pricing; lat/lng → map clusters 150 screens under 50 pins + drop-a-pin add; CSV bulk-add 50 in minutes (geocoded on import); additive-only schema; vertical-neutral label. |

**Target hierarchy:** `Tenant (brand) → [optional Region] → Location (store: address + lat/lng + POS id) → ScreenGroup (drive-thru / lobby) → Screen.` Reserve parent/child **Tenant** for separate brands/franchisees, not individual stores.

**Self-serve flow (the "no pro-services" promise):** operator adds locations (one at a time, drop-a-pin, OR CSV `name,address,posLocationId`) → screens self-pair and pick their location from a dropdown → connect the POS once at brand level → map each VenueOS Location to its POS store (or auto-match by name/address) → every store's screens show that store's live POS prices; a manual price edit at a location always wins.

## Sources
Yodeck Workspaces/CSV; OptiSigns chain-restaurant guide + Mass Provisioning + Map View + sub-account billing; ScreenCloud Spaces; Rise Vision Sub-Companies; NoviSign POS menu boards; Raydiant multi-location + Square/Toast; Spectrio menu boards + Clover; Mvix menu boards + implementation services; Navori dynamic data feeds; Skykit platform; AppSpace Locations + device properties; WAND/Coates QSR; Square ItemVariationLocationOverrides + Locations API; Toast Location-Specific Pricing; Shopify Locations/Inventory. (Full URLs in the session transcript; OptiSigns Map View = medium confidence, page 403; "Coates CADS" unfound — their CMS is Switchboard™.)
