# Threat Model — VenueOS (EDU CMS)

**Status:** Current / living. **Last verified against code:** 2026-05-29.
**Supersedes:** `docs/archive/2026-04-original-design/THREAT_MODEL.md` (a
2026-04-13 pre-build design fossil that described a Socket.io + Postgres-RLS
architecture VenueOS never shipped). Every control below is cited to its
real callsite `file:line`. If a control is not yet built it is labelled
**KNOWN GAP**, never "done." A documented safeguard that isn't wired is worse
than no doc (memory: `feedback_audits_must_be_exhaustive`).

---

## 1. System & trust boundaries (as actually shipped)

| Tier | What it is | Trust posture |
|---|---|---|
| **Web dashboard** | Next.js 16 on Vercel | Untrusted browser; authenticates to API via JWT (Bearer) + `edu_cms_sid` session cookie |
| **API** | NestJS 11 on Railway, single replica (`railway.json`) | The security boundary. All authz, tenant scoping, signing, validation live here |
| **Player / kiosk** | Next.js player route + Android APK (WebView) | Device-token identity only; never trusted to enforce authz; renders what the manifest/WS tells it |
| **Mobile panic page** | Browser surface for hold-to-trigger emergency | Same JWT/session auth as dashboard |
| **PostgreSQL** | Supabase, reached via Prisma over pgBouncer | Trusted store; tenant isolation enforced in the **app layer** (Prisma `where: { tenantId }`), NOT Postgres RLS |
| **Redis** | Railway/managed; pub/sub + revocation sets | Semi-trusted: the API HMAC-verifies every fan-out message *after* it leaves Redis (`redis.service.ts:137`), so a compromised Redis cannot inject a forged emergency |
| **Supabase Storage** | Public bucket, inline-served | Untrusted content surface; mime allowlist + SVG block (`supabase-storage.service.ts:57`) |
| **Third-party** | Stripe (hosted), Resend, Clever, Square POS, AI providers (BYOK) | External; card data never touches our servers (PCI-SAQ-A); outbound URLs go through SSRF guard |

**Architecture facts that the old fossil got wrong (do not reintroduce):**
- **Realtime is raw signed WebSocket + Redis pub/sub**, NOT Socket.io. The
  WS adapter is `@nestjs/platform-ws` (`main.ts:42`). The signing primitive is
  HMAC-SHA256 over a canonical string (`security/ws-signature.ts:28`).
- **Tenant isolation is Prisma app-layer scoping**, NOT Postgres
  Row-Level Security. Every query filters by `tenantId`; the `RbacGuard`
  + per-controller ownership checks are the enforcement, not a DB policy.
- **Two distinct token systems:** user JWT (signed with `JWT_SECRET`) and
  device JWT (`kind:'device'`, signed with `DEVICE_JWT_SECRET`). The guard
  picks the secret by decoding the unverified header
  (`jwt-auth.guard.ts:76-79`).

---

## 2. Threat matrix

Impact scale: Critical = life-safety / cross-tenant breach / full ATO ·
High = single-account / data exposure · Medium = degradation / nuisance.

### 2.1 Authentication & session

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| Credential stuffing / brute force | High (ATO) | Per-IP rate limit (10/min) on login + Argon2id verify cost (~45 ms) slows guessing | `auth.controller.ts:24`; `crypto.config.ts:7` |
| Email enumeration via login timing | Medium | Constant-time path: a dummy Argon2id verify runs on user-miss and on non-ACTIVE users so both branches take equal time | `auth.service.ts:21-27,56-67,79-83` |
| Stolen / leaked JWT | High | Logout SADDs the exact token to a Redis revocation set; guard checks it on **every** request and **fails closed** if Redis is unreachable | `jwt-auth.guard.ts:97-126` |
| Privilege downgrade not taking effect (stale role / `canTriggerPanic`) | High | Per-user "invalid-before" epoch: tokens issued before a downgrade are rejected (`getTokenInvalidBefore`) | `jwt-auth.guard.ts:113-118` |
| Device-token theft from a kiosk | Medium | Device JWT scoped to `sub=screenId` + `kind:'device'` + fingerprint; carries no role/tenant authority and cannot drive admin endpoints | `jwt-auth.guard.ts:128-138` |
| Boot with a default/forgeable secret | Critical | `requireSecret()` throws at boot in production if `JWT_SECRET`/`SESSION_SECRET`/`DEVICE_SECRET_KEY`/`DEVICE_JWT_SECRET` are missing/short | `security/required-secret.ts:30-39` |
| **Refresh-token theft / long-lived session** | High | **KNOWN GAP** — there is no refresh-token rotation. `rememberMe` issues a flat 30-day JWT (`auth.service.ts:174`); a stolen token is valid until expiry (subject to the revocation set). Tracked: `docs/SECURITY_HYGIENE.md` / sprint follow-up noted inline at `auth.service.ts:172`. |

