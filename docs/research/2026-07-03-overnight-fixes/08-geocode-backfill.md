# Task #60 — legacy Tenant geocode back-fill

**Status: CODE-ONLY. Not executed against any database. Not wired to auto-run anywhere.**

## What it does

Some `Tenant` rows have a physical `address` (`Tenant.address`, added
2026-05-25 for the fleet map) but predate that feature launch — or were
created before an address was collected — and so never got
`Tenant.latitude` / `Tenant.longitude` populated. Those tenants are
invisible on the fleet map. This feature finds them and (optionally)
geocodes + writes their coordinates.

It reuses the **existing** server-side geocoder,
`apps/api/src/geocoding/geocoding.service.ts` (`GeocodingService`) — the
same Google → US Census → OSM Nominatim provider chain the address pickers
and `GET /api/v1/geocode` already use. No new geocoding logic, no new
external API calls were written; this is purely a batch driver on top of
what already exists.

## New files (self-contained module, no existing controllers edited)

- `apps/api/src/geocode-backfill/geocode-backfill.service.ts` —
  `GeocodeBackfillService.run(opts)`. All the actual logic.
- `apps/api/src/geocode-backfill/geocode-backfill.controller.ts` —
  `GeocodeBackfillController`, `POST /api/v1/admin/geocode-backfill`,
  SUPER_ADMIN only.
