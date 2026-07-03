# Task #60 — legacy Tenant geocode back-fill

**Status: CODE-ONLY. Not executed against any database. Not wired to auto-run anywhere.**

**2026-07-03 update — adversarial review GO_WITH_FIXES, all fixes applied.**
An adversarial review of the original implementation returned
`GO_WITH_FIXES` with six required changes, all additive/hardening only
(dry-run-by-default, SUPER_ADMIN guard, no-auto-run, no migration all
preserved). See "Adversarial-review fixes" section below for the full
list, what changed, and why.

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
- **Capped per invocation:** `limit` defaults to **25**, hard-ceilinged at
  **50** regardless of what's passed in (`GeocodeBackfillService.sanitizeLimit`).
  One call can never run away across an entire fleet, AND — post-review —
  can never approach the platform request-timeout edge (Railway's ~300s
  no-bytes cutoff): at the ~1.1s/tenant `DELAY_MS` pacing, 50 tenants is
  ~55s of provider round trips, comfortably inside the window with
  headroom for provider latency spikes. This is a hard ceiling, NOT an
  async-job conversion — for a fleet bigger than 50 rows, call the
  (idempotent) endpoint repeatedly; each call only touches rows still
  missing coordinates, so there's no risk of double-processing across
  calls.
- **Resilient:** each tenant's geocode call is wrapped in its own
  try/catch. A thrown error, a zero-result response, non-numeric
  coordinates, or an **out-of-range / null-island** result (see coordinate
  range guard below) are all recorded as `status: 'failed'` for that one
  tenant and the loop continues — nothing aborts the batch.
- **Coordinate range guard (added 2026-07-03):** before ever calling
  `tenant.update`, the resolved lat/lng is checked against the SAME range
  invariant the rest of the app enforces on `Tenant.latitude`/`longitude`
  (`apps/api/src/tenants/tenants.controller.ts` —
  `latitude >= -90 && <= 90`, `longitude >= -180 && <= 180`). Rejected
  as `status: 'failed'`:
  - `reason: 'coordinates_out_of_range'` — `|lat| > 90` or `|lng| > 180`,
    or a non-finite number.
  - `reason: 'coordinates_null_island'` — exact `(0, 0)`, which is
    technically in-range but is the canonical low-confidence/garbage
    result a geocoder returns when it silently failed to parse an
    address; no real Tenant is actually sited there.

  This is the only data-corruption path in the service: because the
  eligibility WHERE clause is `latitude IS NULL`, a bad write would be
  **sticky** — the tenant would never be picked up again by a re-run to
  self-heal. The guard runs strictly before the write, so a bad geocode
  result can never reach the database.
- **Single-flight lock (added 2026-07-03):** a module-level (process-wide)
  boolean in `GeocodeBackfillService` (`private static isRunning`)
  rejects a second concurrent `run()` invocation immediately with
  `GeocodeBackfillAlreadyRunningError` (`code: 'GEOCODE_BACKFILL_ALREADY_RUNNING'`),
  which the controller maps to HTTP 409. The lock covers BOTH dry-run and
  real invocations (simpler to reason about than a partial lock, and a
  concurrent dry-run still duplicates provider calls / wastes rate-limit
  headroom even though it writes nothing) and is released in a `finally`
  so a mid-run throw can never wedge the service. A plain in-process
  boolean — not a distributed Redis lock — is intentional: this is a
  manually-triggered, SUPER_ADMIN-only maintenance action handled by a
  single API replica, not normal app traffic.
- **Throttled:** `POST /api/v1/admin/geocode-backfill` carries
  `@Throttle({ default: { limit: 2, ttl: 60_000 } })` — 2 calls per
  rolling 60s window per the app's global `ThrottlerGuard`. Tighter than
  the single-lookup `/api/v1/geocode` proxy's 30/60s because this
  endpoint fans out up to 50 provider calls per invocation, not one.