### 2.2 Authorization & multi-tenancy

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| RBAC abuse (lower role runs privileged op) | Critical | `RbacGuard` + `@Roles()` server-side; emergency trigger restricted to SUPER/DISTRICT/SCHOOL_ADMIN | `auth/rbac.guard.ts`; `auth/roles.decorator.ts` |
| Broken object-level authz / tenant bleed (IDOR) | Critical | Every Prisma query scoped by `tenantId`; controllers verify ownership before mutate. **App-layer**, not RLS — so the discipline is "filter every query," enforced in review | per-service (e.g. `assets.service.ts`, `playlists.service.ts`) |
| Unauthorized delegated panic trigger | Critical | `@AllowPanicBypass` decorator gates who may override the per-user `canTriggerPanic` flag; never weaken without sign-off (CLAUDE.md emergency rule) | `auth/panic-bypass.decorator.ts` |
| Machine identity (API key) over-reach | High | `vos_` tenant API keys hash-verified against `TenantApiKey`, attached as `userId:null` + `apiKeyId` so forensic rows attribute the key | `jwt-auth.guard.ts:41-57` |

### 2.3 Emergency / realtime integrity (life-safety — highest bar)

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| Forged emergency injected onto a Redis channel | Critical | **Server-side HMAC gate**: every `tenant:*`/`group:*`/`device:*` message is `verifyWsHmac`-checked at the fan-out chokepoint *before* it reaches any WS/SSE client; failures are dropped + logged | `redis.service.ts:128-144`; `security/ws-signature.ts:51-91` |
| Replay of a captured trigger | High | 120 s freshness window (`maxAgeMs`) + clock-skew guard + player per-`eventId` dedup; a replayed ALL_CLEAR self-corrects within ~10 s via manifest poll | `security/ws-signature.ts:60,71-73` |
| Single-use nonce starves multi-replica fan-out | (design note) | Deliberately **no** single-use nonce — it would make only the first replica accept and starve the rest; replay is benign for OVERRIDE and caught downstream | `security/ws-signature.ts:38-50` |
| Redis outage drops a real alert | Critical | HTTP-polling backstop: the player polls its device-authenticated manifest carrying the live `emergency` field (same `Tenant.emergencyStatus` source of truth) | manifest endpoint `screens.controller.ts`; CLAUDE.md safeguard #4 |
| Player can't verify end-to-end | (residual) | **ACCEPTED GAP — no asymmetric path exists yet** (corrected 2026-08-03, R-08: an earlier revision claimed a `ws-ed25519.ts` that was never built). The player smoke-tests only for the *presence* of a `signature` field; the primary safeguard is the server-side HMAC gate at the fan-out chokepoint. Per-tenant Ed25519 verification at pair time (ControlEnvelopeV2) is the documented follow-up | `security/ws-signature.ts` header; `packages/api-types/src/capability-registry.ts` → `emergency-signed-fanout-gate` |

### 2.4 Injection & input

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| SQL injection | Critical | Prisma parameterized queries everywhere; no raw string interpolation on user input (boot-time `$queryRaw` uses a constant) | `prisma/*`; `main.ts:224` |
| XSS in the admin/player | High | Helmet CSP (`scriptSrc 'self'`, `objectSrc 'none'`) | `main.ts:83-102` |
| Stored XSS via uploaded SVG (public inline bucket) | High | SVG **blocked** at the upload controller AND the bucket mime allowlist (defense-in-depth). An `AssetSanitizerService.sanitizeSVG` exists but SVG upload stays disabled until it is wired into the upload path | `assets.controller.ts:39`; `supabase-storage.service.ts:57-83` |
| Request body DoS / oversized payload | Medium | 5 MB body-parser ceiling; per-endpoint re-checks (e.g. bug-report screenshot caps) | `main.ts:79-80` |

### 2.5 CSRF & cross-origin

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| CSRF on a state-changing request | High | Double-submit cookie+header, constant-time compare; **enforced by default** (warn-mode only if `CSRF_ENFORCE=false`/`CSRF_WARN=true`) | `security/csrf.middleware.ts:164-166,204-214` |
| Bearer-auth requests don't carry a CSRF cookie | (design) | Requests with `Authorization: Bearer` are CSRF-exempt by design — browsers never auto-attach Bearer cross-site; cookie-session flows still get full enforcement | `csrf.middleware.ts:199-202` |
| Machine-to-machine endpoints can't round-trip a token | (design) | Audited exempt list (Stripe webhook, native-APK OTA, SSO IdP callbacks, device pair/register, sports feed/CTS) — each authenticated by its own signature/token, not ambient cookies | `csrf.middleware.ts:17-125` |
| Malicious cross-origin site calls the API | High | CORS **fails closed** in production: API refuses to boot without `ALLOWED_ORIGINS`; dev branch only allows localhost/LAN/tunnels | `main.ts:144-205` |