- `apps/api/src/geocode-backfill/geocode-backfill.module.ts` —
  `GeocodeBackfillModule`, imports `PrismaModule` + `AuthModule`,
  re-provides `GeocodingService` (same pattern `LicenseModule` uses for
  `SupabaseStorageService` — see that file's comment; `GeocodingService`
  is registered directly in `AppModule`'s flat `providers` array rather
  than exported from its own module, and `AppModule` is not `@Global()`,
  so a sibling module can't resolve it without re-providing it).
- `apps/api/src/geocode-backfill/geocode-backfill.service.spec.ts` —
  unit tests (Prisma + GeocodingService mocked, no network, no DB).

**Only existing file touched:** `apps/api/src/app.module.ts` — one import
line + one line in the `imports: [...]` array, registering
`GeocodeBackfillModule`. No other controller, service, or route was
edited.

## Tenant fields used (confirmed from `packages/database/prisma/schema.prisma`)

```prisma
address                         String?            @map("address")
latitude                        Float?             @map("latitude")
longitude                       Float?             @map("longitude")
```

(Added 2026-05-25 for the Sprint 8 fleet map — see the schema comment
directly above these fields.) No schema changes were made or needed.

## How it behaves

- **Eligibility query:** `Tenant` rows where `address IS NOT NULL` AND
  `latitude IS NULL` AND `longitude IS NULL` (optionally further narrowed
  to one `tenantId`).
- **Idempotent / safe to re-run twice:**
  - The DB query itself excludes any tenant that already has coordinates.
  - The service ALSO re-checks per-row before touching it (defense in
    depth against a stale/hand-built query reaching the service layer),
    skipping with `reason: 'already_has_coordinates'`.
  - A blank/too-short (`< 3` chars) address is skipped without ever
    calling the geocoder (`reason: 'address_missing_or_too_short'`).
- **Dry-run by default:** `dryRun` defaults to `true`. In dry-run, every
  eligible tenant is geocoded (a real provider lookup happens — so you
  can see exactly what WOULD be written) but **no `tenant.update()` call
  is made at all**, and **no AuditLog row is written**. Only
  `dryRun: false` persists.
- **Rate-limited / batched:** eligible tenants are processed in a
  straight loop with a 1.1s pause between each geocode call (keeps a
  large backfill from hammering Google/Census/Nominatim; Nominatim's
  usage policy in particular asks for ≤1 req/sec). Reads are pulled in
  a single bounded `findMany` (capped by `limit`), not one query per
  tenant.
- **Capped per invocation:** `limit` defaults to 50, hard-ceilinged at
  500 regardless of what's passed in (`GeocodeBackfillService.sanitizeLimit`).
  One call can never run away across an entire fleet.
- **Resilient:** each tenant's geocode call is wrapped in its own
  try/catch. A thrown error, a zero-result response, or non-numeric
  coordinates are all recorded as `status: 'failed'` for that one tenant
  and the loop continues — nothing aborts the batch.
- **Summary shape returned:**
  ```ts
  {
    dryRun: boolean,
    scanned: number,      // rows pulled (bounded by limit)
    eligible: number,      // scanned minus already-skipped rows
    geocoded: number,      // written (dryRun:false only)
    wouldGeocode: number,  // resolved but NOT written (dryRun:true)
    skipped: number,       // already had coords, or address too short
    failed: number,        // geocode threw / no match / bad coords
    details: [ { tenantId, name, address, status, latitude?, longitude?, source?, reason? }, ... ]
  }
  ```
- **Audited:** for a real (`dryRun:false`) run, one `AuditLog` row is
  written **per tenant actually geocoded** (`action: 'GEOCODE_BACKFILL'`,
  `targetType: 'Tenant'`, `targetId: <tenantId>`), carrying the resolved
  address/coords/source plus the whole run's summary counts in `details`
  (JSON). One row per tenant rather than one row for the whole run because
  `AuditLog.tenantId` is a required (non-null) foreign key — a single row
  can't represent a fleet-wide, multi-tenant action. This mirrors how
  `PosService`/branding services audit per-affected-row for batch actions.
  Audit-write failures are caught + logged, never thrown (an audit hiccup
  must not undo a successful geocode write).

## Guard — SUPER_ADMIN only

`GeocodeBackfillController` uses the same RBAC pattern as
`SuperLicenseController` (`apps/api/src/license/super-license.controller.ts`):

```ts
@UseGuards(JwtAuthGuard, RbacGuard)
@RequireRoles(AppRole.SUPER_ADMIN)
```

`RbacGuard`'s SUPER_ADMIN passthrough means this endpoint is intentionally
cross-tenant (no per-tenant scope check needed — matches how `/api/v1/super/*`
already works).

Errors carry a stable `code` (task #57 convention):
`{ code: 'GEOCODE_BACKFILL_RUN_FAILED', message }`, HTTP 500, thrown only
if the service itself throws unexpectedly (it's designed not to, given the
per-tenant try/catch, but the controller has a backstop).

## How to DRY-RUN it (once deployed)

```bash
curl -X POST https://<api-host>/api/v1/admin/geocode-backfill \
  -H "Authorization: Bearer <SUPER_ADMIN JWT>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "limit": 20}'
```

Response is the summary JSON above with `dryRun: true` — inspect
`details[].status === 'would_geocode'` to see exactly what coordinates
each tenant would get, from which provider, before committing to anything.

To dry-run a single tenant first:
```bash
curl -X POST https://<api-host>/api/v1/admin/geocode-backfill \
  -H "Authorization: Bearer <SUPER_ADMIN JWT>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true, "tenantId": "<tenant-id>"}'
```

## How to run it for real

Only after reviewing a dry-run's output:

```bash
curl -X POST https://<api-host>/api/v1/admin/geocode-backfill \
  -H "Authorization: Bearer <SUPER_ADMIN JWT>" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false, "limit": 50}'
```

Re-run with a higher `limit` (up to 500) or call it again (it's
idempotent — already-geocoded tenants are skipped) to sweep more of the
fleet. For a fleet larger than 500, call it repeatedly; each call only
touches rows still missing coordinates.

## Explicit confirmations

- **This was NOT run against any database.** No tenant row anywhere was
  read or written by this task. All verification was via unit tests with
  Prisma and GeocodingService fully mocked (no network, no DB connection).
- **No cron / scheduler was added.** The service is not registered with
  `@Cron`, `@Interval`, or any scheduled-tasks mechanism, and is not
  called from any other service's code path. It only runs when a
  SUPER_ADMIN explicitly calls the endpoint.
- **No migration was run or created.** `Tenant.latitude`/`longitude`
  already existed in the schema from the #62 fleet-map work; this task
  made zero schema changes.
- **The Google Maps API key is never exposed.** The controller only ever
  calls `GeocodingService.search()` server-side, same as the existing
  `/api/v1/geocode` proxy — the key stays in `GOOGLE_MAPS_API_KEY` on the
  server and is never returned to any client.

## Checks run

- `rm -f apps/api/tsconfig.build.tsbuildinfo && pnpm --filter api exec tsc --noEmit --project tsconfig.build.json`
  → **PASS** (clean, zero errors) after also building the pre-existing
  `@cms/signage-design` and `@cms/scoreboard-cts` workspace packages,
  whose missing `dist/` output was causing unrelated pre-existing errors
  in `ai.service.ts` / `sports.service.ts` / etc. — not touched by, or
  related to, this task.
- `pnpm --filter api exec jest src/geocode-backfill/geocode-backfill.service.spec.ts`
  → **PASS**, 10/10 tests green. See test names in the commit / PR — they
  cover: dry-run writes nothing, a null-lat/lng+address tenant is
  eligible, an already-geocoded tenant is excluded by the query AND by
  the service's own defense-in-depth guard, one tenant's geocode
  failure/empty-result doesn't abort the batch, `limit` is respected
  (including the default-50 / hard-ceiling-500 clamp), and a real run
  writes exactly one AuditLog row per tenant actually geocoded.
