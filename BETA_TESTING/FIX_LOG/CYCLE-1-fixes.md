# CYCLE-1 Fix Log

## auth-001 — Cross-tenant SSO config write

**Severity:** Critical (auth/tenancy isolation breach)

**Bug:**
The SSO admin routes mounted under `/api/v1/tenants/:tenantSlug/sso`
(GET, POST, and POST `.../sso/test`) accepted any `tenantSlug` from
the URL but never verified it matched the caller's tenant. `RbacGuard`
only checks `params.districtId` / `params.schoolId`, neither of which
appear on these routes. A DISTRICT_ADMIN of `lincoln-hs` could POST
their own SAML/OIDC IdP config to `/api/v1/tenants/jefferson-hs/sso`
and silently take over Jefferson's login flow.

**Fix:**
Added `assertTenantAccess(tenantSlug, req)` private helper in
`SsoController`. It resolves the target tenant via
`prisma.tenant.findUnique({ where: { slug } })`, then enforces:

1. Tenant not found -> 404 NotFoundException
2. `req.user.role === 'SUPER_ADMIN'` -> allow
3. `target.id === req.user.tenantId` -> allow (own tenant)
4. `req.user.role === 'DISTRICT_ADMIN'` AND
   `target.parentId === req.user.tenantId` -> allow
   (district admin managing one of their schools)
5. Otherwise -> 403 ForbiddenException

The helper is invoked at the top of all three admin handlers:
`getConfig` (GET), `upsertConfig` (POST), `testConfig` (POST .../sso/test).

`upsertConfig` and `testConfig` were updated to take `@Req() req: Request`
so they have access to the JWT-decoded user. Surrounding logic
(SSO config persistence, test-connection, response shape) is unchanged.

**Files changed:**
- `apps/api/src/sso/sso.controller.ts:1-14` (added `ForbiddenException`
  import)
- `apps/api/src/sso/sso.controller.ts:141-180` (gate calls in
  `getConfig`, `upsertConfig`, `testConfig` + `@Req() req: Request`
  on `upsertConfig` and `testConfig`)
- `apps/api/src/sso/sso.controller.ts:186-236` (new
  `assertTenantAccess` helper)

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` returns zero non-spec errors.
Pre-existing spec-file errors (`screens.register.spec.ts`,
`sso.service.spec.ts`) are unrelated and untouched.

**Acceptance test:**
After fix, DISTRICT_ADMIN of tenant A trying to POST to tenant B's
`/sso` endpoint receives 403 ForbiddenException with message
"Access denied. Cannot manage SSO config for a tenant outside your scope."
SUPER_ADMIN, the tenant's own admin, and a DISTRICT_ADMIN whose
tenant is the parent of the target school all continue to receive
the existing successful response.

---

## auth-002 / BUG-005 — Role escalation at user create + role update

**Severity:** Critical (auth/role escalation)

**Bug:**
- `POST /api/v1/users` (line 26-48) accepted `body: { email, password, role: string }`
  and wrote `role: body.role` straight into Prisma with no enum validation.
  A DISTRICT_ADMIN could craft `role: 'SUPER_ADMIN'` and instantly mint a
  platform-owner account in their own tenant.
- `PUT /api/v1/users/:id/role` (line 50-67) had the same Prisma-write-through.
  Even gated to SUPER_ADMIN, a typo or stolen session could write garbage
  strings into the role column.
- `body.email` and `body.password` were also unvalidated: a single-character
  password or malformed email would silently land in the user table.

**Fix:**
Mirrored the validation pattern already in
`apps/api/src/onboarding/onboarding.service.ts` (`ALLOWED_INVITE_ROLES` +
`isValidEmail` + `validatePassword`). No shared validation helper module
exists in the API today, so the helpers were duplicated locally rather
than refactoring scope.

1. Added `ASSIGNABLE_ROLES_BY_CALLER` allowlist
   (caller role -> roles the caller may assign):
   - `SUPER_ADMIN` -> DISTRICT_ADMIN, SCHOOL_ADMIN, CONTRIBUTOR,
     RESTRICTED_VIEWER. SUPER_ADMIN cannot mint another SUPER_ADMIN
     through this route — that path stays manual / DB-only.
   - `DISTRICT_ADMIN` -> SCHOOL_ADMIN, CONTRIBUTOR, RESTRICTED_VIEWER.
   - `SCHOOL_ADMIN` -> CONTRIBUTOR, RESTRICTED_VIEWER (defensive: the
     `POST /users` route is currently gated to SUPER_ADMIN +
     DISTRICT_ADMIN by `@RequireRoles`, but the allowlist anticipates
     a future relaxation without re-introducing escalation).
2. `assertCallerCanAssignRole(callerRole, targetRole)` throws 403
   `ForbiddenException` with the allowed list in the message on any
   escalation attempt.
3. Local `isValidEmail` (regex match) + `validatePassword` (8-200 char
   bound) helpers, identical to `onboarding.service.ts`.
4. Both endpoints now validate role + (where applicable) email + password
   before any Prisma write. Email is `.trim().toLowerCase()` normalized
   to match invite-path behavior.

Existing logic (argon2 hash params, tenant scoping, response shape) is
unchanged.

**Files changed:**
- `apps/api/src/users/users.controller.ts:1` — added
  `BadRequestException, ForbiddenException` to NestJS import.
- `apps/api/src/users/users.controller.ts:9-51` — new
  `ASSIGNABLE_ROLES_BY_CALLER`, `assertCallerCanAssignRole`,
  `isValidEmail`, `validatePassword`.
- `apps/api/src/users/users.controller.ts:70-105` — `POST /users`
  validates email, password, and role allowlist before create.
- `apps/api/src/users/users.controller.ts:107-134` — `PUT /:id/role`
  validates role allowlist before update.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` — 21 pre-existing errors in
