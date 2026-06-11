# Pre-Launch Final Audit — Section 16+17: Forensic/Audit Coverage + Operational/DX

**Auditor:** Claude Sonnet 4.6 (sub-agent)
**Date:** 2026-06-10
**Sections:** 16 (Forensic / Audit Coverage) + 17 (Operational + DX)
**Method:** Code trace across all controllers, live DB query via postgres MCP, live curl of all 3 health endpoints, in-memory cache inventory.

---

## Coverage Table

| Section | Design | UX | Functionality |
|---------|--------|----|---------------|
| 16 — Forensic / Audit Coverage | A | B | B+ |
| 17 — Operational + DX | A | A | A |

---

## Section 16 — Forensic / Audit Coverage

### 16.1 DB-Level Immutability Trigger

**Live query result (postgres MCP, 2026-06-10):**

```
SELECT tgname FROM pg_trigger WHERE tgrelid='audit_logs'::regclass AND tgname NOT LIKE 'RI_%';
→ audit_logs_immutable  (tgenabled: O = always)
```

**Status: FIXED / SOLID.** The prior duplicate-trigger bug (two coexisting BEFORE UPDATE/DELETE triggers from migrations `20260526010000` and `20260531000000`) was resolved by migration `20260609000000_dedupe_audit_immutability_triggers`, which ran at `2026-06-09T20:16:02Z`. Exactly one trigger (`audit_logs_immutable`) remains, `tgenabled=O` (always fires). The prior REPORT.md H10 item is closed.

**Migration chain verified:**
```
20260526010000_audit_log_immutability        → 2026-05-26
20260531000000_audit_logs_immutable          → 2026-05-31
20260609000000_dedupe_audit_immutability_triggers → 2026-06-09 (cleanup)
```

### 16.2 Cross-Tenant Scope Verification

All queried controllers sampled (`users`, `screens`, `playlists`, `schedules`, `assets`, `templates`, `tenants`, `branding`, `billing`, `emergency`) scope every Prisma query by `tenantId` from the authenticated principal. No IDOR found in this pass (confirmed consistent with the 2026-06-09 full-audit REPORT.md assessment).

### 16.3 Privileged Mutation AuditLog Inventory

Traced every `@Post`, `@Put`, `@Patch`, `@Delete` handler across all controllers against their AuditLog writes:

#### COVERED (AuditLog present):

| Domain | Action | File:Lines |
|--------|--------|------------|
| Auth | login, logout, MFA enable/disable | `auth.controller.ts`, `mfa.controller.ts` |
| Emergency | trigger, all-clear, per-screen override | `emergency.controller.ts:1900,2149,2200,2275,2327,2364`, `screen-emergency.controller.ts:1325,1521,1624,1718` |
| Users | create, update, delete, role change, canTriggerPanic | `users.controller.ts:235,296,411,463` |
| Screens | create, pair, unpair, delete, status, assign | `screens.controller.ts:multiple` |
| Templates | create, update, delete, zone edit | `templates.controller.ts:56+` |
| Branding | adopt, apply-to-templates, delete, manual | `branding.controller.ts:337,438,487,606,626,786,847,859` |
| Assets | emergency-upload, alt-text update, delete, approve, reject | `assets.controller.ts:557,1132,1215,1388,1418` |
| AI Keys | set, delete, test | `ai-key.controller.ts:236,265,303` |
| AI Generations | generate success + failure | `ai.service.ts` |
| Playlists | delete (with schedule metadata) | `playlists.controller.ts:396` |
| Schedules | toggle (activate/deactivate), delete | `schedules.controller.ts:285,319` |
| Billing (Stripe) | checkout.session.completed, subscription.*, payment_failed | `stripe.service.ts:524,597,676` |
| Tenants | create-child, switch, update-me, delete-child, panic-settings, canary, OTA-window | `tenants.controller.ts:156,249,334,407,494,665,774` |
| Sponsors | create, update, delete | `sponsors.service.ts:61` |
| Submissions | create, approve, reject | `submissions.controller.ts` |
| API Keys | create, delete | `api-keys.service.ts` |

