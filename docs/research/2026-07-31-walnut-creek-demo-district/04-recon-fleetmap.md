# Recon: Fleet map + geocoding

## Summary
The fleet map has two surfaces: (a) per-tenant map view inside the Screens page (`viewMode === 'map'` renders `ScreenMapClient` from GET /api/v1/screens data) and (b) the HQ/district roll-up `FleetRollup` on the dashboard, driven by GET /api/v1/screens/fleet via `useFleet()`. Pins need per-screen `effectiveLatitude`/`effectiveLongitude` (screen-specific `Screen.latitude/longitude` wins, `Tenant.latitude/longitude` is the building fallback, `geoSource: 'screen'|'tenant'|'none'`); a pin appears only when both effective coords are non-null. Lat/lng are populated by the authed proxy GET /api/v1/geocode (Google → US Census → OSM Nominatim) whose results the client passes back into PUT /screens/:id/location, POST /tenants/children, or PATCH /tenants/me — those endpoints save `address`, `latitude`, `longitude` (Float?) on Screen/Tenant rows. The false-HQ fix: /screens/fleet and /tenants/children filter children with `archivedAt: null`, and `isHQ = fleet.locations.length > 1` gates the dashboard map. DistrictSchoolsCard reads GET /tenants/children (`children[].{id,name,slug,createdAt,_count:{screens,users}}`). Scripts can set coords directly — `packages/database/prisma/seed-50-locations.mjs` writes `latitude`/`longitude` (plain numbers) on both `prisma.tenant` and `prisma.screen` upserts, plus `status:'ONLINE'`, `lastPingAt: new Date()` to read online.

## Key files
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/screens/screens.controller.ts` — GET /api/v1/screens (list, lines 929-1069, effectiveLatitude/Longitude + geoSource hydration), GET /api/v1/screens/fleet (lines 1120-1198, archivedAt:null child filter line 1136), PUT /api/v1/screens/:id/location (lines 2032-2101, saves Screen.address/latitude/longitude/photoUrl with inline Nominatim geocode)
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/geocoding/geocoding.controller.ts` — GET /api/v1/geocode?q=&lat=&lng= and GET /api/v1/geocode/reverse?lat=&lng= — exact request/response shapes
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/geocoding/geocoding.service.ts` — Provider chain Google → Census → Nominatim; GeocodeResult {display_name, lat:string, lon:string, source}
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/tenants/tenants.controller.ts` — POST /tenants/children (lines 98-173, saves child Tenant address/latitude/longitude), PATCH /tenants/me (lines 285-345, address change nulls coords then AddressAutocomplete coords overwrite), GET /tenants/children (lines 69-90, _count.screens/_count.users, archivedAt:null), GET /tenants (lines 519-545, exposes address/latitude/longitude)
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/hooks/use-api.ts` — useFleet (lines 2152-2185, FleetScreen/FleetResponse TS interfaces = exact pin data shape), useUpdateScreenLocation (lines 2310-2317)
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/screens/ScreenMap.tsx` — Leaflet map: ScreenForMap type (lines 45-55), pin appears only when latitude/longitude non-null (line 533), store grouping by normalized address (lines 92-179), cluster worst-status coloring
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/screens/FleetRollup.tsx` — HQ command center consuming FleetResponse; maps effectiveLatitude/Longitude into ScreenMapClient (lines 84-98); State→Location tree from effectiveAddress
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/dashboard/page.tsx` — isHQ gate: canFleet = SUPER_ADMIN||DISTRICT_ADMIN (line 54), isHQ = fleet.locations.length > 1 (line 57), renders FleetRollup line 464
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/screens/page.tsx` — Per-tenant map tab (viewMode==='map', lines 1774-1807) feeding effectiveLatitude ?? latitude into ScreenMapClient
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/settings/DistrictSchoolsCard.tsx` — District dashboard card: ChildTenant {id,name,slug,createdAt,_count:{screens,users}} from GET /tenants/children (line 266); vertical-aware COPY; renders row._count.screens / row._count.users (lines 624-627)
- `/Users/gschiemann/Desktop/EDU CMS/packages/database/prisma/schema.prisma` — Tenant.address/latitude/longitude (lines 167-169, table 'tenants'), Screen.address/latitude/longitude/photoUrl (lines 727-730, table 'screens' @@map line 962) — Float?, no @map so DB columns are bare latitude/longitude
- `/Users/gschiemann/Desktop/EDU CMS/packages/database/prisma/seed-50-locations.mjs` — Proof + template for a demo script writing latitude/longitude directly on tenant + screen upserts (lines 92-105), screens ONLINE via lastPingAt=now
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/geocode-backfill/geocode-backfill.service.ts` — SUPER_ADMIN-only manual backfill POST /api/v1/admin/geocode-backfill writing tenant.latitude/longitude for legacy rows with address but null coords
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/lib/geocode.ts` — Frontend proxy client: geocodeViaApiFull / reverseGeocodeViaApi hitting /geocode and /geocode/reverse with browser-location bias

