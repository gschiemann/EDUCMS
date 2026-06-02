# HQ fleet roll-up — current code state + change surface (2026-06-02)

Read-only code investigation (Explore agent). Question: at the PARENT
("Corporate") tenant, does the operator see/control every child location's
screens + map + offline alerts today, or is it a gap?

## Verdict: it's a GAP today (confirmed)

| Capability at the PARENT level | Today | Evidence |
|---|---|---|
| See child locations' screens in the Screens list | ❌ **No — sees 0** | `screens.controller.ts:921-925` — `where: { tenantId: req.user.tenantId }` (exact tenant only) |
| See child screens on the fleet map | ❌ **No — blank** | `ScreenMap.tsx` consumes the same `/screens` endpoint → same exact-tenant scoping |
| Roll-up of child screens (any form) | ⚠️ counts only | `/tenants/children` returns child `_count.screens` (a number, not the screens) `tenants.controller.ts:68-89` |
| Manage a child's screen from the parent | ❌ must SWITCH tenant | `/tenants/switch` mints a child-scoped JWT; screen mutations use `where: { id, tenantId: req.user.tenantId }` (404s on a child screen) |
| Offline detection | ✅ exists | `offline-screen-scanner.ts` (60s scan, >5min stale = offline) + cohort-outage detection in `notifications.service.ts:165-272` |
| Offline ALERT reaches the parent | ❌ **No** | notifications created with `tenantId = CHILD`; `listForUser` filters `where: { tenantId }` → parent never sees child alerts |
| RBAC for cross-tenant screen control | scoped/blocked | screens are tenant-scoped at the DAO; `DISTRICT_ADMIN` already may switch into children + RbacGuard has `districtId` scope logic to reuse |

**So:** logged into Corporate, you see none of your 15 store screens, a blank
map, and you'd get no offline alert when a store screen drops — you must switch
into each store. That's the gap the operator hit.

## Change surface (what to build)

1. **`visibleTenantIds` helper** — for a parent admin, resolve `{ self } ∪ { all children of self }`; screens query becomes `where: { tenantId: { in: visibleTenantIds } }`. Add `sourceTenantId` (which store) to each screen in the response for drill-down + map labels. (~2-3h)
2. **Fleet map** — auto-shows all locations once the list includes child screens; clustering already exists (`ScreenMap.tsx` `deriveStores`). Add a location/status filter + click-pin drill-down. (~1-2h)
3. **Parent-scoped offline alerts** — when a child screen/cohort goes offline, ALSO emit a notification to the parent tenant (with the store name), deduped. (~1-2h)
4. **Bulk actions across locations** (pause/resume/reboot/reassign) gated by `visibleTenantIds`. (~4-6h, phase 2)
5. **RBAC** — reuse the existing `DISTRICT_ADMIN`→children scope; allow parent admins to act on a child screen when its tenant ∈ visibleTenantIds.

## Risks the agent flagged
- **Perf**: a 50-location parent query can pull thousands of rows → paginate/virtualize the list; map lazy-loads.
- **Notification volume**: parent gets every child's alerts → aggregate ("Lincoln HS: 5 screens offline") + fatigue controls (see doc 05).
- **Backward-compat**: `/screens` returns more rows for parent admins → gate with role/`includeChildren`.
- **Model cost**: this roll-up exists ONLY because screens live in child *tenants*. With a first-class **Location** entity (all screens in one tenant, filtered by location), "see everything + drill down" is a trivial filter and alerts are naturally one-tenant — i.e. this feature is the third place the sub-account model costs more than the Location model (docs 01-03).