`screens.register.spec.ts` and `sso.service.spec.ts`, zero in `users/`.
No regressions introduced.

**Acceptance tests:**
- DISTRICT_ADMIN POST `{role: 'SUPER_ADMIN'}` -> 403 ForbiddenException.
- DISTRICT_ADMIN POST `{role: 'DISTRICT_ADMIN'}` -> 403 (cannot create
  peers).
- DISTRICT_ADMIN POST `{email: 'a@b.co', password: 'longenough', role:
  'CONTRIBUTOR'}` -> 200, user created.
- POST `{email: 'not-an-email', ...}` -> 400 BadRequestException.
- POST `{password: 'abc', ...}` -> 400 BadRequestException.
- SUPER_ADMIN PUT `/users/:id/role` with `{role: 'BOGUS'}` -> 403.

---

## player-001 — SW emergency cache: hash committed before downloads finish

**Severity:** Critical (life-safety; emergency cache silently broken).

**Bug:**
`precacheEmergency` in `apps/web/public/sw-player.js` wrote
`__edu_emergency_set_hash__` BEFORE asset downloads ran. If WiFi dropped
mid-download, the next sync short-circuited on the matching hash and never
retried -- emergency assets permanently broken until the manifest URL changed.

**Fix:**
- `fetchAndStore` now returns `boolean` (true on cached or freshly stored,
  false on network/HTTP failure).
- `precacheEmergency` collects per-asset success, then re-verifies each URL
  is present in `EMERGENCY_CACHE` after the loop. Only commits the set-hash
  when every asset is confirmed cached. On any failure, logs
  `[SW] emergency cache partial -- will retry on next sync` and leaves the
  stored hash untouched so the next sync re-runs end-to-end.
- Bumped `VERSION` from `v1` -> `v2` so existing players drop stale caches
  on activate (the new cache-key list is `edu-player-{playlist,emergency,
  meta}-v2`; the activate handler already prunes anything under
  `edu-player-` not in `ALL_CACHES`).

**Files changed:**
- `apps/web/public/sw-player.js:21-39` — VERSION v1 -> v2 + new SIZE_BY_URL
  map / SIZE_META_PREFIX.
- `apps/web/public/sw-player.js:195-266` — precacheEmergency reworked.
- `apps/web/public/sw-player.js:268-340` — fetchAndStore returns success.