- **Summary shape returned:**
  ```ts
  {
    dryRun: boolean,
    totalCandidates: number, // FULL eligible fleet size, ignoring `limit`
    scanned: number,      // rows pulled (bounded by limit)
    eligible: number,      // scanned minus already-skipped rows
    geocoded: number,      // written (dryRun:false only)
    wouldGeocode: number,  // resolved but NOT written (dryRun:true)
    skipped: number,       // already had coords, or address too short
    failed: number,        // geocode threw / no match / bad coords / out-of-range
    details: [ { tenantId, name, address, status, latitude?, longitude?, source?, reason? }, ... ]
  }
  ```
  `totalCandidates` (added 2026-07-03) is a separate `prisma.tenant.count()`
  against the same eligibility WHERE used for the page `findMany` pulls —
  it lets a dry-run operator see the TRUE remaining-work population
  across the whole fleet, not just the size of the `limit`-capped page
  this particular call happened to pull.
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
- `{ code: 'GEOCODE_BACKFILL_RUN_FAILED', message }`, HTTP 500, thrown only
  if the service itself throws unexpectedly (it's designed not to, given
  the per-tenant try/catch, but the controller has a backstop).
- `{ code: 'GEOCODE_BACKFILL_ALREADY_RUNNING', message }`, HTTP 409,
  thrown when a run is already in flight (single-flight lock — see
  above). Wait for the first run's response before retrying.

Also rate-limited: `@Throttle({ default: { limit: 2, ttl: 60_000 } })` —
2 calls per rolling 60s window (same `@nestjs/throttler` mechanism as
`GeocodingController`, tighter limit because this endpoint fans out far
more provider calls per call).

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

**For large backfills, call the endpoint repeatedly rather than one huge
run** — `limit` is capped at 50 per invocation (dropped from the original
500 ceiling in the 2026-07-03 adversarial-review hardening, specifically
so one synchronous call can never approach the platform request-timeout
edge). It's fully idempotent (already-geocoded tenants are excluded by
the eligibility WHERE on every call), so repeated calls are safe and each
one only touches rows still missing coordinates. At the ~1.1s/tenant
`DELAY_MS` pacing, a 25–50-tenant run finishes in roughly 30–60 seconds
(plus per-tenant provider latency), well inside a normal request window.
Use the returned `totalCandidates` field from a dry-run to estimate how
many repeat calls a full fleet sweep will need (e.g. `totalCandidates: 340`
at `limit: 50` → ~7 calls to clear the fleet). Also respect the endpoint's
throttle (2 calls/60s) and the single-flight lock (one run at a time,
HTTP 409 `GEOCODE_BACKFILL_ALREADY_RUNNING` on a concurrent second call)
when scripting repeated calls — pace them out rather than firing in a
tight loop.

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

## Adversarial-review fixes (2026-07-03)

An adversarial review of the original implementation returned
`GO_WITH_FIXES`. All six required changes were applied, additive/hardening
only — dry-run-by-default, SUPER_ADMIN guard, no-auto-run, and no
migration were all preserved unchanged:

1. **MUST-FIX — coordinate range guard.** `processOne()` in
   `geocode-backfill.service.ts` now rejects any geocoder result where
   `!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90
   || Math.abs(lng) > 180`, AND rejects exact `(0, 0)` "null island" as a
   no-confidence result — both BEFORE `tenant.update` is ever called.
   Rejections record `status: 'failed', reason: 'coordinates_out_of_range'`
   or `reason: 'coordinates_null_island'` and write nothing. This closes
   the only data-corruption path in the service (a bad write would have
   been sticky under the `latitude IS NULL` idempotency filter).
2. **Concurrency/rate safety.** `POST /api/v1/admin/geocode-backfill` now
   carries `@Throttle({ default: { limit: 2, ttl: 60_000 } })` (same
   `@nestjs/throttler` mechanism as `GeocodingController`). The service
   also gained an in-process single-flight lock (`private static
   isRunning: boolean` on `GeocodeBackfillService`) — a second concurrent
   `run()` call throws `GeocodeBackfillAlreadyRunningError`
   (`code: 'GEOCODE_BACKFILL_ALREADY_RUNNING'`), which the controller maps
   to HTTP 409. The lock covers both dry-run and real invocations for
   simplicity, and is released in a `finally` block so a mid-run throw can
   never wedge the service permanently.