## Details
## 1. FLEET MAP — surfaces, endpoints, pin data shape

TWO map surfaces, both rendering `ScreenMapClient` (dynamic-import wrapper, 21 lines) → `ScreenMap` (Leaflet + leaflet.markercluster, 945 lines) at `apps/web/src/components/screens/ScreenMap.tsx`:

**(a) Per-tenant Screens-page map** — `apps/web/src/app/[schoolId]/screens/page.tsx` line 1460 `const [viewMode, setViewMode] = useState<'list'|'map'|'floor'>('list')`; when `viewMode === 'map'` (lines 1774-1807) it renders `<ScreenMapClient screens={flatScreens.map(...)}/>` fed from **GET /api/v1/screens** (the `list()` handler, screens.controller.ts lines 929-1069). Data mapped per screen: `latitude: s.effectiveLatitude ?? s.latitude`, `longitude: s.effectiveLongitude ?? s.longitude`, `address: s.effectiveAddress ?? s.address`, `geoSource`, `lastPingAt`, `lastCacheReport`.

**(b) HQ/district fleet roll-up** — `FleetRollup` (`apps/web/src/components/screens/FleetRollup.tsx`), mounted at:
- `apps/web/src/app/[schoolId]/dashboard/page.tsx` line 464: `{isHQ && fleetRollup && <FleetRollup fleet={fleetRollup} />}`
- `apps/web/src/components/dashboard/MobileDashboard.tsx` line 222 (same pattern)
Driven by **GET /api/v1/screens/fleet** via `useFleet()` (use-api.ts lines 2176-2185; `apiFetch('/screens/fleet')`, `refetchInterval: 30_000`, `staleTime: 10_000`; enabled only for SUPER_ADMIN/DISTRICT_ADMIN — server 403s others via `@RequireRoles(AppRole.SUPER_ADMIN, AppRole.DISTRICT_ADMIN)`).

**GET /screens/fleet response shape** (exact, screens.controller.ts lines 1120-1198 + TS interfaces use-api.ts 2157-2175):
```ts
interface FleetResponse {
  root: { id: string; name: string; slug: string } | null;
  locations: Array<{ id: string; name: string; slug: string }>;   // self + non-archived direct children
  stats: { total: number; online: number; offline: number; locationCount: number };
  screens: FleetScreen[];
}
interface FleetScreen {
  id: string; name: string;
  status: string;                       // live-computed: ONLINE if lastPingAt < 35s old, else OFFLINE (REVOKED/PENDING preserved)
  screenGroup: { id: string; name: string } | null;
  lastPingAt: string | null;
  lastCacheReport: any;                 // per-pin emergency-cache badge
  effectiveLatitude: number | null;     // screen coords win, tenant coords fallback
  effectiveLongitude: number | null;
  effectiveAddress: string | null;
  geoSource: 'screen' | 'tenant' | 'none';
  sourceTenant: { id: string; name: string; slug: string } | null; // drives cluster label + manage deep-link
}
```
**Pins need BOTH per-screen and per-tenant HQ coords conceptually, but the API pre-resolves them**: `effectiveLatitude/Longitude` = `Screen.latitude/longitude` if both non-null (`geoSource:'screen'`), else the owning `Tenant.latitude/longitude` (`geoSource:'tenant'`), else null (`geoSource:'none'`, screen omitted from map). Same hydration exists on GET /api/v1/screens (per-tenant list) lines 1019-1044 with tenant geo pulled once (lines 956-959).

**ScreenMap pin logic**: `ScreenForMap = { id, name, status, latitude, longitude, address?, geoSource?, lastPingAt?, lastCacheReport? }` (lines 45-55). A pin renders only for `located = screens.filter(s => s.latitude != null && s.longitude != null)` (line 533); `unmappedCount = screens.length - located.length` shows a notice. Screens group into "Stores" keyed by normalized address, else `lat.toFixed(4),lng.toFixed(4)` (~11 m) (lines 139-179); status classes EMERGENCY/ONLINE/OFFLINE/PENDING with worst-status cluster coloring; `geoSource === 'tenant'` shows a "Building location" popup badge (line 346-348).

## 2. GEOCODE PROXY — request/response + where results are SAVED

