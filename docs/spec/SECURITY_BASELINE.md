# Security Baseline & Controls — VenueOS (EDU CMS)

**Status:** Current / living. **Last verified against code:** 2026-11-09.
**Supersedes:** `docs/archive/2026-04-original-design/SECURITY_BASELINE.md`
(a 2026-04-13 aspirational fossil that asserted controls VenueOS never built —
e.g. "mandatory malware scanning before READY," `SameSite=Strict`. Those were
goals written as facts).

**Rule for this file:** every line is either a **SHIPPED** control cited to
the function / symbol and file that implement it, or a **KNOWN GAP** with a
tracking reference (`SECURITY_GAPS.md`). Nothing in between. A baseline that
overstates controls is false assurance to a district IT reviewer and the exact
"theater" pattern that burned us (`feedback_audits_must_be_exhaustive`,
2026-05-21). Citations use symbols, not line numbers. Paths are relative to
`apps/api/src/` unless they start with `apps/`, `packages/`, `docs/`,
`scripts/` or `.github/`. The threat-by-threat view with residuals is
`THREAT_MODEL.md`.

---

## 1. Cryptography & data protection — SHIPPED

- **Password hashing: Argon2id**, `memoryCost 64 MB`, `timeCost 3`,
  `parallelism 4` (~45 ms verify). `cryptoPlatformConfig` (`auth/crypto.config.ts`);
  `AuthService.hashPassword` (`auth/auth.service.ts`). Salt is per-hash, carried in
  the `$argon2id$` string.
- **HTTPS / HSTS** — Helmet HSTS `max-age=31536000; includeSubDomains; preload`;
  TLS terminates at the Railway/Vercel edge. `helmet(...)` in `main.ts`.
- **Secrets at rest** — TOTP secrets, streaming / POS / ads / social credentials
  and BYOK AI keys sealed with AES-256-GCM under keys derived from the
  `DEVICE_SECRET_KEY` ring (`masterKeysFor`, `security/key-ring.ts`;
  `auth/mfa-secret-cipher.ts`, `streaming/creds-cipher.ts`, `ai/ai-key-cipher.ts`).
  Clever OAuth tokens use a separate `CLEVER_ENCRYPTION_KEY`
  (`integrations/clever/clever-crypto.ts`) — **not** on a rotation ring (gap G13).
  MFA backup codes are Argon2id hashes (`auth/mfa-backup-codes.ts`). Remember-me
  refresh secrets are stored only as SHA-256 (`hashRefreshSecret`,
  `auth/session-refresh.service.ts`). API keys are stored only as SHA-256
  (`ApiKeysService`, `api-keys/api-keys.service.ts`).
- **Boot-time secret validation** — production refuses to start if
  `JWT_SECRET` / `SESSION_SECRET` / `DEVICE_SECRET_KEY` / `DEVICE_JWT_SECRET`
  are missing or < 16 chars, or if a `*_PREVIOUS` equals its primary.
  `assertRequiredSecretsAtBoot` (`security/required-secret.ts`);
  `assertKeyRingsAtBoot` (`security/key-ring.ts`), both called from `bootstrap()` in `main.ts`.
- **Windowed key rotation (2026-10-22)** — `DEVICE_JWT_SECRET` and
  `DEVICE_SECRET_KEY` accept an optional `_PREVIOUS` companion used for
  verify/decrypt only; a re-wrap job re-seals stored ciphertext; the finish
  script refuses to close a window while a live screen lacks a new-key token.
  `deviceJwtSecretRing` / `deviceSecretKeyRing` (`security/key-ring.ts`);
  `KeyRotationRewrapService` (`security/key-rotation-rewrap.service.ts`);
  `scripts/railway-rotation.mjs`; runbook `docs/SECRET-ROTATION.md`.
- **Database TLS** — the Supabase CA ships in the API image (the `Dockerfile`
  fails the build when it is missing or near expiry); boot warns on a
  verification spelling Prisma ignores (`warnIneffectiveDbTlsSettings`,
  `security/required-secret.ts`). Strict verification itself is a property of
  the production URL (`sslaccept=strict`), i.e. configuration, not code.

## 2. Authentication & sessions — SHIPPED

