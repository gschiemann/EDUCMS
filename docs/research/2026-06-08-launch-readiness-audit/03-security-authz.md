# Multi-Tenant Authorization & Isolation Security Audit — VenueOS (EDU CMS) API

**Date:** 2026-06-08 · Scope: `apps/api/src` (all 64 controllers + service layer) · Read-only · Agent: af714a4552cb95cc7

## Summary

**No launch-blocking cross-tenant data leak found.** The codebase enforces multi-tenant isolation with a consistent, mature pattern: every `:id` mutation does a tenant-scoped `findFirst({ where: { id, tenantId: req.user.tenantId } })` ownership check **before** mutating, and even validates body-supplied FK references (playlistId / screenId / screenGroupId) against the caller's tenant to close cross-tenant reference-injection. The classic IDOR signature — `findUnique({ where: { id } })` on a tenant-owned resource with no scope check feeding an authz decision — does **not** appear on any user-facing resource handler traced.

Authz posture is **strong / launch-ready**:
- **Guard chain:** `JwtAuthGuard` (token + revocation, fail-closed) → `RbacGuard` (`@RequireRoles` + spatial scope), applied per-controller; every privileged mutation carries a role decorator.
- **District hierarchy:** `switchTenant` and `resolveScopeTenant` confine DISTRICT_ADMIN to its own district subtree; SCHOOL_ADMIN cannot reach siblings; cross-tenant emergency triggers are 403'd by strict tenant equality.
- **SSRF:** every user/AI-URL fetch routes through `safeFetch`/`validatePublicUrl` with DNS-pinned connect-time lookup (rebind-proof), redirect re-validation, port/scheme allowlist, byte caps. Best-in-class.
- **Secrets:** no hardcoded secrets in tracked source, no `process.env.X || 'default'` fallbacks remain, the four mandated secrets + `ALLOWED_ORIGINS` boot-enforced in production, AI BYOK keys envelope-encrypted (AES-256-GCM).
- **Injection:** all `$queryRawUnsafe` use static SQL or integer-clamped non-user values — no SQLi.
- **CSRF:** enforce-by-default; every exemption is sessionless and justified (Bearer / pairing-code / SAML-signature authed).
- **Prior findings closed:** role/panic staleness window closed (downgrade + canTriggerPanic-removal call `revokeUserTokens` → per-user invalid-before epoch); JWT revocation no longer gated to production (runs in all envs, fail-closed) in both `jwt-auth.guard.ts` and `sse.controller.ts`.

All findings below are **P2/P3 hardening** — none is an exploitable cross-tenant leak.

## Cross-tenant isolation findings

| Endpoint | File:line | Missing scope check? | Verdict |
|---|---|---|---|
| `GET/PUT /templates/:id`, zones, scenes, dup, delete | templates.controller.ts:473,1318,1374 | No — `findFirst {id,tenantId}` or `isSystem` reads; tenantId required writes | **SAFE** |
| `GET /templates/:id/playback` (device) | templates.controller.ts:540 | No — device→screen.tenantId; user→tenant; 404 on mismatch | **SAFE** |
| `PUT/DELETE /assets/:id`, approve/reject/move/alt-text/folders | assets.controller.ts:1110,1151,1370,1410,1440,1503 | No — `findFirst {id,tenantId}` everywhere | **SAFE** |
| `PUT/DELETE /playlists/:id`, items, active | playlists.controller.ts | No — scoped (29 tenantId refs) | **SAFE** |
| `PATCH/DELETE /sports/sponsors/:id` | sponsors.controller.ts:193,200 → `owned(tenantId,id)` | No | **SAFE** |
| `PUT/DELETE /schedules/:id` (+ body FK validation) | schedules.controller.ts:189–224,298 | No — scopes lookup AND validates body playlistId/screenId/groupId vs tenant | **SAFE** |
| `DELETE /screen-groups/:id` | screen-groups.controller.ts:170 | No | **SAFE** |
| `GET /screens/:id/manifest` | screens.controller.ts:2500 | No — device-sub==screen.id, or tenant match, 404-not-403 | **SAFE** |
| `POST /screens/:id/game-state`, cts-manual-cue | screens.controller.ts:1788 | No — `verifyDeviceForScreen` binds JWT sub / HMAC to screen.id | **SAFE** |
| `POST /emergency/trigger` (+ playlist FK) | emergency.controller.ts:310,378 | No — `resolveScopeTenant` 403s cross-tenant; playlist scoped to ownedTenant | **SAFE** |
| `POST /tenants/switch` | tenants.controller.ts:202–230 | No — SUPER any; DISTRICT_ADMIN confined to own subtree; others 403 | **SAFE** |
| `PUT /users/:id/role`, `/can-trigger-panic`, `DELETE /users/:id` | users.controller.ts:267,379,456 | No — `{id,tenantId}` scoped; non-super tenant-match on panic | **SAFE** |
| `GET /screens/status/:deviceFingerprint` (public) | screens.controller.ts:546 | Lookup by fingerprint (high-entropy secret), no tenant on lookup | **safe-by-design** (P3-1) |
| `GET /assets/file/:filename` (public) | asset-files.controller.ts:31 | UUID filename, no tenant binding | **safe-by-design** (P3-3) |
| POS OAuth `callback` (public) | pos-oauth.controller.ts:179 | tenant resolved from signed `state` nonce | **SAFE** |