**Acceptance test:**
1. Throttle network in DevTools, push a fresh `PRECACHE_EMERGENCY` message.
2. Force offline mid-download.
3. Restore network; trigger another `PRECACHE_EMERGENCY` with same setHash.
4. Expect: missing assets get re-fetched (not skipped). After all succeed
   the set-hash writes; the next push with the same hash short-circuits.
5. `PRECACHE_EMERGENCY_DONE` broadcast now includes `{complete, failures}`
   so the page can surface "emergency cache is partial" in the dashboard.

---

## player-002 — sumCacheBytes used missing content-length header

**Severity:** High (soft cap eviction never fired; dashboard reported 0 B).

**Bug:**
Supabase Storage responses are CORS/opaque and have no `content-length`
header. `sumCacheBytes` (and the playlist-eviction inner loop) read
`response.headers.get('content-length')` and got `0` for every asset.
Soft cap never triggered; `STATUS_REPLY` always reported `bytes: 0`.

**Fix:**
- New `measureResponseSize(res, asset)`: prefers `asset.size` from manifest,
  falls back to `content-length`, last resort `(await res.clone().blob()).size`.
- `fetchAndStore` calls it at write time and stores the result in
  `SIZE_BY_URL` (in-memory Map<normUrl, bytes>) AND mirrors it to META_CACHE
  under `/__edu_meta_size__/<encoded-url>` so a cold-boot SW can rehydrate
  without re-cloning.
- New `getCachedEntrySize(req, cache, meta)`: in-memory map -> META_CACHE
  -> one-time blob clone (then memoized).
- `sumCacheBytes` and the playlist-eviction loop both call
  `getCachedEntrySize` instead of trusting headers.
- All eviction paths now also delete the size-meta entry and the in-memory
  map slot to keep the three sources consistent.

**Files changed:**
- `apps/web/public/sw-player.js:32-39` — SIZE_BY_URL + SIZE_META_PREFIX.
- `apps/web/public/sw-player.js:147-153` — playlist eviction clears size meta.
- `apps/web/public/sw-player.js:179-192` — soft-cap eviction uses
  getCachedEntrySize.
- `apps/web/public/sw-player.js:268-340` — fetchAndStore captures size via
  measureResponseSize.
- `apps/web/public/sw-player.js:382-441` — sumCacheBytes +
  getCachedEntrySize.
- `apps/web/public/sw-player.js:451-453` — sizeMetaKey helper.

**Acceptance test:**
1. Pre-cache a Supabase-hosted MP4 via `PRECACHE_PLAYLIST`.
2. Send `STATUS_REQUEST` -> expect `playlist.bytes` matching the file size
   (was 0 before).
3. Reload the SW; `STATUS_REQUEST` still returns the right bytes
   (rehydrated from META_CACHE without re-fetching the body).
4. Push enough assets to exceed `softCapBytes` -> oldest entries get
   evicted until total drops back under cap (was never firing before).

---

## player-003 — USB export silently flips usbIngestEnabled + mints HMAC key

**Severity:** High (security; turns opt-in feature into opt-out).

**Bug:**
`POST /api/v1/usb-export/bundle` auto-flipped `Tenant.usbIngestEnabled`
from false to true on first call AND silently minted a fresh HMAC signing
key without any operator confirmation. Contradicts CLAUDE.md Sprint 7's
"default false; admins must opt in" stance and turns USB ingest -- an
attack surface that can update emergency content -- into an opt-out.

**Fix:**
When `tenant.usbIngestEnabled === false`, throw 403
`{ error: 'USB_INGEST_DISABLED', message: '... Settings -> USB ...' }`.
Operator must enable the toggle in the UI (which writes through a
separate, audited tenant-update path). Key minting still happens on
demand if `usbIngestKey` is null, but only AFTER ingest is already
enabled — that's an internal implementation detail of having USB on,
not a separate consent decision.

**Files changed:**
- `apps/api/src/usb-export/usb-export.controller.ts:171-200` — replaced
  silent auto-provision with 403 gate; key minting happens only when
  ingest is already enabled.

**TypeScript check:** `cd apps/api && npx tsc --noEmit` — zero new
errors. Pre-existing `screens.register.spec.ts` / `sso.service.spec.ts`
spec errors are unrelated.