**GET /api/v1/geocode?q=<address>&lat=<biasLat>&lng=<biasLng>** — `apps/api/src/geocoding/geocoding.controller.ts` (`@Controller('api/v1/geocode')`, JwtAuthGuard, throttle 30/60s). NOTE: app has NO global prefix; controller path carries `api/v1`. Response:
```json
{ "results": [ { "display_name": "...", "lat": "30.2504", "lon": "-97.7501", "source": "google|census|nominatim" } ],
  "provider": "google|census|nominatim",
  "googleConfigured": true|false }
```
`lat`/`lon` are STRINGS (GeocodeResult, geocoding.service.ts lines 9-14). Provider chain in `GeocodingService.search()` (lines 70-100): 1) Google Geocoding when `GOOGLE_MAPS_API_KEY` set (server-only, `components=country:US`, `bounds=` bias ±0.75°), 2) US Census Bureau `geocoder/locations/onelineaddress?benchmark=Public_AR_Current` (keyless, free — PRIMARY keyless path), 3) OSM Nominatim (`countrycodes=us`, `viewbox` bias). All via `safeFetch` (DNS-pinned, 5s timeout, 256KB cap).

**GET /api/v1/geocode/reverse?lat=&lng=** → `{ result: GeocodeResult|null, provider, googleConfigured }` — powers "drop a pin → auto-fill address" (Google → Nominatim only).

Frontend client: `apps/web/src/lib/geocode.ts` — `geocodeViaApiFull(query, bias?)` fetches `/geocode?q=...` (apiFetch base already has /api/v1), auto-biases with browser geolocation (`primeLocationBias`); `reverseGeocodeViaApi(lat, lng)`.

**THE PROXY ITSELF SAVES NOTHING.** Persistence happens when the client passes the chosen hit's coords into one of these save endpoints:
- **Screen**: `PUT /api/v1/screens/:id/location` (screens.controller.ts lines 2032-2101), body `{ address?: string|null, latitude?: number|null, longitude?: number|null, photoUrl?: string|null }`. If address changed and NO explicit coords given, it geocodes server-side (direct Nominatim call, line 2069) then `prisma.client.screen.update({ data: { address, latitude, longitude, photoUrl } })`. Frontend hook: `useUpdateScreenLocation()` (use-api.ts 2310-2317). Address capped at 300 chars (`SCREEN_ADDRESS_TOO_LONG`).
- **Tenant (create child)**: `POST /api/v1/tenants/children` (tenants.controller.ts lines 98-173), body `{ name, slug?, address?, latitude?, longitude? }` — coords bounds-checked (lat -90..90, lng -180..180) and saved ONLY when both present; `tx.tenant.create({ data: { name, slug, parentId, address, latitude, longitude } })`.
- **Tenant (self)**: `PATCH /api/v1/tenants/me` (lines 285-345), body `{ vertical?, name?, address?, latitude?, longitude? }`. GOTCHA: any address change first NULLS `latitude`/`longitude` (lines 313-314), then bounds-valid body coords overwrite (lines 323-328) — so a script PATCHing address without coords wipes the pin.
- **Backfill (legacy rows)**: `POST /api/v1/admin/geocode-backfill` (SUPER_ADMIN only, `@Controller('api/v1/admin/geocode-backfill')`), body opts `{ dryRun?: true, limit?: 50, tenantId?, }` — finds Tenants with `address` set + `latitude IS NULL AND longitude IS NULL`, geocodes via the same chain, writes `tenant.update({ data: { latitude, longitude } })`. NOT a cron; call it manually.

## 3. FALSE-HQ-MAP FIX — what makes pins appear / cluster

- **Fix (2026-07-23 "Dodgers incident", commit 0bf1658e era)**: `/screens/fleet` child query is `where: { parentId: rootId, archivedAt: null }` (screens.controller.ts line 1136). Archived children don't join `locations`, their screens aren't fetched, and `stats.locationCount` drops.
- **Map visibility gate**: dashboard `isHQ = (fleetRollup?.locations?.length ?? 0) > 1` (dashboard/page.tsx line 57; MobileDashboard.tsx line 88). A parent whose only children are archived reads `locations.length === 1` (just self) → FleetRollup (and its map) never mounts. `canFleet` role gate: SUPER_ADMIN || DISTRICT_ADMIN (line 54).
- Same `archivedAt: null` filter on `GET /tenants/children` (tenants.controller.ts line 82) and `GET /tenants/accessible` (line 49).
- **A pin appears when**: the screen's `effectiveLatitude` AND `effectiveLongitude` are non-null — i.e. either `Screen.latitude`+`Screen.longitude` both set, OR owning `Tenant.latitude`+`Tenant.longitude` both set. `geoSource:'none'` screens are counted in `unmappedCount` and never plotted.
- **A school/location clusters correctly when**: its screens share a normalized address key (`normalizeAddrKey` strips suite/unit/USA noise, ScreenMap.tsx lines 111-121) or, absent addresses, round to the same 4-decimal lat/lng (line 144) — they collapse into one `Store` at the coord centroid with worst-status coloring. In FleetRollup the tree groups by `sourceTenant.id` and rolls up to US state parsed from `effectiveAddress` ("Street, City, ST ZIP" — `parseState`, FleetRollup.tsx lines 44-52; unparseable → "Other"). So for a demo district: give every child Tenant a distinct real address AND matching lat/lng, give screens either no coords (they inherit the building pin, badge "Building location") or per-screen coords near the building.