3. **Bounded synchronous run.** `sanitizeLimit()`'s hard ceiling dropped
   500 → **50**, and its default dropped 50 → **25**, so one call can
   never approach the platform request-timeout edge (Railway's ~300s
   no-bytes cutoff). No async-job conversion was needed — for large
   fleets, call the (idempotent) endpoint repeatedly; see "How to run it
   for real" above.
4. **Accurate reporting.** The summary now includes a `totalCandidates`
   field — a `prisma.tenant.count()` against the same eligibility WHERE
   used for the `findMany` page — so a dry-run operator sees the TRUE
   remaining-work population across the whole fleet, not just the size of
   the `limit`-capped page this call happened to pull.
5. **Nit — O(n²) `indexOf` replaced.** The inner processing loop's
   `eligible.indexOf(tenant) === eligible.length - 1` last-item check
   (an O(n) scan per item, O(n²) overall, and fragile against
   duplicate-identity rows) was replaced with a straightforward loop-index
   comparison (`i + j === eligible.length - 1`).
6. **Defense-in-depth authz test.** Added
   `geocode-backfill.controller.spec.ts` — a unit test (not a full e2e
   HTTP harness) that: (a) reads `GeocodeBackfillController`'s real
   `@UseGuards`/`@RequireRoles` metadata via `Reflect`/`Reflector` to
   catch a dropped/typo'd decorator, and (b) exercises `RbacGuard`
   directly against that real metadata to prove a CONTRIBUTOR (and
   SCHOOL_ADMIN, DISTRICT_ADMIN) caller is rejected with
   `ForbiddenException` (403) while SUPER_ADMIN passes, plus a
   `JwtAuthGuard` unit test proving a request with no Authorization header
   is rejected with `UnauthorizedException` (401) before `RbacGuard` would
   ever run (guard order: `@UseGuards(JwtAuthGuard, RbacGuard)`).

## Checks run

- `rm -f apps/api/tsconfig.build.tsbuildinfo && pnpm --filter api exec tsc --noEmit --project tsconfig.build.json`
  → **PASS** (clean, zero errors) after also building the pre-existing
  `@cms/signage-design` and `@cms/scoreboard-cts` workspace packages,
  whose missing `dist/` output was causing unrelated pre-existing errors
  in `ai.service.ts` / `sports.service.ts` / etc. — not touched by, or
  related to, this task.
- `pnpm --filter api exec jest src/geocode-backfill` → **PASS**, 27/27
  tests green across both spec files:
  - `geocode-backfill.service.spec.ts` (19 tests: the original 10 plus 9
    new from this hardening pass) — dry-run writes nothing, a
    null-lat/lng+address tenant is eligible, an already-geocoded tenant is
    excluded by the query AND by the service's own defense-in-depth guard,
    one tenant's geocode failure/empty-result doesn't abort the batch,
    `limit` is respected (now default-25 / hard-ceiling-50), a real run
    writes exactly one AuditLog row per tenant actually geocoded, PLUS the
    new coverage: out-of-range latitude/longitude rejected and not
    written, exact `(0,0)` null-island rejected, a valid in-range
    coordinate still writes (no false positive), boundary values at
    exactly ±90/±180 are accepted, a second concurrent real run is
    rejected while the first holds the lock, the lock releases via
    `finally` even when the run throws (proven via a forced failed
    initial query) so a subsequent call proceeds, a concurrent dry-run is
    also locked, and `totalCandidates` reports the full eligible
    population independent of `limit`.
  - `geocode-backfill.controller.spec.ts` (8 new tests) — guard/role
    metadata presence, RbacGuard rejects CONTRIBUTOR/SCHOOL_ADMIN/
    DISTRICT_ADMIN with 403, RbacGuard allows SUPER_ADMIN, RbacGuard
    rejects a request with no user attached, and JwtAuthGuard rejects a
    no-Authorization-header request with 401.
