# Wave F — Security + multi-tenant isolation (§16, §21)

**Agent:** F4-security · **Date:** 2026-06-26 · **Mode:** read-only (Read/Grep + curl vs live prod) · **No source edits.**
**Surface:** whole API authz/isolation/secrets/replay/PCI/CSRF, with live cross-tenant exploit attempts against two throwaway prod tenants.
**Scale tier:** multi-tenant SaaS, production (web `venue-os.app`, API `api-production-39a1.up.railway.app`, deployed commit `06038352` == repo HEAD — code read == code running, zero drift).
**Standard Audit Surface §§ covered:** §16 (forensic/audit/immutability/cross-tenant), §21 (verification-before-claim), plus §1 (emergency signed pub/sub replay), §3/§4 (AI secrets), §10 (auth/identity), §11 (PCI). §6/§7/§8 integration-isolation spot-checked (sports + POS webhook).

---

## What I did (step by step)

1. **Read the baseline** — prior tenant-isolation audits (`2026-05-28-opus48-audit/38-security-authz-tenant-isolation.md`, `2026-06-08-launch-readiness-audit/03-security-authz.md`) + this campaign's consolidated findings. Goal: confirm the high-severity classes are still closed + find anything new.
2. **Static IDOR sweep** — perl multi-line scan of all 63 controllers + 45 services for `findUnique/findFirst/update/delete` keyed on `id` WITHOUT a `tenantId` guard. Reviewed every hit on a tenant-owned resource. Result: no unscoped tenant-owned mutation handler.
3. **Built two throwaway prod tenants** (A `3e0190ed…`, B `99f95611…`) via `POST /signup`. Created in A: a playlist, screen-group, asset-folder, water-polo game, custom template. Then attempted to **read / update / delete / duplicate / cross-reference** every one of them **as tenant B** with B's bearer token + A's resource ids.
4. **Live cross-tenant exploit attempts** — playlists, screen-groups, asset-folders, sports games (GET/PATCH/cue/auto-celebrate/live-overlay/DELETE), templates (GET/PUT/DELETE/duplicate), emergency trigger (tenant + group scope), emergency playlist-FK injection, `?tenantId=` param injection on assets/users/audit, `tenants/switch` escalation.
5. **Secrets** — verified boot-time `requireSecret` enforcement, AI-key masking, no PAN/CVV in source, no secret echoed in responses.
6. **SSRF** — confirmed every operator-paste-URL path routes through `safeFetch`/`validatePublicUrl`; live-probed the proxy against AWS metadata / localhost / 10.x / `file://`.
7. **Replay/idempotency** — `ProcessedStripeEvent` INSERT-first dedup; WS HMAC `verifyWsHmac` freshness window.
8. **CSRF** — read EXEMPT_PATHS, confirmed the known POS-webhook P0 still open, verified no OTHER legit webhook is blocked and no state-changing route wrongly exempt.
9. **Rate-limit reality check** — fired rapid bursts at login / signup / password-reset / invite to confirm the per-IP throttle (the documented "real defense" against credential stuffing) actually fires. **It does not** — see F4-NEW-1.

---

## Findings