- **Two token systems** — user JWT (signed `JWT_SECRET`, **1 h, always**,
  `signOptions` in `auth/auth.module.ts`; `AuthService.login`) and device JWT
  (`kind:'device'`, `DEVICE_JWT_SECRET` ring, 180 d paired / 15 min unpaired /
  1 h unproven, `screens/device-auth.ts`). The guard selects the verifier from
  the unverified `kind` and pins algorithms. `JwtAuthGuard.canActivate`
  (`auth/jwt-auth.guard.ts`); `USER_JWT_ALGORITHMS`; `DEVICE_JWT_ALGORITHMS`.
- **Remember-me = rotating refresh token (SEC-010, 2026-09-05)** — opaque,
  single-use, rotating secret in an HttpOnly first-party cookie; reuse revokes
  the whole family; 30-day family ceiling from the original credential check.
  `SessionRefreshService.rotate` (`auth/session-refresh.service.ts`);
  `SessionController` (`auth/session.controller.ts`).
- **Sliding refresh** — re-mints from the live user row, capped at 12 h
  (session) / 30 d (remember-me) from `origIat`, refuses revoked, disabled,
  archived, switched-workspace and MFA-non-compliant sessions.
  `AuthService.refreshSession`; `AuthController.refresh`.
- **Token revocation, fail-closed** — logout writes the token to
  `jwt_revoked_list` (extend-only TTL) and a durable Postgres mirror; the guard
  checks both on every request in every environment and denies when neither can
  answer, except a ≤ 10-minute device-GET continuity window for the emergency
  manifest backstop. `AuthController.logout`; `JwtAuthGuard.canActivate`;
  `RedisService.mirrorRevokedTokenDurable`; `security/revocation-posture.ts`.
- **Per-user mass revocation** — "invalid-before" epoch on role /
  `canTriggerPanic` downgrade and password change. `RedisService.getTokenInvalidBefore`.
- **Partial-flow tokens refused as sessions** — any token with a `purpose`
  claim (the MFA challenge token) is rejected by the guard. `JwtAuthGuard.canActivate`.
- **Session cookie** — `edu_cms_sid`, `httpOnly`, `secure` in prod,
  `sameSite:'none'` in prod (Vercel→Railway cross-site) / `'strict'` in dev,
  8 h rolling idle, Redis-backed store. `session({...})` in `main.ts`;
  `security/redis-session.store.ts`.
- **MFA** — TOTP (provisional-secret enrolment, single-use hashed backup codes,
  challenge-token step), email-code fallback, and **WebAuthn passkeys**
  (`userVerification: 'required'`, origin + RP-ID verified, single-use challenge).
  `auth/mfa.controller.ts`; `auth/mfa-email-code.controller.ts`;
  `PasskeyController` (`auth/passkey.controller.ts`); `auth/webauthn-challenge-store.ts`.
- **MFA required** for SUPER/DISTRICT/SCHOOL_ADMIN and every panic-capable user
  from 2026-10-04 (`MFA_REQUIRED_ENFORCE_AFTER`; `off` is the logged
  break-glass), plus per-tenant enforcement. `evaluateMfaPolicy`,
  `MFA_REQUIRED_ROLES` (`auth/mfa-policy.ts`); `tenantMfaEnforced`
  (`auth/tenant-mfa-enforcement.ts`).
- **Device credential** — HS256-pinned, `credentialEpoch` checked against the
  live Screen row, identity read from the live row, unproven credentials refused
  on writes. `verifyDeviceForScreen` / `admitDeviceCredential` (`screens/device-auth.ts`);
  `DeviceIdentityInterceptor` (`security/device-identity.interceptor.ts`).

## 3. Defense against abuse — SHIPPED (with gaps)

- **Rate limiting** — `@nestjs/throttler` backed by a **Redis** store, so limits
  hold across replicas (`RedisThrottlerStorage`, `realtime/redis-throttler-storage.ts`,
  wired in `app.module.ts`); login 10/min/IP (`AuthController.login`); client IP
  derived behind Railway's proxy (`trust proxy` in `main.ts`; `security/client-ip.ts`).
- **Per-account login backoff** — 15-minute soft lock at 20 failures, audited
  (`LoginAttemptLimiter`, `auth/login-attempt-limiter.ts`).
