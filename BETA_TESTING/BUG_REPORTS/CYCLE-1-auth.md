# Cycle 1 — auth — 2026-05-03

## P0 (block ship)

- BUG-001 · `apps/api/src/sso/sso.controller.ts:140-172` · **Cross-tenant SSO config write**. `GET/POST /api/v1/tenants/:tenantSlug/sso` and `POST .../sso/test` accept any `tenantSlug` from URL and never verify it matches the caller's tenant. `RbacGuard` only scope-checks `params.districtId` / `params.schoolId` — `tenantSlug` isn't in that list. So a `DISTRICT_ADMIN` of `lincoln-hs` can `POST /api/v1/tenants/jefferson-hs/sso` with their own SAML/OIDC IdP config and silently take over Jefferson's login flow (next Jefferson user is redirected to attacker IdP, profile auto-provisioned, JWT minted). Same flaw lets `getConfig` leak `oidcClientId` / `entityId`. Fix: in each handler, compare resolved tenantId against `req.user.tenantId` and reject unless caller is SUPER_ADMIN or DISTRICT_ADMIN of that tenant's parent.

- BUG-002 · `apps/api/src/users/users.controller.ts:26-48` · **Unbounded role at user creation**. `POST /api/v1/users` accepts `body: { email, password, role: string }` and writes `role: body.role` directly without enum validation, password length check, or email validation. A DISTRICT_ADMIN can pass `role: 'SUPER_ADMIN'` to elevate the new user (`AppRole` is a TS const, not a Postgres enum — see `packages/database/index.ts:5`, so DB won't reject). Fix: validate against `ALLOWED_INVITE_ROLES`, run `validatePassword` + `isValidEmail` (mirror `onboarding.service.ts:191-227`).

## P1 (must fix this week)

- BUG-003 · `apps/api/src/schedules/schedules.controller.ts:95-115, 152-160` · **Schedule create/update lacks cross-tenant FK validation**. `POST /schedules` accepts `playlistId`, `screenId`, `screenGroupId` and writes them straight without verifying each id belongs to `req.user.tenantId`. Same for `PUT /:id` updates of `screenId` / `screenGroupId`. A user in tenant A can create a Schedule in their own tenant pointing at tenant B's playlist/screen. Fix: validate each id with `findFirst({ where: { id, tenantId } })` before write (the pattern submissions.controller.ts:78-89 uses).

- BUG-004 · `apps/api/src/playlists/playlists.controller.ts:66-86` · `POST /playlists` accepts `templateId` from body without verifying it's in the caller's tenant or `isSystem: true`. Allows attaching foreign templates. Fix: when `templateId` is present, `findFirst({ where: { id: templateId, OR: [{ tenantId: req.user.tenantId }, { isSystem: true }] }})`.

- BUG-005 · `apps/api/src/users/users.controller.ts:50-67` · `PUT /users/:id/role` (SUPER_ADMIN-only) doesn't validate `body.role` before writing. Any string can land in DB and break RbacGuard. Fix: same allowlist used in onboarding.

- BUG-006 · `apps/api/src/auth/auth.service.ts:31-57` · `validateUser` returns null for both unknown email and wrong password, but skips Argon2 verify when user not found. ~200ms timing differential allows email enumeration. Fix: run a dummy verify against a fixed hash on miss, or add a constant-time minimum.

## P2 (defer)

- BUG-007 · `templates.controller.ts:559-569`, `playlists.controller.ts:91-106` · Several handlers return `{ error: 'Not found' }` with HTTP 200. Front-end may treat as success. Standardize on `HttpException(..., NOT_FOUND)`.

- BUG-008 · `apps/api/src/auth/jwt.strategy.ts:19-22` · `JwtStrategy.validate` returns `{ userId, tenantId, role }` — drops `canTriggerPanic`. The codebase uses `JwtAuthGuard` (which does populate it correctly at line 96), but if anything falls back to Passport's `AuthGuard('jwt')`, panic-bypass silently breaks. Fix: align JwtStrategy payload to JwtAuthGuard's, or delete JwtStrategy.

- BUG-009 · `apps/api/src/onboarding/onboarding.service.ts:60-119` · `/signup` only has 5/min IP throttle, no CAPTCHA. Bot-net could create thousands of throwaway tenants. Pilot-tier has no usage cap.

- BUG-010 · `apps/api/src/security/anomaly.middleware.ts:1-27` · Anomaly middleware is a stub — only logs missing UA. Acceptable for pilot but Sprint 2 should add Redis-backed velocity counters.

## GREEN (verified working)

- `RbacGuard` correctly enforces DISTRICT_ADMIN ↔ districtId, SCHOOL_ADMIN ↔ schoolId scoping (rbac.guard.ts:88-114).
- `@AllowPanicBypass` + RESTRICTED_VIEWER hard-block work — `canTriggerPanic` IS in JWT payload (auth.service.ts:75) and IS read by JwtAuthGuard (jwt-auth.guard.ts:96).
- CSRF enforced by default; exemptions are tight + audited (csrf.middleware.ts:17-72). Bearer-token requests bypassed correctly per CSRF threat model.
- sessionStorage per-tab auth + localStorage migration prevents cross-tab tenant bleed (ui-store.ts:30-70). `logout()` purges both stores + `edu_cms_last_school`.
- `tenants.controller.ts switchTenant` (line 160-237) verifies parent/child relationship before issuing fresh JWT.
- assets.controller folder ops double-check tenant on mutate (541, 708, 827, 871, 884).
- `panic-content.controller.ts:241` enforces playlist.tenantId === caller on remove-asset.
- `screens.controller.ts:1201-1222` (MED-1 fix) tenant-scopes manifest reads with device-JWT / user-JWT / SUPER_ADMIN branches; 404s not 403s on cross-tenant probes (no existence leak).
- Submissions controller validates every bundled id against tenant (submissions.controller.ts:75-89).
- Password reset tokens hashed SHA-256, single-use (`usedAt`), 1h expiry. Invite tokens hashed, 7-day expiry, cross-tenant invite injection blocked (onboarding.service.ts:210-226).
- Argon2id with platform-standard params; pairing codes use `crypto.randomInt`.
- Production secret-required validation refuses boot without JWT_SECRET / SESSION_SECRET / DEVICE_SECRET_KEY / DEVICE_JWT_SECRET.
- Emergency controller (`emergency.controller.ts:191-241`) verifies caller owns scope before any mutation; correctly resolves tenant for group/device targets.

## Notes

- BUG-001 is the only unambiguous P0. Pilot tenants don't have SSO configured today (TenantSSOConfig rows would be admin-created), so impact is "potential" not "active." Must fix before any tenant clicks "Configure SSO."
- BUG-006 (timing oracle) realistic exploitability is low since `/password-reset/request` is already constant-shape (onboarding.service.ts:127). Belt-and-suspenders.
- Pre-existing `RoleGate.test.tsx` / `screens.register.spec.ts` errors ignored as instructed.
- I did NOT audit AI rate-limit, imports filename sanitization, or sample-data tag scoping — those are Areas 3 + 6.
