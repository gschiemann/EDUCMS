# Threat Model — VenueOS (EDU CMS)

**Status:** Current / living. **Last verified against code:** 2026-11-09.
**Supersedes:** `docs/archive/2026-04-original-design/THREAT_MODEL.md` (a
2026-04-13 pre-build design fossil that described a Socket.io + Postgres-RLS
architecture VenueOS never shipped). Every control below is cited to the
function or exported symbol that implements it, plus its file (line numbers
rot; a symbol is greppable). If a control is not built it is labelled
**KNOWN GAP**, never "done." A documented safeguard that isn't wired is worse
than no doc (memory: `feedback_audits_must_be_exhaustive`).

Paths are relative to `apps/api/src/` unless they start with `apps/`,
`packages/`, `docs/`, `scripts/` or `.github/`.

**2026-11-09 re-verification.** Every row was re-read against the code at
`origin/master` 901270559. Rows whose claim changed are marked
*(corrected 2026-11-09)*; new rows are marked *(new 2026-11-09)*. The
age of this header is checked by `scripts/check-threat-model-age.cjs`
(report-only in `.github/workflows/security-watch.yml`, 120-day limit).

---

## 1. System & trust boundaries (as actually shipped)

| Tier | What it is | Trust posture |
|---|---|---|
| **Web dashboard** | Next.js 16 on Vercel | Untrusted browser; authenticates to the API with a ≤ 1 h Bearer JWT + `edu_cms_sid` session cookie; durable "remember me" is an HttpOnly first-party refresh cookie on the web origin (`auth/session-refresh.service.ts`) |
| **API** | NestJS 11 on Railway, single replica (`railway.json` `numReplicas: 1`) | The security boundary. All authz, tenant scoping, signing, validation live here |
| **Player / kiosk** | Next.js player route + Android APK (WebView + native video) | Device-token identity only; never trusted to enforce authz; renders what the manifest/WS tells it |
| **Renderer** | `apps/renderer`, headless Chromium, its own Railway service | Renders board HTML with **no network** (`apps/renderer/src/network.ts`); reachable only on Railway's private network, **no request authentication** of its own |
| **Mobile panic page** | Browser surface for hold-to-trigger emergency | Same JWT/session auth as dashboard |
| **PostgreSQL** | Supabase, reached via Prisma over Supavisor session mode | Trusted store; tenant isolation enforced in the **app layer** (Prisma `where: { tenantId }`), NOT Postgres RLS. Production TLS verification is configured by the URL (`sslaccept=strict` + the CA baked into the image, `Dockerfile`); code only warns on an ineffective spelling (`warnIneffectiveDbTlsSettings`, `security/required-secret.ts`) |
| **Redis** | Railway-managed; pub/sub, revocation sets, throttler counters, emergency-rev epochs | Semi-trusted shared mutable state. The API HMAC-verifies every fan-out message after it leaves Redis (`RedisService.handleRedisMessage` → `verifyWsHmac`, `realtime/redis.service.ts`), so a party holding **only** `REDIS_URL` cannot inject a forged emergency. A party holding `DEVICE_SECRET_KEY` can (§2.10) |
| **Supabase Storage** | Public `assets` bucket (inline-served) + private buckets (floor plans, design imports, device logs) + `branding-logos` | Untrusted content surface; MIME allowlist + SVG block on `assets` (`ASSETS_BUCKET_MIME_TYPES`, `storage/supabase-storage.service.ts`) |
| **Secrets** | Plain environment variables in one Railway environment (and Vercel for the web) | Single trust domain: anyone who can read the API's environment holds every signing and sealing key (§2.10). No KMS / HSM |
| **Third-party** | Stripe (hosted), Resend, Clever, Square POS, AI providers (BYOK), GitHub Actions | External; card data never touches our servers (PCI-SAQ-A); user-supplied outbound URLs go through the SSRF guard |

**Architecture facts that the old fossil got wrong (do not reintroduce):**
- **Realtime is raw signed WebSocket + SSE + Redis pub/sub**, NOT Socket.io.
  The WS adapter is `@nestjs/platform-ws` (`WsAdapter`, `main.ts`). The
  signing primitive is HMAC-SHA256 over a canonical string bound to the
  channel (`wsCanonicalString` / `verifyWsHmac`, `security/ws-signature.ts`).
- **Tenant isolation is Prisma app-layer scoping**, NOT Postgres
  Row-Level Security, backed by a static CI gate (§2.2).
