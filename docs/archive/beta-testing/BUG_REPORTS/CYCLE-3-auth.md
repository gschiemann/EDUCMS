# Cycle 3 — auth retest — 2026-05-03

## Cycle 1+2 fix verification

- auth-001: VERIFIED · `apps/api/src/sso/sso.controller.ts:203-236` · `assertTenantAccess()` helper resolves target by slug, returns 404 if missing, allows SUPER_ADMIN, own-tenant, or DISTRICT_ADMIN-of-parent; otherwise 403. Called from `getConfig:145`, `upsertConfig:165`, `testConfig:178`. Cross-tenant SSO write closed.
- auth-002: VERIFIED · `apps/api/src/users/users.controller.ts:13-38` · `ASSIGNABLE_ROLES_BY_CALLER` map + `assertCallerCanAssignRole` correctly excludes SUPER_ADMIN as an assignable target (no self-promotion path). `POST /users` (line 85) and `PUT /:id/role` (line 119) both gate. Email + password validators run before hash. Note: `SCHOOL_ADMIN` row in the allowlist is dead because the route decorator restricts to SUPER_ADMIN/DISTRICT_ADMIN — harmless.
- auth-003: VERIFIED · `apps/api/src/schedules/schedules.controller.ts:74-101` (POST) and `:182-199` (PUT) · `playlistId`, `screenId`, `screenGroupId` all validated via `findFirst({ id, tenantId })` before write. `playlistId` is required on POST. Mirrors submissions pattern.
- auth-004: VERIFIED · `apps/api/src/playlists/playlists.controller.ts:76-90` · POST validates `templateId` via `findFirst` with `OR: [{ tenantId }, { isSystem: true }]`. PUT body excludes `templateId` so update path is moot.
- auth-006: VERIFIED · `apps/api/src/auth/auth.service.ts:20-26` · module-level `DUMMY_HASH_PROMISE` computed once at boot using `cryptoPlatformConfig`. User-not-found path (lines 60-65) and non-ACTIVE-user path (lines 78-81) both run `argon2.verify(dummyHash, pass, ...)` inside try/catch. Both branches pay ~45ms argon CPU cost. Login throttling already exists upstream so cold-start outlier on first request is acceptable.

## NEW bugs (cycle 3 finds)

### P0
- (none)

### P1
- BUG-011 · `apps/api/src/users/users.controller.ts:107-134` · **`PUT /users/:id/role` allows demoting SUPER_ADMIN target**. The role-allowlist gates the *assigned* role but does not check the *target user's current role*. A SUPER_ADMIN could mistakenly send `role: 'CONTRIBUTOR'` for another SUPER_ADMIN's id and the update succeeds (the `findFirst` only filters by `tenantId`, so cross-tenant SUPER_ADMINs aren't even findable, but same-tenant SUPER_ADMINs are). Realistic exploit narrow (only SUPER_ADMINs can hit the endpoint), but a single-key-leak attacker with one SUPER_ADMIN session can mass-demote every other SUPER_ADMIN in their tenant before being discovered. Fix: refuse the update when `user.role === 'SUPER_ADMIN'` unless caller has a stronger gate (e.g. requiring an env-flag or a separate `/super-admin/demote` endpoint).
- BUG-012 · `apps/api/src/schedules/schedules.controller.ts:159-172` · **`PUT /schedules/:id` body type silently drops `playlistId`**. The DTO doesn't include `playlistId` so callers that try to re-target a schedule at a different playlist receive a silent no-op (the prisma update only sets the keys present in the typed `data: any`). This isn't a security bug post-fix, but it's a UX regression — there's no error returned, the schedule still points at the old playlist, and the caller assumes the change took. Add `playlistId` to the body type, validate via the same `findFirst` pattern as create, and assign to `data` when present. Or document that re-targeting requires delete+recreate.
- BUG-013 · `apps/api/src/users/users.controller.ts:142-149` · **`Delete /users/:id` returns HTTP 200 + `{error: ...}` body** instead of `HttpException(NOT_FOUND)`. Same pattern as BUG-007 but specifically: self-delete attempt and not-found both return 200. Front-end JSON parser sees no error and may show "deleted." (Cycle 1 BUG-007 covered the same anti-pattern; the cycle 1+2 fixes did not address this controller.) Fix: throw `HttpException(..., NOT_FOUND/FORBIDDEN)`.

### P2
- BUG-014 · `apps/api/src/auth/auth.service.ts:21-26` · **`DUMMY_HASH_PROMISE` is fired at module-load with no error path**. If argon2 fails to load on a cold container (e.g. native binding glitch on Alpine), the promise rejects and stays rejected for the lifetime of the process — every "user-not-found" branch hits the catch, but timing equality holds because both `await DUMMY_HASH_PROMISE` and `await argon2.verify` complete synchronously in the rejection case. Net effect: timing oracle returns under that failure mode. Realistic: very low. Defense-in-depth fix: wrap module-level hash in `.catch(() => fallbackHash)` to guarantee it always resolves to a usable string.
- BUG-015 · `apps/api/src/users/users.controller.ts:13-29` · **`SCHOOL_ADMIN` mapping in `ASSIGNABLE_ROLES_BY_CALLER` is dead code**. The route decorator on `POST /users` only allows `SUPER_ADMIN, DISTRICT_ADMIN`, so the SCHOOL_ADMIN allowlist row is unreachable. Either drop it or open the POST decorator to SCHOOL_ADMIN (matches the pattern in onboarding.service.ts where SCHOOL_ADMIN can invite). User-facing impact: a school admin who wants to add a CONTRIBUTOR has to ask the district admin. May or may not be intended.

## GREEN

- All 5 cycle-1+2 fixes hold up. No regression to CSRF, RbacGuard, JwtAuthGuard, or tenant-switch flow.
- DISTRICT_ADMIN cross-school flow remains working: `tenants.controller.ts:160-234 switchTenant` mints a fresh JWT bound to the child tenant, so `req.user.tenantId` matches the schedule/playlist/screen rows in that scope. The new FK validation does NOT block legitimate child-school access.
- Invite flow unaffected: `ALLOWED_INVITE_ROLES` in `onboarding.service.ts:12-17` is independent of the new `ASSIGNABLE_ROLES_BY_CALLER`. Both correctly exclude SUPER_ADMIN as a self-assignable target.
- `playlists.controller.ts:147-158` asset cross-tenant check (HIGH-1 fix from earlier audit) still in place.
- `submissions.controller.ts` validation pattern unchanged and still correct.

## Notes

- BUG-011 is the only new finding I'd block on. BUG-012/013/014/015 are tractable polish.
- Did not re-audit Areas 3-6.
- Pre-existing test-file errors ignored per instructions.