**Acceptance test:**
1. New tenant (`usbIngestEnabled = false`). POST
   `/api/v1/usb-export/bundle` as SCHOOL_ADMIN -> 403 with
   `{ error: 'USB_INGEST_DISABLED', message: '...Settings -> USB...' }`.
2. DB check: `usbIngestEnabled` still false; `usbIngestKey` still null.
3. Flip `usbIngestEnabled = true` via Settings -> USB. Re-POST -> 200
   ZIP attachment; `usbIngestKey` minted on this call.
4. Re-POST again -> 200; key not rotated.

---

## emergency-002 — All-clear hardcodes overrideId='global_clear'

**Severity:** Critical (life-safety + forensic integrity).

**Bug:**
`apps/web/src/actions/trigger-emergency.ts` posted every all-clear to
`/api/v1/emergency/global_clear/all-clear` -- a literal URL segment,
not the `overrideId` returned by the matching trigger. Every clear
landed in `AuditLog.details.overrideId` as the same string, breaking
the chain-of-custody an incident reviewer needs to pair a specific
trigger event with the operator who cleared it. With concurrent
emergencies (two simultaneous tenants on a SUPER_ADMIN session, or
two operators clicking All Clear in quick succession) the forensic
trail becomes ambiguous.

**Fix:**
1. `broadcastEmergency` now reads the `overrideId` from the API
   response JSON and surfaces it on the success return value, so
   callers can hand it to a paired all-clear.
2. `allClearEmergency` accepts an optional `overrideId` param. If
   provided, it is URL-encoded and passed through to the backend.
   If absent (current callers do not track it), we mint
   `clear_${crypto.randomUUID()}` so each clear remains uniquely
   identifiable in the audit log instead of all colliding on the
   same literal string.

Existing callers in `EmergencyOverlay.tsx` and `EmergencyPanel.tsx`
keep working unchanged -- they hit the auto-minted-uuid path, which
is the correct behavior given they do not track the trigger's
overrideId today. New callers wanting strict pairing pass the
`overrideId` returned by `broadcastEmergency`.

**Files changed:**
- `apps/web/src/actions/trigger-emergency.ts:13-46` -- return
  `overrideId` from `broadcastEmergency`.
- `apps/web/src/actions/trigger-emergency.ts:49-86` -- accept
  optional `overrideId` on `allClearEmergency`, fall back to
  `clear_<uuid>` instead of literal `'global_clear'`.

**Acceptance test:**
Trigger two emergencies from one operator, then call all-clear twice.
`SELECT details FROM audit_logs WHERE action='CLEAR_EMERGENCY' ORDER BY created_at DESC LIMIT 2;`
Both rows now show distinct `overrideId` values
(`clear_<uuid-A>`, `clear_<uuid-B>`) instead of two
`"overrideId":"global_clear"` rows. New caller that passes the
real `overrideId` from the trigger response shows the matching
trigger's id in the clear audit row.

---

## emergency-003 — Device-scope all-clear leaves stale ScreenEmergencyOverride

**Severity:** Critical (life-safety -- screen stuck on lockdown after clear).

**Bug:**
`apps/api/src/emergency/emergency.controller.ts` `clearEmergency`
handled `scopeType === 'tenant'` correctly (deletes all
`ScreenEmergencyOverride` rows in a transaction with audit) but the
`else` branch -- which handled both `device` and `group` scopes --
only wrote an `AuditLog` row. Result: when an operator scoped an
all-clear to a single screen, the per-screen override row stayed
in the database. The current process saw the WS broadcast and
exited override mode, but on the next reboot or full-cache rehydrate
the player re-read the override row and got stuck on lockdown again
-- exactly the post-clear failure mode the player's
`ScreenEmergencyOverride > Tenant.emergencyStatus` priority is
designed to avoid.

**Fix:**
Split the `else` into an explicit `else if (scopeType === 'device')`
branch that deletes `ScreenEmergencyOverride` for the targeted
`screenId` (also scoped by `tenantId: ownedTenantId` for defense-
in-depth). The delete + audit are wrapped in a single
`prisma.client.$transaction([...])` so they cannot drift apart.
The remaining `else` covers `group` scope (no per-screen row to
clean up at this layer).