- **Two distinct token systems:** user JWT (signed with `JWT_SECRET`, one
  key) and device JWT (`kind:'device'`, signed with the `DEVICE_JWT_SECRET`
  key ring). `JwtAuthGuard.canActivate` (`auth/jwt-auth.guard.ts`) picks the
  verifier by decoding the unverified payload's `kind`, and pins the algorithm
  (`USER_JWT_ALGORITHMS`, `auth/jwt-algorithms.ts`) on both legs.

---

## 2. Threat matrix

Impact scale: Critical = life-safety / cross-tenant breach / full ATO ·
High = single-account / data exposure · Medium = degradation / nuisance.

### 2.1 Authentication & session

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| Credential stuffing / brute force | High (ATO) | Per-IP throttle (10/min) on login, backed by a **Redis** throttler store so it holds across replicas; per-**account** backoff + 15-min soft lock at 20 failures (Redis; fails open to the per-IP limit); Argon2id cost (~45 ms); every failure and lock writes an `AuditLog` row *(corrected 2026-11-09 — per-account limiter and Redis store were missing)* | `AuthController.login` (`auth/auth.controller.ts`); `LoginAttemptLimiter` (`auth/login-attempt-limiter.ts`); `RedisThrottlerStorage` (`realtime/redis-throttler-storage.ts`); `cryptoPlatformConfig` (`auth/crypto.config.ts`) |
| Email enumeration via login timing | Medium | A dummy Argon2id verify runs whenever the account is missing or not login-eligible (disabled, deleted, archived tenant), so every refusal costs the same | `AuthService.validateUser` + `DUMMY_HASH_PROMISE` (`auth/auth.service.ts`); `isLoginEligible` (`auth/login-eligibility.ts`) |
| Stolen / leaked access JWT | High | Access tokens are **≤ 1 h always** (SEC-010; `rememberMe` no longer means a 30-day JWT). Logout adds the exact token to `jwt_revoked_list` (extend-only TTL) **and** a durable Postgres mirror; the guard checks on every request and **fails closed** when Redis and the mirror both fail, except one bounded device-GET continuity window (row below) *(corrected 2026-11-09)* | `AuthService.login` (`auth/auth.service.ts`); `AuthController.logout`; `JwtAuthGuard.canActivate`; `RedisService.mirrorRevokedTokenDurable`; `security/revocation-posture.ts` |
| Stolen long-lived session (remember-me) | High | **Closed since SEC-010 (2026-09-05).** Remember-me is an opaque, hashed-at-rest, **single-use rotating** refresh secret in an HttpOnly first-party cookie; replaying a used one revokes the whole family (reuse detection) and writes `AUTH_SESSION_REFRESH_REUSE`; families cap at 30 days from the original credential check *(corrected 2026-11-09 — was KNOWN GAP "no refresh-token rotation")* | `SessionRefreshService.rotate` / `revokeFamily` (`auth/session-refresh.service.ts`); `SessionController` (`auth/session.controller.ts`) |
| Sliding refresh used to extend a revoked or downgraded session | High | `POST /auth/refresh` runs behind the same guard (a revoked token never reaches it), re-mints claims from the **live** user row, refuses deleted/disabled/archived accounts, refuses switched-workspace tokens, refuses non-compliant MFA-required users, and caps at `origIat` + 12 h (session) / + 30 d (remember-me) | `AuthService.refreshSession` (`auth/auth.service.ts`); `AuthController.refresh` |
| Privilege downgrade not taking effect (stale role / `canTriggerPanic`) | High | Per-user "invalid-before" epoch rejects every token issued before a downgrade; refresh re-reads the live row | `RedisService.markUserTokensInvalid` (writers: change-password, setup, user/role admin, tenant membership, Clever) + `getTokenInvalidBefore` read in `JwtAuthGuard.canActivate`; both mirrored durably in Postgres |
| MFA challenge token replayed as a full session | Critical | Any token carrying a `purpose` claim is refused as a session (AUTH-01) | `JwtAuthGuard.canActivate` (`purpose` check) |
| Second factor bypass / phishing | High | TOTP (encrypted at rest), single-use Argon2id backup codes, email-code fallback, and **WebAuthn passkeys** (`userVerification: 'required'`, origin + RP-ID checked, single-use Redis challenge). **MFA is required** for SUPER/DISTRICT/SCHOOL_ADMIN and every panic-capable user since 2026-10-04 (break-glass: `MFA_REQUIRED_ENFORCE_AFTER=off`) *(new 2026-11-09)* | `auth/mfa.controller.ts`; `PasskeyController` (`auth/passkey.controller.ts`); `auth/webauthn-challenge-store.ts`; `evaluateMfaPolicy` / `MFA_REQUIRED_ROLES` (`auth/mfa-policy.ts`) |
| MFA code brute force across replicas | Medium | Per-user TOTP attempt limiter — **in-process `Map`**, so per replica. Correct at one replica; **KNOWN GAP** before horizontal scaling (same class as SECURITY_GAPS G5) | `MfaRateLimiter` (`auth/mfa-rate-limiter.ts`) |
| Device-token theft from a kiosk | Medium | Device JWT is HS256-pinned, `kind:'device'`, `sub=screenId`, carries a `credentialEpoch` checked against the **live** Screen row (deleting or revoking the screen kills it); identity (tenant, group) is read from the live row, never the token; **unproven** (fingerprint-only) credentials are refused on every write and on every `verifyDeviceForScreen` route. A paired token lives **180 days** and is renewed in its last 14 days. It carries no role, so `RbacGuard` admits it to no role-gated route *(corrected 2026-11-09)* | `verifyDeviceForScreen` / `admitDeviceCredential` / `DEVICE_TOKEN_TTL_PAIRED` (`screens/device-auth.ts`); `DeviceIdentityInterceptor` (`security/device-identity.interceptor.ts`) |
| Revocation store down during a real emergency | Critical (availability) | Fails closed for users, API keys, every mutation; **one named exception**: a device GET/HEAD for ≤ 10 minutes after the outage opens, so the manifest backstop still delivers a lockdown | `revocationPosture.decide` / `classifyRevocationPurpose` (`security/revocation-posture.ts`) |
| Boot with a default/forgeable secret | Critical | `assertRequiredSecretsAtBoot()` in `bootstrap()` throws in production if `JWT_SECRET` / `SESSION_SECRET` / `DEVICE_SECRET_KEY` / `DEVICE_JWT_SECRET` is missing or < 16 chars; a `*_PREVIOUS` equal to its primary also refuses boot | `assertRequiredSecretsAtBoot` / `requireSecret` (`security/required-secret.ts`); `assertKeyRingsAtBoot` (`security/key-ring.ts`) |
| JWT algorithm confusion | High | Algorithm allowlists on both legs | `USER_JWT_ALGORITHMS` (`auth/jwt-algorithms.ts`); `DEVICE_JWT_ALGORITHMS` (`screens/device-auth.ts`) |
| XSS steals the Bearer token | High | Token is JS-readable by design (it rides an `Authorization` header) but lives ≤ 1 h and cannot mint a refresh (the refresh cookie is HttpOnly); dashboard CSP below (§2.4) | `AuthService.login` SEC-010 note |