- **MFA brute-force throttle** — per-user TOTP attempt limiter
  (`MfaRateLimiter`, `auth/mfa-rate-limiter.ts`) — **in-process, per replica** (gap G5).
- **AI per-tenant hourly caps** in Redis (`ai/ai.service.ts`, P1-14); branding
  scrape limiter is still in-process (`BrandingRateLimiter`,
  `branding/branding-rate-limiter.ts`) (gap G5).
- **"Anomaly middleware"** — *(corrected 2026-11-09)* `AnomalyMiddleware`
  (`security/anomaly.middleware.ts`) only logs a request with **no User-Agent**;
  its own comment calls it a mock. It is not anomaly detection and must not be
  presented as one (gap G6).
- *(Impossible-travel / geo-shift detection is **not built** — do not claim it.)*

## 4. Input / output security — SHIPPED (with one gap)

- **API CSP** — Helmet: `defaultSrc 'self'`, `scriptSrc 'self'`, `objectSrc 'none'`. `helmet(...)` in `main.ts`.
- **Dashboard CSP** — enforced nonce-based `script-src` on dashboard documents,
  no `'unsafe-inline'`; prerendered routes excluded by a checked list.
  `dashboardDocument` (`apps/web/src/proxy.ts`); `apps/web/src/lib/csp-script-policy.ts`;
  `apps/web/tools/check-csp-prerender.cjs`. The `/player` policy is report-only.
- **Board isolation** — boards render in `sandbox="allow-scripts"` iframes with
  no `allow-same-origin` (`SCALED_WEB_SANDBOX`, `apps/web/src/app/player/page.tsx`).
- **HTML/SVG sanitization** — `sanitize-html` allowlist in `AssetSanitizerService`
  (`security/asset-sanitizer.service.ts`); DOMPurify for logo SVG (`sanitizeLogoSvg`,
  `branding/sanitize-svg.ts`).
- **CSRF — enforced by default** — double-submit cookie+header, constant-time
  compare, audited exempt list, Bearer requests exempt. `CsrfMiddleware`,
  `EXEMPT_PATHS` (`security/csrf.middleware.ts`).
- **CORS — fails closed in prod** — boot aborts without `ALLOWED_ORIGINS`. `main.ts`.
- **SSRF guard on user-supplied outbound URLs** — scheme/port/private-IP block,
  DNS re-check, connect-time rebind pin, ≤ 3 re-validated redirects, byte and
  decompression caps, 8 s timeout. `safeFetch` / `safeFetchPost` (`branding/safe-fetch.ts`).
- **Renderer has no network** — interception + `connect-src 'none'` + resolver
  lockdown flags. `apps/renderer/src/network.ts`.
- **Upload format allowlist + SVG block** — controller intent check and bucket
  MIME allowlist both reject SVG on the public `assets` bucket; legacy video
  containers and HEIC are accepted and converted server-side.
  `AssetsController.assertUploadIntent` (`assets/assets.controller.ts`);
  `ASSETS_BUCKET_MIME_TYPES` (`storage/supabase-storage.service.ts`).
- **Upload content check** — decode check of stored bytes before an Asset row
  exists, external tools under a SIGKILL timeout. `UploadContentCheckService`
  (`assets/upload-content-check.service.ts`); `runTool` (`assets/tool-runner.ts`).
- **Private buckets + short-TTL signed URLs** for floor plans, design-import
  originals and device logs. `FLOORPLAN_BUCKET`, `DEVICE_LOGS_BUCKET`
  (`storage/supabase-storage.service.ts`).
- **KNOWN GAP — no malware scanning on upload** (G1).

## 5. Realtime / emergency integrity — SHIPPED

- **Server-side HMAC fan-out gate, channel-bound** — every signed message is
  verified against the `DEVICE_SECRET_KEY` ring and the channel it arrived on
  before reaching any WS or SSE client. `RedisService.handleRedisMessage`
  (`realtime/redis.service.ts`); `verifyWsHmac`, `bindWsSignatureToChannel`
  (`security/ws-signature.ts`).
- **Freshness + replay defense** — 120 s server window + skew guard; player
  30 s window + per-`eventId` LRU across WS and SSE. `WS_SIG_MAX_AGE_MS`;
  `checkSensitivePush` (`apps/web/src/app/player/pushGate.ts`).
