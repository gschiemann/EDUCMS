# POS field-mapping + 50-location scale assessment (2026-06-02)

Two code-verified Explore-agent investigations triggered by the operator's
two questions after the self-serve POS connectors landed (`c08614f`):

1. **"Have we taken the POS's actual field naming and mapped it to our
   templates — pick the integration at the top, then manually override any
   field where our default isn't what the customer wants?"**
   → `01-pos-field-mapping-to-templates.md`

2. **"Where are we for the large customer — 50 locations, 150+ screens?
   See them all on a map; the template updates per market/location/specials/
   inventory; the POS drives cost but it varies by location (one global
   mapping won't work). POS systems map down to location/market level — let's
   prepare for that."**
   → `02-multilocation-150-screen-scale.md`

3. **"Look at what all the other large CMS apps do [for multi-location] and
   see how we can make ours even more user-friendly — we don't want to charge
   professional services. Maybe use groups as the store locations?"**
   → `03-competitor-multilocation-models.md` (competitor research + the
   data-model decision: recommend a first-class **Location** entity)
   → operator-facing workflow written up in **`docs/MULTI_LOCATION_GUIDE.md`**.

4. **"At the top level I should see every store's screens + map, control
   everything, drill down to a location, set fleet-wide offline alerting;
   local users optional. Vet it — does it help or hurt?"**
   → `04-fleet-rollup-current-state.md` (code reality: parent sees 0 child
   screens today — confirmed gap + change surface)
   → `05-fleet-management-best-practice.md` (12-platform research: the model
   is the industry-standard "single pane of glass" — VALIDATED — plus the
   alert-fatigue + bulk-guardrail refinements the best products add).

## TL;DR

| Question | Verdict |
|---|---|
| Auto-capture POS catalog + default field mapping to the menu widget | ✅ Works (all 4 providers) |
| Operator override of **price + availability (86)** per location, survives re-sync | ✅ Works (`MenuLocationOverride` + `resolveMenuForLocation`) |
| Operator override of **name / description / image** + remap which POS field feeds which slot | ❌ Missing — only price/86 are overridable today |
| Rich POS fields (modifiers / SKU / tax / dietary / multiple images / variations) | ❌ Mostly dropped |
| Fleet map at 150 screens / 50 locations (clustered, performant) | ✅ Works (Leaflet markercluster) |
| Location modeled first-class; one template auto-varies data per location | ✅ Works (child Tenant + `PosLocation` + `Screen.posLocationId` → `/screens/:id/menu`) |
| **POS multi-location pricing actually captured + driving per-location price** | ❌ Missing — `PosLocation`/`locationMap` schema exists but NOTHING syncs Square Locations / Shopify Locations / Lightspeed Outlets, and there's no screen→POS-location assignment UI |
| Market / region rollup tier | ❌ Missing (only 2-level chain→location hierarchy) |

**Bottom line:** the per-location *architecture* is built and the map scales,
but (a) operators can only override price/86 (not name/desc/image or field
mapping), and (b) the POS does **not yet drive** per-location pricing — the
location-sync + mapping layer is scaffolded in schema but unimplemented. A
50-store chain could launch today entering per-location prices **manually**;
auto-driving them from the POS is the gap to close.

Source: two read-only Explore agents, file:line evidence inline in each report.