### 2.2 Authorization & multi-tenancy

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| RBAC abuse (lower role runs privileged op) | Critical | `RbacGuard` + `@RequireRoles()` server-side; `RESTRICTED_VIEWER` is GET/HEAD-only; emergency trigger requires SUPER/DISTRICT/SCHOOL_ADMIN unless the bypass row below applies | `RbacGuard.canActivate` (`auth/rbac.guard.ts`); `auth/roles.decorator.ts`; `EmergencyController.triggerEmergency` |
| Broken object-level authz / tenant bleed (IDOR) | Critical | Every Prisma query on a tenant-owned model constrains `tenantId` or checks ownership next; a **static CI gate** fails on any new bare-id lookup (baseline ratchets down only — **0 entries** today) and a **two-tenant × role matrix** spec is a **required** check on `master` *(corrected 2026-11-09 — was "enforced in review")* | `apps/api/tools/check-tenant-isolation.cjs` + `tenant-isolation-baseline.json`; `.github/workflows/tenant-isolation.yml`; `tenant-isolation/two-tenant-role-matrix.spec.ts`, `realtime-tenant-scope.spec.ts`, `signed-capability-tenant-scope.spec.ts` |
| Delegated panic trigger by a non-admin | Critical | `@AllowPanicBypass` **widens** access: on an emergency route it admits a non-`RESTRICTED_VIEWER` user whose `canTriggerPanic` is true without the role check. It appears only on emergency trigger / all-clear / broadcast / media-alert / message routes; every use is audited *(corrected 2026-11-09 — the old row described it as a gate that restricts)* | `RbacGuard.canActivate` (`ALLOW_PANIC_BYPASS_KEY`); `auth/panic-bypass.decorator.ts`; uses: `grep -rn "@AllowPanicBypass" apps/api/src` → only `emergency/emergency.controller.ts`, `emergency/screen-emergency.controller.ts` |
| Machine identity (API key) over-reach | High | `vos_` keys stored as SHA-256 hashes, optional **scopes**, mandatory expiry; attached as `kind:'api-key'`, `userId:null` + `apiKeyId` so every audit row names the key *(corrected 2026-11-09 — scopes + expiry added)* | `ApiKeysService.verify` / `create` (`api-keys/api-keys.service.ts`); `JwtAuthGuard.canActivate` (`vos_` branch) |
| VenueOS staff (SUPER_ADMIN) reads or changes a customer's data without consent | Critical | **Customer-approved support access** (2026-10-11): a SUPER_ADMIN reaches a customer tenant only under an ACTIVE grant (internal orgs and the admin's own home tenant are exempt); fails **closed**; every mutation under a grant writes `SUPPORT_ACCESS_ACTION`, every audit row in the request carries `supportGrantId`; break-glass ≤ 1 h with mandatory reason, immediate customer email + banner. **Residual (KNOWN GAP):** path prefixes `/api/v1/super`, `/bugs`, `/billing`, `/license`, `/player-ota` are exempt by design ("metadata only") — each `/super/*` route's claim to return no customer content is prose, not enforced; reads under a grant are attributed but not individually logged. Platform ops under `/super` span every tenant by design — the most destructive, `POST /super/storage/wipe-all-assets`, is off unless `PLATFORM_ASSET_WIPE_ENABLED=1`, needs a typed confirmation and writes an audit row (`license/super-license.controller.ts`) *(new 2026-11-09)* | `SupportAccessInterceptor` (`support-access/support-access.interceptor.ts`, global `APP_INTERCEPTOR`); `SupportAccessService.reach` / `breakGlass`; `isSupportAccessExemptPath` (`support-access/support-access.policy.ts`); `support-access/support-access.bypasses.spec.ts` |
| Abusive or non-paying tenant keeps using the product | Medium | Organisation suspend blocks people and API keys (403 `ORG_SUSPENDED`) and new pairings; never stops screens or emergencies; **fails open** on a database error (billing control) *(new 2026-11-09)* | `OrgSuspensionGate` (`customers/org-suspension.interceptor.ts`) |

