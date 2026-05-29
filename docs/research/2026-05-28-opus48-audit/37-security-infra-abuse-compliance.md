# Security Audit — Transport / Infra / Abuse / Compliance

> Opus 4.8 read-only, 2026-05-29. Verified at file:line.

## Launch-readiness checklist
| Item | Verdict |
|---|---|
| Helmet headers incl `frame-ancestors 'self'` + X-Frame-Options + HSTS (`main.ts:83-102`, helmet 7.2.0 defaults kept) | **PASS** (clickjacking concern satisfied) |
| CORS fail-closed in prod, no wildcard (`main.ts:144-205`; throws if ALLOWED_ORIGINS unset) | **PASS** |
| CSRF enforce-by-default, exemptions audited, webhook rawBody (`csrf.middleware.ts`) | **PASS** |
| Login throttle 10/min + argon2id + audit + no enumeration | **PASS** |
| Pairing-code brute-force bound (CSPRNG + 10/min/IP + cooldown) | **PASS** |
| Emergency RBAC + cross-tenant gate (`resolveScopeTenant`) + panic-bypass guardrails + RESTRICTED_VIEWER hard-block | **PASS** |
| **WS signed-message HMAC gate REAL** — `verifyWsHmac` called on every replica `pmessage` before WS+SSE fan-out (`redis.service.ts:137`); dead `verifyMessage()` removed; ms-timestamp/constant-time/120s-freshness/replay-dedup | **PASS** (addresses 2026-05-21 theater memory) |
| SSRF (branding/proxy/emergency media) incl DNS-rebind connect-time pin | **PASS** (best-in-class) |
| Stripe PCI — no PAN touched/logged, signature-verified webhook | **PASS** (SAQ-A) |
| No student academic PII (Clever fetches admins/teachers/staff only, NOT students; login email hashed) | **PASS** |
| SVG stored-XSS blocked at controller (`assets.controller.ts:39-49`) | **PASS** |

## Findings (none are unauth-takeover; ranked)
- **F-1 — FAIL if floor plans ship:** floor plans stored on the **PUBLIC** Supabase bucket (`floor-plans.controller.ts:393` → permanent `public, immutable` URL), NOT signed/short-TTL. Sprint-8b spec requires signed short-TTL ("operational security — building layouts/exits"). Read endpoints RBAC-gated, but a leaked URL (history/cache/referrer) = world-readable building plan forever. **Launch-blocker IF floor plans are in launch scope; WARN otherwise.**
- **R-1 — WARN:** `POST /sports/sponsors/:id/impression` (public, unguarded) has **no endpoint rate limit** — the code comment claims "nginx/infra layer" but **railway.json has no nginx** (verified). Only global 600/min/IP. Anyone with a board's game+sponsor UUID can inflate proof-of-play + amplify DB writes (cross-tenant blocked by tenant-match). Sibling `/feed`,`/cts-snapshot` have per-game 40/10s limits — impression should too. **Add before sponsorship revenue goes live.**
- **R-2 — WARN (interacts with the sponsor fix):** impression + `cts-cue-fired` are NOT on the CSRF exempt list, and board/ribbon POST them cross-origin with no cookies/CSRF header → under enforce mode they may 403 → proof-of-play writes likely silently failing in prod today. Fix exempt + throttle TOGETHER (exempt alone makes R-1 live).
- **U-1 — WARN:** Supabase bucket `ALLOWED_MIMES` (`supabase-storage.service.ts:58`) still includes `image/svg+xml` (inconsistent with the controller block); public bucket serves inline. Low practical risk (supabase.co origin, sandboxed; presign excludes SVG) — remove for defense-in-depth.
- **U-2 — WARN:** upload mime is client-trusted (filename/header), not magic-byte-sniffed. Mitigated by allowlist + bucket policy. (Floor plans DO sniff bytes.)
- **S-1 — WARN:** no password-login account lockout (throttle-only); IP-rotating credential-stuffing not fully stopped. MFA does lock 5/min.
- **S-2 — WARN:** logout revocation `jwt_revoked_list` **fails OPEN** on Redis outage despite a "fail-closed" comment (`redis.service.ts:170-182`) — a logged-out token passes during a Redis outage. Per-user mass-revocation DOES fail closed. Short TTLs limit window.

## Bottom line
No unauth-takeover or forged-emergency holes. Emergency/auth/CSRF/CORS/SSRF/PCI/FERPA genuinely solid + verified. The one true launch-blocker is conditional: **floor-plan public URLs (F-1) IF floor plans launch.** Highest-priority non-blocking: R-1/R-2 (impression) before sponsorship revenue. S-2/U-1 quick hardening.