- **Constant-time signature compare** — `crypto.timingSafeEqual` with length
  check (`security/ws-signature.ts`).
- **HTTP backstop** — `GET /screens/:id/emergency-rev` + the device-authenticated
  manifest. `screens/emergency-rev.ts`; `ScreensController.getManifest`.
- **Emergency-rev raise confirmed by the database (2026-11-01)** — a raise
  descriptor is signed only when the tenant row confirms the same live alert.
  `descriptorMatchesConfirmed`, `resolveEmergencyRev` (`screens/emergency-rev.ts`);
  `confirmTenantWideAlert` (`screens/tenant-emergency-state.ts`).
- **Delegated panic** — `@AllowPanicBypass` widens the role check to
  `canTriggerPanic` users (never `RESTRICTED_VIEWER`), emergency routes only.
  `RbacGuard.canActivate` (`auth/rbac.guard.ts`).
- **Gated in CI** — the chromium and webkit emergency-path checks are required
  status checks on `master`.

## 6. SSO / identity federation — SHIPPED behind an enabled-gate

- **SAML + OIDC** with a per-tenant enabled-gate: unconfigured tenants return
  `{ enabled: false }`. `sso/sso.controller.ts` (`config-public` route).
- **SSO callbacks are CSRF-exempt** — the IdP POST cannot carry our cookie; the
  assertion signature is the authenticity proof. `EXEMPT_PATHS` (`security/csrf.middleware.ts`).
- **Clever SIS** fetches only `admins` / `teachers` / `staff` — never student
  rosters. `integrations/clever/clever-http.client.ts`. See `COMPLIANCE.md`.

## 7. Billing / PCI — SHIPPED (SAQ-A)

- **Card data never touches our servers** — Stripe Checkout + Billing Portal are
  hosted sessions. `stripe.checkout.sessions.create` / `stripe.billingPortal.sessions.create`
  in `billing/stripe.service.ts`.
- **Webhook signature verified** against `STRIPE_WEBHOOK_SECRET`; raw body
  captured by a dedicated parser. `StripeService.constructWebhookEvent`;
  `billing/billing-webhook.controller.ts`.
- **License↔Stripe reconcile cron** (`billing/license-reconcile.cron.ts`).

## 8. Audit & forensics — SHIPPED

- **DB-level append-only `audit_logs`** — UPDATE/DELETE and TRUNCATE raise.
  Migrations `20260531000000_audit_logs_immutable`, `20260717120000_audit_logs_block_truncate`;
  pinned by `security/audit-immutability.spec.ts`.
- **Real domain audit rows** on privileged actions (emergency trigger /
  all-clear / drill, login success/failure/lock, refresh, logout, MFA and
  passkey events, API-key use, support-access grants and actions, key re-wrap,
  Stripe→License, submissions, template/sponsor CRUD). Grep `auditLog.create`.
- **Support-access attribution** — every audit row written during a granted
  request carries `supportGrantId`. `SupportAccessInterceptor`
  (`support-access/support-access.interceptor.ts`).
- **The global HTTP interceptor is an operational breadcrumb, not the audit
  log.** `RequestLogInterceptor` (`security/request-log.interceptor.ts`).
- **Log context** — `tenantId`, `userId` or `apiKeyId`, `action`, `targetType`,
  `targetId`, `details`, `createdAt`. *(Before/after diffs are NOT universally
  captured — do not claim full state-diffing.)*

## 9. Tenancy & staff access — SHIPPED

- **Tenant-isolation gate** — static analyzer fails CI on a new bare-id lookup
  (baseline 0); the two-tenant × role matrix is a required check.
  `apps/api/tools/check-tenant-isolation.cjs`; `tenant-isolation/two-tenant-role-matrix.spec.ts`.
- **Customer-approved support access** — SUPER_ADMIN reach to a customer tenant
  requires an active grant; fails closed. `SupportAccessService.reach`
  (`support-access/support-access.service.ts`).
- **Organisation suspend** — blocks people and API keys, never screens or
  emergencies; fails open. `OrgSuspensionGate` (`customers/org-suspension.interceptor.ts`).

## 10. Supply chain & delivery — SHIPPED (partly report-only)