| # | Sev | Area | What | Repro | Evidence |
|---|-----|------|------|-------|----------|
| **F4-NEW-1** | **P1** | Auth / rate-limit (§10) | **Every NestJS `@Throttle` per-IP rate-limit is non-functional in prod** — login brute-force (10/min), signup (5/min), password-reset (3/hr), invite (20/min), createUserDirect (20/min) never fire 429. The guard runs (emits `x-ratelimit-*` headers) but the counter **never decrements** — every request reads `remaining: 9` because the tracker key (`req.ip` behind Railway `trust proxy=1`) lands in a fresh bucket per request. argon2 cost + AuditLog forensics still apply, but the documented "real defense" (auth.controller.ts:29-35 "*this PER-IP one is the real defense*") is dead. | `for i in 1..6: POST /password-reset/request {email}` → **all 6 = HTTP 200** (limit is 3/hr). 25× `POST /auth/login` bad creds → all 401, **zero 429**. Login response header always `x-ratelimit-remaining: 9`. Contrast: `branding/demo/scrape` DOES throttle — but only because it calls a *custom* `this.limiter.check()`, not the `@Throttle` guard. | `app.module.ts:175` (unnamed `ThrottlerModule.forRoot([{ttl,limit:600}])`); `main.ts:57` `set('trust proxy',1)`; `auth.controller.ts:36`; `onboarding.controller.ts:25,37,46`; live curl above |
| **F4-CONF-1** | **P0 (known — CD2-F1, NOT new)** | POS webhooks CSRF-blocked (§8,§16) | `POST /pos/webhook/square` + `/pos/webhook/:providerId` return **403 CsrfError** — missing from `EXEMPT_PATHS` though they self-authenticate via Square HMAC / `X-Webhook-Secret` (exactly like the exempt Stripe/sports-feed webhooks). Confirmed still open; one-line fix. Re-verified per brief; **not re-counted as a new finding.** | `POST /pos/webhook/square {}` → 403 CsrfError. Control `POST /billing/webhook {}` → 400 (reaches controller); `/sports/board/x/feed` → 401 (reaches controller). | `csrf.middleware.ts:17-125` (no pos/webhook entry); `pos-oauth.controller.ts:271,418` (HMAC self-auth) |
| F4-P2-1 | P2 | Status-code hygiene (§16) | Cross-tenant `GET /playlists/:id` returns **HTTP 200 with empty body** (Nest serializes the `null` from the tenant-scoped `findFirst`) instead of 404. No data leak — the scope filter is correct — but a 200-empty on a non-owned id is a sloppy signal (and inconsistent with templates/games/folders which correctly 404). | `GET /playlists/{A-id}` as B → `HTTP 200 len=0`. A's own read → full object. | `playlists.controller.ts:119-134` |
| F4-P2-2 | P2 (informational, carried from prior) | Isolation has no generic backstop (§16) | Tenant isolation is **100% per-service `tenantId` filter convention** — `RbacGuard` provides no generic tenant fence. Every path does it right today (verified live), but a single future forget-the-filter handler = instant IDOR with no safety net. Consider a Prisma middleware / tenant-scoped repo wrapper as defense-in-depth. | N/A — architectural. | `rbac.guard.ts`; prior audit §38 finding #4 |
| F4-P2-3 | P2 (config, owner-only — known) | passport-saml@3 CVE (§10) | SAML callbacks are CSRF-exempt and trust the assertion signature; `passport-saml@3` (CVE-2025-54419) weakens that anchor and a DISTRICT_ADMIN can self-enable SSO. Already tracked (task #199); SAML is hard-gated off pending the upgrade, so not live-exploitable today. | N/A — dependency. | task #199; `sso.controller.ts`; `csrf.middleware.ts:32` |

### Everything that PASSED (the high-severity classes are CONFIRMED still closed)

**Multi-tenant isolation — AIRTIGHT under live exploit (the #1 SaaS risk):**
- **Playlists** — B read A's playlist `200 len=0` (null, no data); PUT/DELETE → `404`; B's list `[]`. ✓
- **Screen-groups** — B DELETE A's group → `404`. ✓
- **Asset folders** — B DELETE/PUT A's folder → `404`; `?folderId={A}` and `?tenantId={A}` injections → `[]` (param ignored, JWT tenantId used). ✓
- **Sports games (the live water-polo tenant's own domain)** — B GET A's game → `404 "Game not found"`; PATCH score / cue / auto-celebrate / live-overlay / DELETE → **all 404**; A's score verified **unchanged** (`homeScore:0`). This is the most security-critical surface and it is fully fenced. ✓
- **Templates** — B GET → `404`; PUT/DELETE/**duplicate** → `404` (no template-theft into B's tenant); A's template name unchanged. ✓
- **Emergency trigger (life-safety)** — B → A's tenant scope = **403**; B → A's group scope = **403** (`resolveScopeTenant` strict `owningTenantId !== callerTenantId`, emergency.controller.ts:309); B using A's `playlistId` on B's own trigger = **404** "Playlist not found in this tenant" (FK validated against caller tenant, emergency.controller.ts:77-86). ✓
- **`tenants/switch` escalation** — B → A = **403 FORBIDDEN**. ✓
- **Audit logs / users** — `?tenantId={A}` injection returns only B's own rows (B's `tenantId`). ✓
- **Submissions** — exemplary: `{id,tenantId}` scope on every query AND FK `count({id IN, tenantId})` validation on asset/playlist/schedule references (submissions.controller.ts:78-86,212).

**§16 AuditLog + immutability — REAL:** live trail confirmed `TENANT_SIGNUP`, `TEMPLATE_CREATED`, and **7× `AUTH_LOGIN_FAILED`** rows in tenant A's trail (failed logins ARE audited with IP + email; unknown-email recon → sentinel tenant). DB-level immutability trigger on `audit_logs` (task #210, prior audit confirmed). Login success+fail both audited (auth.controller.ts:51,63).

**§10 secrets — REAL:** `requireSecret` throws at boot in prod for JWT/SESSION/DEVICE_SECRET/DEVICE_JWT (required-secret.ts:36, wired main.ts:18). AI key never returned raw — `maskAiKey` = `sk-ant••••••••<last4>` (ai-key-cipher.ts:105); GET `/ai/key` returns `{configured, provider, keyMask}` only. No secret in any response body observed.

**SSRF — BEST-IN-CLASS:** live proxy probes for `169.254.169.254` (AWS metadata), `127.0.0.1`, `10.0.0.1`, `file:///etc/passwd` ALL return a "Private / blocked / not allowed" page with **zero** internal content (`ami-id`/`iam`/`root:` grep = 0). Every operator-paste-URL path (proxy, discovery, streaming, geocoding, branding) routes through `safeFetch`/`validatePublicUrl` (DNS-pin rebind-proof). No raw `fetch(userUrl)`; AI provider fetches are constant hosts.

**Replay/idempotency — REAL:** `ProcessedStripeEvent` table, INSERT-first dedup on `event.id` PK (stripe.service.ts:332-342). WS fan-out gate `verifyWsHmac` does constant-time HMAC + freshness window (stale + future/clock-skew guards) + requires `eventId` (ws-signature.ts:71-72), wired at redis.service.ts:137 before any player sees the message.

**PCI — REAL (SAQ-A):** zero `card_number`/`cvv`/`pan` handling anywhere in `apps/api/src`. Card entry is Stripe-hosted only.

**CSRF — enforce-by-default + every exemption justified:** confirmed live (POS webhook 403, billing webhook reaches controller). Reviewed all 30+ EXEMPT_PATHS — every one is a sessionless machine-to-machine / device path authed by HMAC / Bearer / pairing-code / SAML-signature + rate-limit. No browser-cookie-authed mutation is exempt. The only exemption GAP is the known POS-webhook P0 (F4-CONF-1).

---

## Coverage — what I could NOT reach + why

- **Device-JWT-bound paths at runtime** (manifest, SSE, game-state, cts-snapshot) — code-verified the device-sub == screen.id / HMAC binding, but did not stand up a paired physical device to exercise them live (no spare kiosk; must not touch the live Dodgers LED). Code path matches prior audits' "SAFE" verdict.
- **SUPER_ADMIN cross-tenant routes** — my throwaway tenants are DISTRICT_ADMIN; could not test the `super/*` class live, but it's class-level `@RequireRoles(SUPER_ADMIN)` and `switchTenant` SUPER path is code-confined to district subtree.
- **The F4-NEW-1 root cause** (why `req.ip` buckets per-request behind Railway) is inferred from the always-`remaining:9` header + Railway edge behavior; the *exact* tracker-key value would need a one-line debug log I'm not permitted to add. The *effect* (no 429 ever) is curl-proven and unambiguous.

---

## Grade (Greg's 3 lenses)

- **DESIGN (architecture):** **A.** Dominant safe pattern (`findFirst {id, tenantId}` then mutate-by-id) applied with near-perfect consistency across 63 controllers; FK-reference injection closed; SSRF/secrets/PCI/replay all best-practice. The only architectural soft spot is "no generic tenant fence" (convention-only).
- **UX (operator-visible security):** **A−.** Honest error envelopes, 403/404 where expected, login forensics in the audit trail. Minor: the 200-empty cross-tenant playlist read is a sloppy status.
- **FUNCTIONALITY (does the control actually work end-to-end):** **B+.** Multi-tenant isolation, emergency authz, SSRF, secrets, CSRF, audit immutability all *verified working live*. Two dents: the per-IP throttle is silently dead in prod (F4-NEW-1, real brute-force/abuse exposure) and the POS-webhook CSRF P0 (F4-CONF-1, known). Neither is a cross-tenant leak.

**Bottom line for the launch gate:** the #1 SaaS risk — cross-tenant isolation — is engineered well and HOLDS under live exploit on every resource I could create and attack. No P0 cross-tenant leak. The new launch-relevant item is the dead per-IP throttle (P1, brute-force/credential-stuffing/abuse exposure on auth + signup + reset). The one P0 (POS webhook CSRF) is already known.