#### GAPS (No AuditLog row):

**P2 — `PUT /schedules/:id` (schedule update)**
- **File:** `schedules.controller.ts:193-263`
- **Evidence:** No `auditLog.create` call in the `update()` handler. The method updates `playlistId`, `screenId`, `screenGroupId`, `daysOfWeek`, `timeStart`, `timeEnd`, `priority`, `mutedOverride` without writing any forensic trail. Toggle and Delete DO audit; Update does not.
- **Impact:** An operator can silently re-target a schedule from one screen to another or change a playlist assignment and there is no audit record. Medium severity — not a safety/security issue but a forensic gap (district IT wanting to know "who changed what screen was playing" has no answer for updates).
- **Fix:** Add `auditLog.create` inside the update handler (same pattern as toggle: wrap in `$transaction`, record `SCHEDULE_UPDATED` with before/after state diff).

**P3 — `POST /playlists` (playlist create)**
- **File:** `playlists.controller.ts:136-186`
- **Evidence:** `playlists.controller.ts` has exactly one `auditLog.create` at line 396, which is inside the DELETE handler. The CREATE handler returns the new playlist directly without any audit row.
- **Impact:** No forensic trail when a CONTRIBUTOR creates a playlist. Low risk since it's not a privileged action, but the audit standard requires every privileged mutation. CONTRIBUTOR → SCHOOL_ADMIN approval path is covered on schedule creation, not on playlist creation.
- **Fix:** Add `PLAYLIST_CREATED` audit row after `prisma.client.playlist.create`.

**P3 — `PUT /playlists/:id` and `PUT /playlists/:id/items` (playlist update / item reorder)**
- **File:** `playlists.controller.ts:188-284`
- **Evidence:** Neither `PUT :id` (rename/templateId change) nor `PUT :id/items` (full item set replacement) writes an AuditLog row.
- **Impact:** An admin can silently replace every item in a playlist (changing what every screen plays) with zero forensic trail. The schedule toggle audits but the playlist content swap does not.

**P3 — `PUT /playlists/:id/active` (playlist activate)**
- **File:** `playlists.controller.ts:286-347`
- **Evidence:** No audit row found.

**P3 — Asset upload (`POST /assets/upload`, `POST /assets/presign`, `POST /assets/complete-upload`, `POST /assets/url`)**
- **File:** `assets.controller.ts:832+, 585+, 617+, 1238+`
- **Evidence:** `ASSET_EMERGENCY_UPLOAD` at line 557 IS audited. But the normal `upload`, `presign/complete-upload` (multipart flow), and `url` (URL-based add) endpoints are not. An APPROVED asset write is audited but asset CREATION is not.
- **Impact:** No forensic trail on who uploaded what content. A compromised CONTRIBUTOR account can upload XSS-laden SVGs or inappropriate content without a creation record (the approval audit covers who approved, not who uploaded).

**P3 — `PUT /assets/:id/move` (asset folder move)**
- **File:** `assets.controller.ts:1437`
- **Evidence:** No audit row.

**P3 — Asset Folder CRUD (`POST /assets/folders`, `PUT /assets/folders/:id`, `DELETE /assets/folders/:id`)**
- **File:** `assets.controller.ts:1472-1530`
- **Evidence:** None of the three folder management operations audit.

**P3 — Billing mutations (`POST /billing/checkout`, `POST /billing/portal`)**
- **File:** `billing.controller.ts:57,89`
- **Evidence:** No audit rows. The Stripe webhook writes audit rows (in `stripe.service.ts`) but the _initiation_ of a checkout session or portal session is not logged.
- **Impact:** Forensics cannot answer "who initiated the checkout flow at time T" — only what Stripe confirmed. Low severity since Stripe's own logs cover this.

### 16.4 Idempotency / Replay-Attack Tables

Two idempotency tables confirmed in schema and live DB:

| Table | Schema | Live rows |
|-------|--------|-----------|
| `processed_stripe_events` (`evt_*` Stripe IDs) | `schema.prisma:559-566` | 0 (no real Stripe events yet — test mode) |
| `processed_pos_events` (composite `${providerId}:${externalEventId}`) | `schema.prisma:1706-1714` | (not queried, POS in test mode) |

**WS eventId dedup:** Per-pod `recentEmergencyAudit` map in `manifest-hot-cache.ts:108` (6h debounce per `screenId:setHash`). Not cross-replica but TTL-bounded — a second pod seeing the same emergency hash within 6h writes a duplicate audit row, not a correctness issue. Low severity.

**Billing webhook ordering:** `stripe.service.ts` uses `ProcessedStripeEvent` in a `$transaction` with `upsert` and a uniqueness check, preventing double-processing. Confirmed idempotent per code trace.

### 16.5 DB-Level Immutability — Full Trigger Inventory

```sql
-- Live as of 2026-06-10:
SELECT tgname, tgrelid::regclass FROM pg_trigger WHERE tgname NOT LIKE 'RI_%';
→ audit_logs_immutable   ON audit_logs          (BEFORE UPDATE OR DELETE → raise exception)
→ tr_check_filters       ON realtime.subscription  (Supabase internal)
→ protect_buckets_delete ON storage.buckets         (Supabase internal)
→ protect_objects_delete ON storage.objects         (Supabase internal)
→ update_objects_updated_at ON storage.objects      (Supabase internal)
```

Only one application-level trigger exists: `audit_logs_immutable`. No application triggers on `users`, `screens`, `playlists`, or `tenants` — immutability is enforced only at the API layer via the RBAC / NestJS guard stack, not at DB level. This is acceptable (DB-level immutability on every table is extreme), but any future raw-DB access (migrations, support scripts) could silently mutate those rows. Documented risk.

---

## Section 17 — Operational + DX

### 17.1 Live Health Endpoints (curl, 2026-06-10T13:34 UTC)

All three endpoints responding correctly:

```
GET /api/v1/health          → 200 {status:"ok", db:"ok", redis:"ok", commit:"cf5772ae", uptime_s:62325}
GET /api/v1/health/ready    → 200 {status:"ok", db:"ok"}
GET /api/v1/health/emergency-path → 200 {status:"ok", db:"ok", redis:"ok", ws_signer:"ok"}
```

**Notes:**
- `commit` field on liveness matches the latest pushed commit (`cf5772ae`). Version tracking is live.
- Emergency-path endpoint verifies `ws_signer:"ok"` — the signing chain is healthy at time of audit.
- All three return 200. Liveness returns even if Redis were down (correct — Railway uses `/health` not `/health/ready`).
- `railway.json` `healthcheckPath: /api/v1/health` confirmed correct: liveness, not readiness.

### 17.2 Railway Boot (`railway-start.sh`)

**Status: SOLID.** `scripts/railway-start.sh`:
1. Checks `DATABASE_URL` and `DIRECT_URL` presence with a `[ -z ]` fast-fail.
2. Tries `prisma migrate deploy` via three candidate paths before falling back to `pnpm --filter @cms/database run db:deploy`.
3. Has `SKIP_MIGRATE=true` escape hatch for CI smoke tests (prevents false-fail when a container is launched with a fake `DATABASE_URL`).
4. Uses `set -e` — any failure propagates, triggering Railway's 10-retry restart policy.
5. Ends with `exec node apps/api/dist/main.js` (correct `exec` handoff — signals pass through to Node).