- Production advisory audit on every push and hourly (`scripts/npm-advisory-audit.cjs`).
- Trivy container scan, blocking job (`.github/workflows/ci.yml`, `.trivyignore.yaml`).
- Node runtime security-release watch, hourly (`scripts/check-node-security.cjs`).
- gitleaks (`ci.yml`); keystore guard (`scripts/check-tracked-keystores.cjs`).
- OSV-Scanner on the APK's Gradle lock — report-only (`player-kotlin-check.yml`).
- Action SHA-pin drift check — report-only (`.github/scripts/check-action-pins.cjs`).
- Typed env schema; CI fails on an undeclared environment read
  (`apps/api/src/config/env-schema.ts`; `apps/api/tools/check-env-declared.cjs`).
- Ruleset on `master`: pull request required + nine required status checks.

---

## Quick reference — control → callsite

| Control | Symbol (file) |
|---|---|
| Argon2id params | `cryptoPlatformConfig` (`auth/crypto.config.ts`) |
| Login timing equalizer | `AuthService.validateUser` (`auth/auth.service.ts`) |
| Per-account login lock | `LoginAttemptLimiter` (`auth/login-attempt-limiter.ts`) |
| JWT verifier selection + alg pin | `JwtAuthGuard.canActivate` (`auth/jwt-auth.guard.ts`) |
| Token revocation (fail-closed, all envs) | `JwtAuthGuard.canActivate`; `security/revocation-posture.ts` |
| Rotating refresh token | `SessionRefreshService.rotate` (`auth/session-refresh.service.ts`) |
| MFA required policy | `evaluateMfaPolicy` (`auth/mfa-policy.ts`) |
| Passkeys | `PasskeyController` (`auth/passkey.controller.ts`) |
| Boot-time required secrets | `assertRequiredSecretsAtBoot` (`security/required-secret.ts`) |
| Key rings / rotation | `security/key-ring.ts`; `security/key-rotation-rewrap.service.ts` |
| Helmet CSP + HSTS, session cookie, CORS | `main.ts` |
| Dashboard CSP | `dashboardDocument` (`apps/web/src/proxy.ts`) |
| CSRF enforce-by-default | `CsrfMiddleware` (`security/csrf.middleware.ts`) |
| SSRF safe-fetch + rebind pin | `ssrfSafeLookup`, `safeFetch` (`branding/safe-fetch.ts`) |
| SVG block (upload + bucket) | `AssetsController.assertUploadIntent`; `ASSETS_BUCKET_MIME_TYPES` |
| Emergency HMAC fan-out gate | `RedisService.handleRedisMessage`; `verifyWsHmac` |
| Emergency-rev DB confirmation | `descriptorMatchesConfirmed` (`screens/emergency-rev.ts`) |
| Device credential | `verifyDeviceForScreen` (`screens/device-auth.ts`) |
| Support access | `SupportAccessInterceptor` (`support-access/`) |
| Tenant-isolation gate | `apps/api/tools/check-tenant-isolation.cjs` |
| SSO enabled-gate | `sso/sso.controller.ts` |
| Clever staff-only scope | `integrations/clever/clever-http.client.ts` |
| Stripe hosted checkout (SAQ-A) | `billing/stripe.service.ts` |
| Audit-log DB immutability | `packages/database/prisma/migrations/20260531000000_audit_logs_immutable/`, `20260717120000_audit_logs_block_truncate/` |

## Known gaps (tracked, NOT done) — detail in `SECURITY_GAPS.md`

| Gap | Mitigation today | Register |
|---|---|---|
| No upload malware scanning | format allowlist + content check + SVG block | G1 |
| Every key in one environment; symmetric emergency signing | windowed device-key rotation + re-wrap + alarms | G12 |
| No rotation window for `JWT_SECRET` / `SESSION_SECRET` / `CLEVER_ENCRYPTION_KEY` | straight swap (signs everyone out) | G13 |
| Repo PUBLIC on GitHub; tracked research files name customers | gitleaks + secret scanning | G4, G16 |
| In-process MFA / branding-scrape limiters | single API replica | G5 |
| No anomaly / impossible-travel detection | rate limits + login lock + audit rows | G6 |
| USB package key shared by every screen of a tenant | HMAC + per-file SHA-256 + tenant check | G14 |
| Support-access exempt prefixes are prose | grant gate on everything else | G15 |