**Files changed:**
- `apps/api/src/emergency/emergency.controller.ts:520-553` --
  device branch added to `clearEmergency`, with atomic
  `screenEmergencyOverride.deleteMany` + `auditLog.create`
  transaction.

**Acceptance test:**
1. Trigger `POST /api/v1/emergency/screens/:screenId/trigger` with
   type=LOCKDOWN. Confirm a row exists in `ScreenEmergencyOverride`.
2. Clear via `POST /api/v1/emergency/:overrideId/all-clear` with
   `{ scopeType: 'device', scopeId: <screenId> }`.
3. `SELECT * FROM screen_emergency_overrides WHERE screen_id = ?`
   returns 0 rows.
4. `SELECT * FROM audit_logs WHERE target_id = ? AND action='CLEAR_EMERGENCY'`
   returns 1 row.
5. Reboot the player; it does NOT re-render the lockdown.

---

## emergency-004 — DISTRICT_ADMIN with undefined tenantId can bulk-trigger across tenants

**Severity:** Critical (security -- cross-tenant emergency injection).

**Bug:**
`apps/api/src/emergency/screen-emergency.controller.ts` (Sprint 8b
per-screen emergencies) read `req.user.tenantId` blind on every
handler. Prisma silently strips `undefined` filter values, so
`findMany({ where: { id: { in: screenIds }, tenantId: undefined } })`
returns matching screens ACROSS ALL TENANTS. A DISTRICT_ADMIN whose
JWT was missing tenantId (malformed token, mid-deploy auth state
drift, or any upstream pipeline bug) could bulk-trigger emergencies
on every screen in the entire fleet simply by enumerating screen
ids. The same hole existed on every handler that called
`resolveScreen` (single-screen `trigger`, `allClear`, `getOverride`).

**Fix:**
1. New private helper `requireTenantId(req)` throws
   `ForbiddenException('Token missing tenantId')` if
   `req.user.tenantId` is missing, empty, or non-string. Called at
   the top of every handler before any DB call.
2. `resolveScreen` now also rejects empty/missing
   `callerTenantId` (defense-in-depth -- even if a future caller
   forgets to call `requireTenantId`, Prisma still cannot drop the
   filter).
3. Applied to: `trigger`, `allClear`, `getOverride`, `bulkTrigger`.

Existing logic (RBAC roles, `@AllowPanicBypass`, override
validation, signed pub/sub broadcast, audit writes) is unchanged.

**Files changed:**
- `apps/api/src/emergency/screen-emergency.controller.ts:53-65` --
  added `ForbiddenException` to NestJS imports.
- `apps/api/src/emergency/screen-emergency.controller.ts:155-187` --
  new `requireTenantId` helper + tenantId guard inside
  `resolveScreen`.
- `apps/api/src/emergency/screen-emergency.controller.ts:285-303` --
  `trigger` calls `requireTenantId` first.
- `apps/api/src/emergency/screen-emergency.controller.ts:307-312` --
  `allClear` calls `requireTenantId` first.
- `apps/api/src/emergency/screen-emergency.controller.ts:360-368` --
  `getOverride` calls `requireTenantId` first.
- `apps/api/src/emergency/screen-emergency.controller.ts:375-401` --
  `bulkTrigger` calls `requireTenantId` first; comment block
  documents the original bug.

**TypeScript check:**
`cd apps/api && npx tsc --noEmit` -- only pre-existing
`screens.register.spec.ts` and `sso.service.spec.ts` errors are
present, none introduced by these changes.

**Acceptance test:**
- Hand-craft a JWT for a DISTRICT_ADMIN with the `tenantId` claim
  stripped (or use a SUPER_ADMIN whose context did not resolve).
- POST `/api/v1/emergency/screens/bulk-trigger` with
  `{ screenIds: [<a screen from another tenant>], override: { type: 'LOCKDOWN' } }`.
- Response: 403 ForbiddenException, message
  `Token missing tenantId`. No DB write. No pub/sub publish.
- Same probe against `:screenId/trigger`, `:screenId/all-clear`,
  `:screenId/override` -- all return 403.
- Normal DISTRICT_ADMIN with valid `tenantId` still gets 200 on
  legitimate requests scoped to their own tenant.