**Dockerfile:** CMD is `./scripts/railway-start.sh`; `railway.json` `startCommand` is the same. No HEALTHCHECK instruction in Dockerfile (Railway's `healthcheckPath` covers this), but portability gap noted.

**Migration idempotency:** `prisma migrate deploy` is idempotent — verified by presence in `_prisma_migrations`. Each Railway restart safely re-runs it.

### 17.3 Multi-Replica Safety Inventory

Systematic inventory of all in-memory state that would diverge across 2+ pods:

| Cache / State | Location | Multi-replica safe? | Notes |
|---------------|----------|---------------------|-------|
| `tenantStateCache` (emergency state, 2s TTL) | `manifest-hot-cache.ts:37` | **ACCEPTABLE** | 2s TTL; WS broadcast invalidates immediately via `invalidateTenantState`. Worst case: 2s stale manifest. File documents this intentionally. |
| `lastPingWrites` (25s debounce per screenId) | `manifest-hot-cache.ts:38` | **ACCEPTABLE** | Debounce suppresses redundant DB writes. Two pods both writing lastPingAt for same screen wastes 1 write/25s — not a correctness issue. |
| `recentEmergencyAudit` (6h debounce per screenId:hash) | `manifest-hot-cache.ts:108` | **ACCEPTABLE** | Cross-pod duplicate audit rows bounded by 1 extra row per 6h. Not a correctness or security issue. |
| AI hourly cap window | `ai-hourly-cap.ts` | **SAFE** | Redis sorted-set (`ai:rl:gen:<tenantId>`). Fail-open when Redis unavailable (documented design choice — durable monthly Postgres cap + per-call max_tokens are the real ceiling). |
| MFA rate limiter | `auth/mfa-rate-limiter.ts:33` | **UNSAFE at scale** | In-memory `Map<string, UserAttemptState>`. Attack from pod A resets on pod B. Documented comment says "v1 only"; Redis-backed is the documented follow-up. At single-replica (current) this is fine. |
| Branding scrape rate limiter | `branding/branding-rate-limiter.ts:38` | **UNSAFE at scale** | In-memory `Map<string, number[]>` of tenant hit timestamps. Scrape from pod A does not count against pod B's bucket. Current single-replica: fine. |
| Bug submit rate limiter | `bugs.controller.ts:133` | **UNSAFE at scale** | In-memory `Map<string, number[]>`. Spam from pod A not seen by pod B. Current single-replica: fine. |
| Renderer cache (SSR URL renders) | `proxy/renderer.service.ts:58` | **ACCEPTABLE** | 10-min TTL, 50-entry cap. Per-pod cache means N pods each maintain their own render cache — extra memory, not a correctness issue. No cross-pod stale URL served to any screen. |
| Efficiency metrics (`routeBytes`, `routeCounts`, `routeLatencySum`) | `efficiency/efficiency-metrics.service.ts:47-49` | **ACCEPTABLE** | Per-pod telemetry aggregation. Already noted as "in-process" in code comments. Metrics undercount at >1 replica but don't affect correctness. |

**Summary:** At the current single-replica Railway deployment, all in-memory state is safe. The three rate limiters (MFA, branding-scrape, bug-submit) are the only ones that become security/correctness boundaries at 2+ replicas, and all three have Redis follow-up paths documented. **Pre-condition: before adding a second API replica, move these three to Redis.**

The AI cap was already moved to Redis (P1-7/P1-14 fix, `ai-hourly-cap.ts`) — that is the correct pattern for the others.

### 17.4 Connection Pool Hygiene

**Status: SOLID.**

`.env.example` line 2-7:
```
CRITICAL: keep connection_limit=10 (or higher) and pool_timeout=20.
DATABASE_URL="postgresql://...?pgbouncer=true&connection_limit=10&pool_timeout=20"
```

CLAUDE.md documents this requirement and the root cause (Prisma pgbouncer default of 1). The `connection_limit=1` silent-killer lesson is encoded in memory. The health endpoint verifies `db:"ok"` on every check.

**No regression found:** no raw `DATABASE_URL` in any test fixture or code that would strip the pool params.

### 17.5 Pre-Push Hook

**Status: SOLID.** `.husky/pre-push`:
- Runs `pnpm preflight` (lockfile sync + workspace TS builds + API TS + web TS).
- Includes a non-blocking workspace hygiene warning (leftover worktrees, `.git` health, stale branches, dirty tree).
- `set -e` on preflight; exits 1 and blocks push on failure.
- Emergency bypass documented (`git push --no-verify`).

### 17.6 Worktree Hygiene Tooling

**Status: SOLID.**

`package.json` contains:
```
"worktrees:status": "bash scripts/cleanup-worktrees.sh"
"worktrees:clean":  "bash scripts/cleanup-worktrees.sh --execute --branches"
```

`scripts/hygiene-check.sh` is wired into `.husky/pre-push` (non-blocking) and checks: worktree count, `.git` object health (loose + garbage), dirty tree, stale local/remote branches, backup-tag clutter. The 83 GB / 154-tree pileup lesson is encoded in both the script and CLAUDE.md pre-dispatch checklist.

**Current state (`git worktree list`):** Only main tree present — no leftover agent trees.

### 17.7 Boot-Time Secret Enforcement

`apps/api/src/security/required-secret.ts` enforces `JWT_SECRET`, `SESSION_SECRET`, `DEVICE_SECRET_KEY`, `DEVICE_JWT_SECRET` on production boot. API refuses to start if any are missing/empty. Dev uses loud warning + fixed fallback (acceptable). Verified solid per prior audit.

---

## Findings Summary

### P2 Findings

**F16-1 (P2): `PUT /schedules/:id` has no AuditLog row**
- Controllers that change what content plays on which screens MUST be audited. Toggle and Delete are audited; Update is not.
- Fix: Add `SCHEDULE_UPDATED` row in `schedules.controller.ts:update()`. 15-minute fix.

### P3 Findings

**F16-2 (P3): Playlist create/update/activate have no AuditLog rows**
- `POST /playlists`, `PUT /playlists/:id`, `PUT /playlists/:id/items`, `PUT /playlists/:id/active` — none audit.
- Impact: Silent content replacement is undetected forensically.

**F16-3 (P3): Asset upload (normal path) has no AuditLog row**
- `POST /assets/upload`, `POST /assets/presign`, `POST /assets/complete-upload`, `POST /assets/url` — no creation audit.
- Emergency asset upload IS audited (`assets.controller.ts:557`). Normal path is not.

**F16-4 (P3): Asset folder CRUD and asset move have no AuditLog rows**
- `POST /assets/folders`, `PUT /assets/folders/:id`, `DELETE /assets/folders/:id`, `PUT /assets/:id/move`

**F17-1 (P2): MFA, branding-scrape, and bug-submit rate limiters are in-memory (scale pre-condition)**
- Safe at 1 replica (current state). Must be moved to Redis before adding a second API pod.
- AI cap is already Redis-backed (the correct pattern). Apply same pattern to `mfa-rate-limiter.ts`, `branding-rate-limiter.ts`, `bugs.controller.ts` rate limiter.

---

## Confirmed Solid (no re-work needed)

- `audit_logs_immutable` DB trigger: exactly one, enabled, dedup migration landed on 2026-06-09.
- All 3 health endpoints: live, correct status, correct `db`/`redis`/`ws_signer` fields.
- `railway-start.sh`: idempotent, verbose, `set -e`, correct `exec` handoff.
- AI hourly cap: Redis-backed, fail-open design documented.
- Manifest hot cache: TTL-bounded, WS invalidation wired.
- `connection_limit=10&pool_timeout=20` documented and enforced in `.env.example`.
- Pre-push hook: runs preflight, hygiene warning, documented bypass.
- Worktree hygiene tooling: `worktrees:status` + `worktrees:clean` + `hygiene-check.sh` in pre-push.
- Boot-time secret enforcement: production refuses to start without required secrets.
- `ProcessedStripeEvent` + `ProcessedPosEvent` idempotency tables: confirmed in schema.
- Duplicate immutability trigger migration: confirmed applied and resolved.
- KNOWN-OPEN from prior audits still open: pilot credentials in public doc, weak prod JWT/SESSION secret pattern, Stripe in test mode, canTriggerPanic JWT claim staleness.