## 4. DISTRICT DASHBOARD — DistrictSchoolsCard

`apps/web/src/components/settings/DistrictSchoolsCard.tsx`, mounted on `apps/web/src/app/[schoolId]/settings/page.tsx` (visible to DISTRICT_ADMIN + SUPER_ADMIN on a parent tenant). Fetches **GET /api/v1/tenants/children** (line 266) →
```ts
{ districtId: string,
  children: Array<{ id: string; name: string; slug: string; createdAt: string;
                    _count: { screens: number; users: number } }> }
```
(server: tenants.controller.ts lines 69-90 — `_count: { select: { screens: true, users: true } }`, `archivedAt: null`, ordered by name). The card renders: heading count `({data.children.length})` (line 380), per-row `row._count.screens` next to a MonitorPlay icon (line 624) and `row._count.users` next to a Users icon (line 627), plus vertical-aware copy (`COPY: Record<Vertical, Copy>` keyed by Tenant.vertical: K12→"school", QSR→"location", GYM→"gym" etc., lines 46-191) and an inline "Add a school" form using `AddressAutocomplete` that POSTs `/tenants/children` with `{ name, address, latitude, longitude }`. NOTE: this card shows NO online/offline status — statuses come from the FleetRollup on the DASHBOARD page (`fleet.stats.{total,online,offline,locationCount}`, per-location `on/off` chips, per-screen ONLINE dots). So a fully-built demo district needs: N child tenants (non-archived) each with screens rows (drives `_count.screens`), user rows (drives `_count.users`), addresses+coords (drives map + state tree), and fresh `lastPingAt` (drives online counts).

## 5. SCRIPT-SET LAT/LNG DIRECTLY — yes, proven pattern

Geocode API is entirely skippable. Exact Prisma fields (schema.prisma):
- **Tenant** (model line 12, table `tenants` @@map line 217): `address String?` (line 167, column `address`), `latitude Float?` (line 168, column `latitude`), `longitude Float?` (line 169, column `longitude`), plus `parentId`, `vertical`, `archivedAt` (must stay null to count).
- **Screen** (model line 679, table `screens` @@map line 962): `address String?` (line 727), `latitude Float?` (line 728), `longitude Float?` (line 729), `photoUrl String? @map("photo_url")` (line 730). For ONLINE status also set `status: 'ONLINE'` + `lastPingAt: new Date()` (fleet computes live status: fresh if < 35_000 ms old — screens.controller.ts line 971/1156) + `pairedAt`, `deviceFingerprint` (unique), `resolution`, `orientation`.

Canonical template: `packages/database/prisma/seed-50-locations.mjs` — `prisma.tenant.upsert({ ..., update/create: { name, slug, parentId: CORP, vertical, address: loc.address, latitude: loc.lat, longitude: loc.lng } })` and `prisma.screen.upsert({ where: { deviceFingerprint: fp }, update: { name, tenantId, status: 'ONLINE', lastPingAt: now, resolution: '1920x1080', address, latitude, longitude }, create: { +pairedAt: now, orientation: 'LANDSCAPE' } })` (lines 92-105). Sibling script `seed-multilocation-demo.mjs` seeds the corporate parent with its own address/lat/lng (line 104). Plain JS numbers (e.g. `30.2504`, `-97.7501`) — no string coords in DB (only the geocode API RESPONSE uses strings).

CAVEATS for direct writes: (a) manifest hot-cache invalidation hooks ride Prisma `$use` in the API process — seed scripts using their own PrismaClient are fine for map/dashboard data (fleet endpoints are `no-store` + read live), but raw SQL edits to manifest-fed content models lag players up to 30 min (CLAUDE.md manifest-cache rule) — lat/lng/address are NOT manifest-fed, so no player impact; (b) keep lat within -90..90 and lng within -180..180 to match the API's own invariant; (c) both coords must be set together — a single coord renders no pin (`hasScreenCoords = latitude != null && longitude != null`).