## Missing/weak authz guards
- **None exploitable.** Every state-changing endpoint reviewed carries `@UseGuards(JwtAuthGuard, RbacGuard)` + `@RequireRoles`. Genuinely unauthenticated routes (`/screens/register`, `/screens/status/:fp`, `/devices/pair`, `/billing/webhook`, `/realtime/sse`, `/assets/file/:filename`, `/fitness/youtube-live/resolve`, sponsor `:id/impression`, OTA state/crash) are each device-credential-authed (pairing code / device JWT / HMAC, CSRF-immune), signature-authed (Stripe), or deliberate public read paths with per-IP/per-key rate limits + server-side tenant resolution. All documented with their threat model in-code.
- `super/*` is class-level `@RequireRoles(SUPER_ADMIN)` — correct.

## Secrets / injection / SSRF / CSRF
- **Secrets:** git grep for `sk-ant`/`sk-`/`whsec_`/`re_`/`AIza`/`eyJ`/PRIVATE KEY → **zero hits** in tracked source. No `|| 'literal-secret'` fallbacks. `.env` untracked. `required-secret.ts` throws at boot in prod for the four secrets; `ALLOWED_ORIGINS` boot-enforced (main.ts:145).
- **Injection:** all `$queryRawUnsafe` (super-license.controller.ts:285/467, webhook-retry.worker.ts:93) use static SQL or `Math.floor(batch)` clamps — **no user interpolation, no SQLi**.
- **SSRF:** `safe-fetch.ts` is a model implementation — up-front `validatePublicUrl` (scheme/port 80,443-only/IP-literal block), DNS-resolve-and-reject-private, **connect-time `ssrfSafeLookup` pin closing the DNS-rebind TOCTOU**, redirect re-validation (≤3), byte caps. Used by proxy, integrations/discover, data-source, streaming, geocoding, youtube-live, webhook delivery. No raw `fetch(userUrl)` found.
- **CSRF:** enforce-by-default (`csrf.middleware.ts:165`); exemptions limited to sessionless flows (login/signup/reset/invite — hashed single-use tokens + rate limit), device endpoints (Bearer/pairing-code), SAML/OIDC callbacks (assertion-signature). No browser-cookie-authed mutation is exempted.

## Findings ranked

### P2 — fix before scale, not launch-blocking

**P2-1 · `passport-saml@3` CVE-2025-54419, self-enableable by DISTRICT_ADMIN.** SSO/SAML callbacks (`/auth/sso/:tenant/saml/callback`) are CSRF-exempt and trust the SAML assertion signature; a vulnerable passport-saml weakens that single trust anchor, and a DISTRICT_ADMIN can configure SSO for their own tenant. *Fix:* upgrade passport-saml / @node-saml to a patched line; pin in lockfile; `pnpm hygiene:deps` to confirm. Evidence: csrf.middleware.ts:32; sso.controller.ts.

**P2-2 · `canTriggerPanic`/`role` read from JWT claim at trigger time, not re-checked against the live DB.** RbacGuard reads `typedUser.canTriggerPanic` from the token (rbac.guard.ts:66). Mitigated by revocation epoch on downgrade/removal (users.controller.ts:434,314) — but the mitigation depends on Redis being up at the moment of the privilege change (`revokeUserTokens` only warns on Redis failure, users.controller.ts:91-95). If Redis is down during the downgrade write, the stale `canTriggerPanic:true` claim survives until token expiry (up to 30d). *Fix:* re-read `User.canTriggerPanic` from the DB for the bypass path on emergency trigger (one indexed read on a life-safety action), OR make the revocation write durable (DB-backed `tokenInvalidBefore` column read by the guard).

### P3 — hardening / defense-in-depth

**P3-1 · `GET /screens/status/:deviceFingerprint` unauthenticated, returns `name`+`pairingCode`+version/OTA, writes `lastPingAt`/`status` every call** (screens.controller.ts:525-711). Gated only by fingerprint secrecy + the per-fingerprint register cooldown (which is on `/register`, not this route — this route has only global 600/min/IP). An attacker who learns a fingerprint can keep a revoked/offline screen showing ONLINE and read its pairing code. *Fix:* require the device JWT (player already holds one), or drop `pairingCode` from the response once `tenantId` is set, and add a per-fingerprint rate limit.

**P3-2 · `GET /fitness/youtube-live/resolve?url=` unauthenticated with no per-IP throttle** (youtube-live.controller.ts:60). SSRF-safe + result-cached, but anonymous callers can drive unbounded outbound YouTube scrapes through your server IP (reputation / soft-DoS). *Fix:* add `@Throttle` and/or `@UseGuards(JwtAuthGuard)`.

**P3-3 · `GET /assets/file/:filename` serves local-disk files by UUID with no tenant binding** (asset-files.controller.ts). Path-traversal blocked (regex + reject + resolve-prefix), filenames unguessable UUIDs, but no per-tenant authz — anyone with a filename fetches any tenant's locally-stored asset. Small blast radius (Supabase is primary store). *Fix (optional):* sign the URL with a short-lived token if local-disk serving is ever load-bearing in prod.

---

**Bottom line for the launch gate:** the cross-tenant isolation model is sound and consistently applied; no proven exploitable IDOR, no missing guard on a mutation, no injection, no open SSRF, no hardcoded secret, and the two prior known gaps (revocation env-gating, panic/role staleness) are largely closed. Clear the P2-1 dependency CVE and decide on the P2-2 DB-recheck for the life-safety path; the P3 items are post-launch defense-in-depth.