### 2.3 Emergency / realtime integrity (life-safety — highest bar)

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| Forged emergency injected onto a Redis channel | Critical | **Server-side HMAC gate**: every `tenant:*` / `group:*` / `device:*` message is verified against the `DEVICE_SECRET_KEY` ring **and the channel it arrived on** (R-02 channel binding; legacy unbound signatures refused) before it reaches any WS or SSE client; malformed channels and non-scope channels are dropped. **Holds only while `DEVICE_SECRET_KEY` is secret** — see §2.10 | `RedisService.handleRedisMessage` (`realtime/redis.service.ts`); `verifyWsHmac`, `bindWsSignatureToChannel`, `ACCEPT_LEGACY_UNBOUND_WS_SIG = false` (`security/ws-signature.ts`) |
| Emergency-rev raise path used as a **signing oracle** (plant a descriptor in Redis, get it HMAC-signed by the API) | Critical | Since 2026-11-01 (PR #216) a raise descriptor is offered and signed **only** when the manifest's own database read confirms a live tenant-wide alert with the same type, severity and drill flag; the read is bounded (300 ms), single-flight, cached; unreadable / slow / disagreeing → no descriptor (the player falls back to the manifest). Raise-only: a descriptor can never clear an alert. Kill switch `EMERGENCY_REV_RAISE=off` *(new 2026-11-09)* | `resolveEmergencyRev`, `descriptorMatchesConfirmed`, `sanitizeAlertDescriptor`, `emergencyRevRaiseEnabled` (`screens/emergency-rev.ts`); `confirmTenantWideAlert` (`screens/tenant-emergency-state.ts`); `screens.emergency-rev-confirmation.spec.ts`, `emergency-rev-confirm.spec.ts` |
| Replay of a captured trigger | High | Server: 120 s freshness + clock-skew guard, bound to channel. Player: 30 s freshness against the server-corrected clock + per-`eventId` LRU shared by WS and SSE, on every transport; `ALL_CLEAR` only triggers a manifest re-fetch (the manifest is the sole arbiter of release) *(corrected 2026-11-09 — player gate now covers SSE)* | `WS_SIG_MAX_AGE_MS`, `verifyWsHmac` (`security/ws-signature.ts`); `checkSensitivePush` (`apps/web/src/app/player/pushGate.ts`) |
| Single-use nonce starves multi-replica fan-out | (design note) | Deliberately **no** single-use nonce — it would make only the first replica accept; replay is bounded by freshness + player dedup | `verifyWsHmac` doc comment (`security/ws-signature.ts`) |
| Redis outage drops a real alert | Critical | HTTP backstop: the player polls `GET /screens/:id/emergency-rev` (zero-Postgres revision; unknown reads as *changed*) and fetches the device-authenticated manifest carrying the live `emergency` field; the APK's native alert watch covers a panel in standby | `ScreensController` `:id/emergency-rev` + `getManifest` (`screens/screens.controller.ts`); `screens/emergency-rev.ts`; `apps/api/src/emergency/CLAUDE.md` |
| Cached manifest releases an alert after a lost all-clear race | Critical | A cached manifest may **raise** but never **release** an alert; empty emergency-asset payload is "no data" | `apps/web/src/app/player/emergencyInterlock.ts` and its tests |
| Forged `/gpio-event` lockdown or `/unpair` from a fingerprint-only credential | Critical | Every device route goes through one verifier that refuses unproven credentials and checks revocation + live row | `verifyDeviceForScreen` (`screens/device-auth.ts`) |
| Player can't verify end-to-end | (residual) | **ACCEPTED GAP — no asymmetric path exists.** The player checks only that a `signature` field is present (it cannot hold the HMAC key). Asymmetric, KMS-held signing is the next design (CLAUDE.md §5) | `checkSensitivePush` (`apps/web/src/app/player/pushGate.ts`); `packages/api-types/src/capability-registry.ts` → `emergency-signed-fanout-gate` |

### 2.4 Injection & input

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| SQL injection | Critical | Prisma parameterized queries. Every `$queryRawUnsafe` / `$executeRawUnsafe` takes a constant SQL string or positional parameters (search: `grep -rn "queryRawUnsafe\|executeRawUnsafe" apps/api/src` → `main.ts` boot DDL, `prisma/prisma.service.ts`, `license/super-license.controller.ts`, `storage/video-transcode/video-transcode.pipeline.ts`; none interpolates request input) *(corrected 2026-11-09 — old row claimed only a constant `$queryRaw`)* | as listed |
| XSS in the dashboard | High | **Enforced nonce-based `script-src`** on dashboard documents (no `'unsafe-inline'`); prerendered routes are excluded by an explicit list that a build tool checks; the API's own Helmet CSP (`scriptSrc 'self'`, `objectSrc 'none'`) covers API-served HTML *(corrected 2026-11-09 — old row cited only the API's Helmet)*. **Residual:** the `/player` route's policy is report-only | `dashboardDocument` (`apps/web/src/proxy.ts`); `apps/web/src/lib/csp-script-policy.ts`; `apps/web/tools/check-csp-prerender.cjs`; `helmet(...)` in `main.ts` |
| Customer-authored board HTML attacks the dashboard or player | High | Boards render in `sandbox="allow-scripts"` iframes **without** `allow-same-origin` (null origin); AI designer boards also pass a safe-srcdoc wrapper. **Residual:** the player's PDF branch is deliberately unsandboxed (Chrome's PDF viewer refuses sandboxed frames); it is cross-origin (storage host) *(new 2026-11-09)* | `SCALED_WEB_SANDBOX` + PDF-branch comment (`apps/web/src/app/player/page.tsx`) |
| Stored XSS via uploaded SVG (public inline bucket) | High | SVG refused at the upload intent check **and** absent from the `assets` bucket allowlist. Logos take SVG only through a server-mediated path that runs DOMPurify first and writes to a separate `branding-logos` bucket with no presigned upload URL *(corrected 2026-11-09)* | `AssetsController.assertUploadIntent` (`assets/assets.controller.ts`); `ASSETS_BUCKET_MIME_TYPES`, `LOGO_BUCKET` (`storage/supabase-storage.service.ts`); `sanitizeLogoSvg` (`branding/sanitize-svg.ts`) |
| Request body DoS / oversized payload | Medium | 5 MB global JSON/urlencoded ceiling; smaller dedicated parsers (1 MB webhooks, 32 kB) mounted ahead of it; Zod-bounded login body (email ≤ 254, password ≤ 256) | `expressBody.json(...)` calls in `main.ts`; `LoginInputSchema` via `ZodValidationPipe` in `AuthController.login` |