### 2.6 SSRF (branding scraper + outbound webhooks)

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| SSRF to cloud metadata / internal services via user URL | Critical | `validatePublicUrl` blocks `file:`/`ftp:`/`data:` etc + non-80/443 ports + IP-literal private ranges; DNS resolve rejects private addresses | `branding/safe-fetch.ts:26-83,94-111` |
| DNS-rebind TOCTOU (low-TTL flip after the check) | High | Connect-time `ssrfSafeLookup` pin: the socket only ever connects to an address this re-validates, closing the rebind window | `branding/safe-fetch.ts:122-145,309` |
| Exfil via hostile redirect chain | High | Redirects capped at 3; each hop re-validated; outbound webhook POST follows **no** redirects and never reflects the receiver body to operators | `branding/safe-fetch.ts:272,349-353,170-177` |
| Response-size bomb | Medium | Byte caps (5 MB GET / 64 KB webhook echo) + 8 s timeout | `branding/safe-fetch.ts:265,182,328-331` |

### 2.7 Asset upload integrity

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| Disallowed / unplayable / dangerous file type | High | Mime allowlist at controller + bucket; `.mov`/AVI/SVG dropped | `assets.controller.ts:252`; `supabase-storage.service.ts:63` |
| **Malware embedded in a valid-mime file** | High | **KNOWN GAP** — there is no AV/ClamAV/VirusTotal scan on upload. Mitigations in place: strict mime allowlist, magic-byte/extension checks, SHA-256 content hashing (`asset-sanitizer.service.ts`). Tracked as accepted risk; build OR document in `docs/SECURITY_HYGIENE.md`. **The archived fossil's claim of "mandatory malware scanning before READY" was never true.** |

### 2.8 Audit & forensics

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| Rogue admin / compromised credential rewrites history | Critical | DB-level append-only trigger: UPDATE/DELETE on `audit_logs` raise an exception and roll back the transaction | `migrations/20260526010000_audit_log_immutability/migration.sql` |
| "We log everything" theater | High | The global HTTP interceptor is an **operational stdout breadcrumb only** (`RequestLogInterceptor`) and says so; the durable trail is real `AuditLog` rows written by domain code (emergency trigger `emergency.controller.ts:441`, auth, billing→license, AI-key ops, submissions, template/sponsor CRUD). Grep `auditLog.create` for coverage | `security/request-log.interceptor.ts:6-36` |

### 2.9 Endpoint / kiosk

| Threat | Impact | Control (shipped) | Cite |
|---|---|---|---|
| Player tampering / token extraction | Medium | Kiosk mode + device-scoped token with no admin authority; USB ingest requires signed manifest + SHA verify + operator PIN (spec, Sprint 7) | `KIOSK_HARDENING.md` (repo root); CLAUDE.md Sprint 7 |
| Offline screen goes blank on WAN loss | High (availability) | Service-worker cache tiers + never-evict emergency floor; falls back to pre-cached text-only emergency message | CLAUDE.md Sprint 7; `apps/web/public/sw-player.js` |

---

## 3. Residual risks / known gaps (the honest list)

1. **No refresh-token rotation** — 30-day `rememberMe` JWTs (mitigated by the
   revocation set). §2.1.
2. **No upload malware scanning** — mime allowlist + SVG block + hashing only. §2.7.
3. **App-layer tenant isolation, not DB RLS** — correctness depends on every
   query filtering `tenantId`; a missed filter is a cross-tenant bug, caught
   by review/tests rather than the database.
4. **Player-side emergency verification is a smoke check** — full per-tenant
   asymmetric verify on the kiosk is a documented follow-up; the server-side
   HMAC gate is the real safeguard (§2.3).
5. **Repo is PUBLIC on GitHub** — treat all commits as world-visible; secret
   scanning (gitleaks) runs pre-commit + CI. `docs/SECURITY_HYGIENE.md`
   recommends flipping to private.
6. **Single API replica** (`railway.json`) — a few abuse counters
   (branding-scrape, AI free-tier) are in-memory and must move to Redis
   before horizontal scaling (audit P1-14).

---

## 4. How to keep this document honest

- When you add a privileged route, write an `AuditLog` row in its
  controller/service — do not lean on the stdout breadcrumb (§2.8).
- When you add a user-supplied-URL fetch, route it through `safeFetch` /
  `safeFetchPost` (§2.6). Never call global `fetch(url)` directly.
- When you change auth, CSRF, CORS, or the emergency signing path, update the
  cited line numbers here and trace the control to its real caller before
  claiming it works (memory: `feedback_audits_must_be_exhaustive`).
- Close a KNOWN GAP → move it from §3 into the matrix with its callsite, and
  delete the gap note.