### 2.5 CSRF & cross-origin

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| CSRF on a state-changing request | High | Double-submit cookie+header, constant-time compare; **enforced by default** (warn-mode only if `CSRF_ENFORCE=false` / `CSRF_WARN=true`) | `CsrfMiddleware.use`, `safeEquals` (`security/csrf.middleware.ts`) |
| Bearer-auth requests don't carry a CSRF cookie | (design) | `Authorization: Bearer` requests are CSRF-exempt — browsers never attach Bearer cross-site | `CsrfMiddleware.use` (Bearer branch) |
| Machine-to-machine endpoints can't round-trip a token | (design) | Audited exempt list (Stripe webhook, POS webhooks, native-APK OTA, SSO callbacks, device pair/register, sports feed/CTS), each authenticated by its own signature/token | `EXEMPT_PATHS`, `isCsrfExempt` (`security/csrf.middleware.ts`) |
| Malicious cross-origin site calls the API | High | CORS **fails closed** in production: boot refuses without `ALLOWED_ORIGINS` | `app.enableCors` + the `ALLOWED_ORIGINS` refusal in `main.ts` |
| Session cookie sent cross-site | Medium | `edu_cms_sid`: `httpOnly`, `secure` in prod, `sameSite:'none'` in prod (Vercel→Railway is cross-site) / `strict` in dev, 8 h rolling idle, Redis-backed store | `session({...})` in `main.ts`; `security/redis-session.store.ts` |

### 2.6 SSRF (branding scraper, feeds, webhooks, renderer)

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| SSRF to cloud metadata / internal services via user URL | Critical | `validatePublicUrl` blocks non-http(s) schemes, non-80/443 ports, private IP literals; DNS answers re-checked | `validatePublicUrl`, `assertPublicUrl`, `isPrivateIp` (`branding/safe-fetch.ts`) |
| DNS-rebind TOCTOU | High | Connect-time `ssrfSafeLookup` pin on every socket | `ssrfSafeLookup` used by `safeFetch` / `safeFetchPost` |
| Exfil via hostile redirect chain | High | ≤ 3 redirects, each re-validated; webhook POST follows **none** | `safeFetch`, `safeFetchPost` |
| Response-size / decompression bomb | Medium | 5 MB wire cap (GET), 64 KB (webhook echo), decoded-byte ceiling, 8 s timeout | `SafeFetchOptions`, `decodedByteCeiling` |
| Headless Chromium used to reach the network | High | Renderer Chromium gets **no network**: request interception, `connect-src 'none'` CSP, host-resolver NOTFOUND + dead proxy flags, no DevTools socket *(new 2026-11-09)*. **Residual:** the renderer HTTP server itself has no authentication and relies on Railway private networking (`apps/renderer/README.md`) | `apps/renderer/src/network.ts`; `apps/renderer/test/integration/network-lockdown.test.ts` |

### 2.7 Asset upload integrity

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| Disallowed / dangerous file type | High | Resolved-format allowlist at the controller + bucket MIME allowlist; MOV/AVI/MKV/WMV/MPG/3GP/TS/HEIC are now **accepted and converted server-side** (2026-10-05); SVG refused *(corrected 2026-11-09 — old row said `.mov`/AVI are dropped)* | `AssetsController.assertUploadIntent`, `resolveUploadFormat` (`assets/assets.controller.ts`); `ASSETS_BUCKET_MIME_TYPES` |
| Corrupt / truncated / encrypted media reaching screens | Medium | Content check on the stored bytes before an Asset row exists (sharp header, ffprobe + tail-frame decode, PDF encryption check) | `UploadContentCheckService` (`assets/upload-content-check.service.ts`); `assets/upload-content-verdict.ts` |
| Malformed media exploits a server-side parser (ffmpeg, sharp/libvips, libheif) | High | Every external tool runs with a hard SIGKILL timeout and capped output; the API image is Trivy-scanned on every push and Node security releases are watched hourly. **KNOWN GAP:** the tools run inside the API container (no separate sandbox or seccomp profile) *(new 2026-11-09)* | `runTool` (`assets/tool-runner.ts`); `.github/workflows/ci.yml` "Container Security Scanning"; `scripts/check-node-security.cjs` |
| **Malware embedded in a valid file** | High | **KNOWN GAP** — no AV/ClamAV/VirusTotal scan. Search: `grep -rni "clam\|virus\|malware" apps/api/src` → only a comment in `customers/customer-invoice-storage.service.ts` saying it is "not an antivirus claim". Mitigations: format allowlist, content check, SVG block. **The archived fossil's "mandatory malware scanning before READY" was never true** | — |

### 2.8 Audit & forensics

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| Rogue admin / compromised app code rewrites history | Critical | DB triggers: UPDATE/DELETE raise (row-level) and TRUNCATE raises (statement-level) on `audit_logs` *(corrected 2026-11-09 — TRUNCATE block added 2026-07-17)*. **Not verified from code:** whether the application role owns `audit_logs` — an owner can `DROP TRIGGER`, so the triggers defend against app code paths, not against a leaked owner credential (§2.10) | migrations `20260531000000_audit_logs_immutable`, `20260609000000_dedupe_audit_immutability_triggers`, `20260717120000_audit_logs_block_truncate` (`packages/database/prisma/migrations/`); `security/audit-immutability.spec.ts` |
| "We log everything" theater | High | The global HTTP interceptor is an **operational stdout breadcrumb only** and says so; the durable trail is `AuditLog` rows written by domain code (emergency trigger/all-clear/drill, login success/failure/lock, refresh, logout, MFA, passkeys, API-key use, support access, key rotation re-wrap, billing). Grep `auditLog.create` for coverage | `RequestLogInterceptor` (`security/request-log.interceptor.ts`); e.g. `EmergencyController.triggerEmergency` |

### 2.9 Endpoint / kiosk

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| Player tampering / token extraction | Medium | Device-scoped token with no role (§2.1); release APKs checked non-debuggable; no device owner (owner rule). Hardening guidance is prose in `docs/spec/KIOSK_HARDENING.md` *(corrected 2026-11-09 — path was "repo root", which does not exist)* | `scripts/check-apk-debuggable.cjs`; `docs/spec/KIOSK_HARDENING.md` |
| Forged USB content package | High | APK imports a stick only if `manifest.sig` = HMAC-SHA256(manifest, tenant key), the tenant matches, and every file's SHA-256 matches. **The "operator PIN" in the old row is not built** (USB import was made automatic 2026-10-22). **KNOWN GAP:** the key is symmetric and fetched by **every** paired screen of the tenant (`GET /screens/:id/usb-key`), so one extracted screen key can sign packages for the whole tenant *(corrected 2026-11-09)* | `UsbPackage.hmacHex`, `UsbSelection.verifyAll` (`apps/player/app/src/main/java/com/educms/player/usb/`); `ensureUsbSigningKey` (`usb-export/usb-signing-key.ts`) |
| Offline screen goes blank on WAN loss | High (availability) | Service-worker cache tiers with a never-evicted emergency floor | `apps/web/public/sw-player.js` (emergency-tier floor) |

### 2.10 Secrets, environment leak and key rotation *(new 2026-11-09)*

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| The API's environment is read by an outsider (happened: 2026-10-21 Railway environment leak) | Critical | Every key lives in one Railway environment, so a reader holds all of them: `DEVICE_SECRET_KEY` forges fan-out emergencies and unseals every stored credential; `DEVICE_JWT_SECRET` mints device tokens; `JWT_SECRET` mints user tokens of any role; `REDIS_URL` and the database URL give direct state access. **KNOWN GAP:** no KMS/HSM, no per-secret scoping, symmetric signing on the life-safety path. Recovery controls are the rows below | `docs/SECRET-ROTATION.md` ("Both at once (the 2026-10-21 Railway leak)") |
| Rotating a device key darkens the fleet (happened: 2026-10-23, 14 screens dark 16 h) | Critical (availability) | Windowed rotation: `<NAME>_PREVIOUS` accepted on verify/decrypt only; a re-wrap job re-seals stored ciphertext; `railway-rotation.mjs finish` refuses to close a `DEVICE_JWT_SECRET` window while a live screen has no token on the new key; a token no current key verifies is graded *unverifiable* and gets a 1 h credential + `requiresRePair` instead of a hard 401; token-issue audit rows carry a non-secret `mintKeyId`; post-restart fleet check and credential-refusal alarm page the owner | `deviceJwtSecretRing`, `deviceSecretKeyRing`, `keyIdOf` (`security/key-ring.ts`); `KeyRotationRewrapService` (`security/key-rotation-rewrap.service.ts`); `KeyRotationController` (`security/key-rotation.controller.ts`); `isUnverifiableDeviceTokenForScreen` (`screens/device-auth.ts`); `scripts/railway-rotation.mjs`; `scripts/__tests__/rotation-renewal-guard.test.cjs`; `docs/incidents/2026-10-23-retired-signing-key.md` |
| Rotating `JWT_SECRET` / `SESSION_SECRET` | High | **KNOWN GAP** — no window exists for these two; a rotation is a straight swap that signs every operator out | `docs/SECRET-ROTATION.md` per-secret consumer map; `JwtAuthGuard.canActivate` (single `JWT_SECRET`) |
| Clever OAuth tokens unreadable or unrotatable | Medium | Sealed with AES-256-GCM under a **separate** `CLEVER_ENCRYPTION_KEY` that is **not** on a key ring (no `_PREVIOUS` window, not covered by the re-wrap job) — KNOWN GAP | `encryptToken` / `deriveKey` (`integrations/clever/clever-crypto.ts`) |
| Secret committed to the public repository | High | gitleaks in CI; GitHub secret scanning + push protection (per `docs/governance/MECHANISMS.md` row 12, a repository setting not visible in code); keystore files refused | `.github/workflows/ci.yml` "Secret Leak Scan (gitleaks)"; `scripts/check-tracked-keystores.cjs` |
| Production DB connection not authenticated (TLS without verification) | High | The CA ships in the image and the Dockerfile fails the build if it is missing or near expiry; boot warns when `DATABASE_URL` / `DIRECT_URL` asks for verification in a spelling Prisma ignores. Whether production's URL uses `sslaccept=strict` is configuration — **not verifiable from code** | `Dockerfile` (`/etc/ssl/venueos/supabase-prod-ca-2021.crt` checks); `warnIneffectiveDbTlsSettings` (`security/required-secret.ts`); `packages/database/certs/README.md` |

### 2.11 Supply chain *(new 2026-11-09)*

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| Vulnerable production dependency | High | `npm-advisory-audit.cjs` fails on HIGH/CRITICAL in the production closure on every push **and hourly**; Dependabot is paused for version updates (security PRs still flow, but `ignore` blocks may suppress a major-bump security fix — stated as ambiguous in the file) | `scripts/npm-advisory-audit.cjs`; `.github/workflows/ci.yml` "Production Dependency Audit"; `.github/workflows/security-watch.yml`; `.github/dependabot.yml` |
| Vulnerable OS package / Node runtime in the image | High | Trivy container scan (blocking job, ignore file needs justification + expiry) on every push; Node runtime pinned in images checked hourly against Node's security releases | `.github/workflows/ci.yml` "Container Security Scanning", `.trivyignore.yaml`; `scripts/check-node-security.cjs` |
| Vulnerable Android dependency in the APK | High | OSV-Scanner on the Gradle lock — **report-only** | `.github/workflows/player-kotlin-check.yml`; `.github/scripts/osv-gradle-lock.init.gradle` |
| Hijacked GitHub Action tag | High | Every `uses:` pinned to a full commit SHA; drift check runs hourly, **report-only** | `.github/scripts/check-action-pins.cjs` in `security-watch.yml` |
| Unreviewed change reaches production | High | Ruleset on `master` requires a pull request and **nine** status checks (lockfile drift, API build, web build, Docker boot smoke, schema-ships-migration, chromium + webkit emergency path, two-tenant isolation matrix, Build/Lint/Test) — read from the GitHub rules API on 2026-11-09; no direct push, no force-push, no deletion | GitHub ruleset (not in the repository); `.github/workflows/` |

---

## 3. Residual risks / known gaps (the honest list)

1. **One trust domain for every secret** — an environment reader holds every
   signing and sealing key; emergency fan-out signing is symmetric. §2.10.
2. **No upload malware scanning**; media parsers run in the API container. §2.7.
3. **App-layer tenant isolation, not DB RLS** — now gated statically and by a
   required matrix spec, but a missed filter the analyzer cannot see is still a
   cross-tenant bug. RLS is Phase 2.
4. **Player-side emergency verification is a presence check** — asymmetric,
   KMS-held signing is the next design. §2.3.
5. **No rotation window for `JWT_SECRET` / `SESSION_SECRET` / `CLEVER_ENCRYPTION_KEY`.** §2.10.
6. **Support-access exempt prefixes** (`/super`, `/bugs`, …) rely on prose. §2.2.
7. **USB package key is shared by every screen of a tenant.** §2.9.
8. **Renderer service has no request authentication** (private network only). §2.6.
9. **Repo is PUBLIC on GitHub** — treat all commits as world-visible; tracked
   files under `docs/research/` include customer organisation names
   (`SECURITY_GAPS.md` → "Tracked research files — review 2026-11-09").
10. **Single API replica** — the MFA attempt limiter and the branding-scrape
    limiter are in-process; the throttler, login limiter and AI caps are Redis.

---

## 4. How to keep this document honest

- When you add a privileged route, write an `AuditLog` row in its
  controller/service — do not lean on the stdout breadcrumb (§2.8).
- When you add a user-supplied-URL fetch, route it through `safeFetch` /
  `safeFetchPost` (§2.6). Never call global `fetch(url)` directly.
- When you change auth, CSRF, CORS, key handling or the emergency signing
  path, update the cited symbol here and trace the control to its real caller
  before claiming it works (memory: `feedback_audits_must_be_exhaustive`).
- Close a KNOWN GAP → move it from §3 into the matrix with its callsite.
- Re-verify the whole document at least every 120 days and bump the header
  date; `scripts/check-threat-model-age.cjs` reports when it is late.
