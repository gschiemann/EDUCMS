# Pre-launch FINAL Audit — Sections 16 (Forensic / Audit Coverage) + 17 (Operational + DX)

**Auditor:** fresh-pass frontier model (forensic + ops lane) · **Date:** 2026-06-09/10 · **Repo:** master @ `cf5772ae` · **Live:** https://venue-os.app (API running `cf5772ae`, uptime ~19.5h at audit time)
**Dedup:** checked against `docs/research/2026-06-09-full-audit/REPORT.md` and `docs/research/2026-06-08-launch-readiness-audit/00-MASTER-SYNTHESIS.md`. Items already there are listed under KNOWN-OPEN (verified) or Solid (verified fixed) — not re-reported as new.
**Method:** every documented safeguard traced to real callers; prod DB inspected read-only via postgres MCP; live endpoints curled; no mutations, no emergency triggers, no SUPER_ADMIN login.

---

## Coverage table

| § | Bullet | Coverage | D | UX | F |
|---|---|---|---|---|---|
| 16 | AuditLog on every privileged action | **covered** (gaps found — see F-1/F-2) | A− | A− | **B+** |
| 16 | DB-level immutability triggers | **covered — VERIFIED IN PROD** | — | — | A |
| 16 | Cross-tenant scope on actor checks | covered-by-prior (06-08/06-09: no IDOR; spot-confirmed `req.user.tenantId` scoping in every file read) | — | — | A− |
| 16 | Replay defense / idempotency tables | **covered** — real tables verified in prod | — | — | A− |
| 16 | Cron consistency checks | **covered** — License↔Stripe ✓ real; address↔lat/lng ✗ missing (F-7) | — | — | B |
| 17 | Health endpoints (liveness/ready/emergency-path) | **covered — all 3 curled live, 200** | A | A | A |
| 17 | Pre-deploy CI gates | **covered** — 11 workflows incl. taurus-safety, cross-browser, a11y, emergency-path, deploy-reliability, prod-smoke | A | A | A |
| 17 | Pre-push hooks (lockfile drift, **secret scan**) | **covered** — lockfile ✓ real; **secret scan: CI-only, no local hook** (F-6) | — | A− | B+ |
| 17 | Rollback (git tag + tarball) | **covered** — `backup/pre-shim-v5-20260607-191715` etc. + `docs/BACKUP_AND_ROLLBACK.md` present | — | A | A− |
| 17 | Multi-replica safety | **covered** — full inventory below (F-5); `numReplicas: 1` pinned in railway.json is currently the only guard | — | — | B |
| 17 | Connection pool sizing | **covered — boot-enforced, verified** | — | — | A |
| 17 | Boot-time required-secret enforcement | **covered — all 4 secrets traced to `requireSecret()`** | — | — | A |

**Section grades:** §16 D **A−** / UX **A−** / F **B+** · §17 D **A** / UX **A** / F **A−**

Nothing in the assignment was scoped down. Cross-tenant scope verification relied partly on the 06-08/06-09 IDOR sweeps (cited) rather than a fresh 64-controller re-sweep; every file I did open was correctly tenant-scoped.

---

## 1. Prod DB state — audit_logs triggers (the assignment's named check)

```sql
SELECT tgname FROM pg_trigger WHERE tgrelid='audit_logs'::regclass AND NOT tgisinternal;
-- → audit_logs_immutable   (exactly one row)

SELECT pg_get_triggerdef(oid) ...
-- → CREATE TRIGGER audit_logs_immutable BEFORE DELETE OR UPDATE ON public.audit_logs
--   FOR EACH ROW EXECUTE FUNCTION audit_logs_block_mutation()
```

**Pre/post state:** the dedup migration `20260609000000_dedupe_audit_immutability_triggers` is **already applied in prod** — `_prisma_migrations.finished_at = 2026-06-09T20:16:02Z`, which matches the live API boot (uptime 70,252s at 2026-06-10T15:46Z ⇒ booted ~20:16Z on 06-09). The duplicate 0526 trigger pair (`audit_log_immutable_no_update/_no_delete`) is **gone**; UPDATE and DELETE are both blocked by the single remaining trigger. **H10 / P1-1 (migration-ordering bug, user-deletion 500) is FIXED and verified against the real database** — Railway's `railway-start.sh` ran `prisma migrate deploy` on the cf5772ae boot exactly as designed. No "next boot" pending: it already happened.

## 2. Replay / idempotency tables (verified in prod `pg_tables`)

| Table | Purpose | Status |
|---|---|---|
| `processed_stripe_events` | Stripe webhook replay defense (P0-7) | present |
| `processed_pos_events` | POS webhook (Square) replay defense | present |
| `usb_ingest_events` | USB sneakernet signed-manifest ingest dedup | present |
| `webhook_deliveries` | outbound webhook retry queue; worker claims rows with `FOR UPDATE SKIP LOCKED` (`webhook-retry.worker.ts:90-110`) — explicitly multi-replica-safe | present |
| `password_reset_tokens` | single-use reset tokens | present |
| `email_logs`, `clever_sync_logs` | send/sync forensics | present |

Player-side per-eventId WS dedup + 30s freshness window: verified by the 06-08/06-09 audits; not re-traced. Note: there is **no `jwt_revoked_list` table** — revocation is Redis-backed (live `/health` shows `redis: ok`, so it is active in prod); the Redis-less silent-no-op window is KNOWN-OPEN H1/P1-8.

## 3. Forensic sweep — privileged mutations vs AuditLog writers

Method: enumerated all 48 controllers with `@Post/@Put/@Patch/@Delete` handlers (118+ mutation routes), cross-referenced against every file containing `auditLog.create` (44 files), then attributed audit calls to specific routes by line-number ranges in the hot controllers.

### Verified AUDITED (real rows, traced to call sites)
- **Login** — `AUTH_LOGIN_SUCCESS` / `AUTH_LOGIN_FAILED` both write rows (`auth/auth.controller.ts:51,63`); P0-4 from 05-28 stays fixed.
- **Templates** — the 05-28 "templates unaudited" P0 is genuinely closed: a private `audit()` helper (templates.controller.ts:~47-69, warn-on-failure not silent) is called from **13 sites** covering create/update/delete/import/duplicate/from-preset/generate-touch/scenes/zones (lines 606→1485). Full coverage.
- **Users** — create (235), role change (296), `can-trigger-panic` (411), delete (463) all audit in-tx. Only `PUT /me` (first/last name only — verified body) is unaudited; acceptable.
- **Emergency** — trigger/all-clear/per-screen overrides audit (emergency.controller.ts, screen-emergency.controller.ts); plus `invalidateTenantState()` called on both trigger (575) and all-clear (752).
- **AI keys** (`ai-key.controller.ts` 3 writes ≥ 2 mutations), **API keys**, **MFA**, **billing** (stripe.service.ts + license-reconcile.cron.ts audit License mutations; `billing.controller.ts` activate-trial path audits), **branding** (8/9), **sponsors** (sponsors.service.ts), **CTS cue-fired** (screens.controller.ts:1900), **force-update / refresh-web** (2200/2275/2327/2364), **devices, imports, floor-plans, panic-content, usb-export, player-logs, super-license, SSO, onboarding, webhooks, Clever**.

### F-1 (P2) — Emergency-adjacent + key-rotation tenant settings have NO audit row
`tenants/tenants.controller.ts`: `PUT me/location-based-emergency` (line 552), `PUT me/auto-update-player` (588), `PUT me/usb-ingest` (813 — enables/disables sneakernet), `POST me/usb-ingest/rotate-key` (826 — **rotates the USB signing key**) write no AuditLog (next audit write in file is 665/774, attributed to ota-window/canary). CLAUDE.md §16 explicitly requires a row on "every key change". Toggling location-based emergency behavior or rotating the sneakernet signing key with zero forensic trail is exactly the class the audit log exists for. Fix: reuse the in-file `tx.auditLog.create` pattern (4 small additions).

### F-2 (P2) — Audit-coverage breadth gaps across fleet/content mutations (class sweep)
- **Screens:** `DELETE /:id` (screens.controller.ts:2379-2392) deletes schedules + the screen with **no audit row** — a fleet device (the thing that renders lockdown alerts) can vanish without trail. `POST /pair` (1143-1270) has **zero** audit writes while unpair (1325) audits — asymmetric. `PUT /:id` (1354) and `PUT /:id/location` (1926) also unaudited.
- **Playlists:** only DELETE audits (playlists.controller.ts:396); create (136), update (188), items replace (205), **active-toggle (286 — changes what plays on screens)** do not. (publish-to-fleet audits via playlist-distribution.service.ts:256.)
- **Schedules:** toggle (285) + delete (319) audit; create (46) + update (193) do not.
- **Assets:** approve/reject/delete/alt-text/emergency-upload audit; the actual ingestion paths — presign (585), complete-upload (617), upload (832), URL-asset create (1238), move (1437), folder create/rename/delete (1472/1499/1512) — do not.
- **Zero-audit modules with admin-gated mutations:** `sample-data` (6 routes incl. seeding real `PosProviderConnection`/`StreamProviderConnection` rows; wipe is SAMPLE_TAG-scoped + role-guarded — verified benign), `fitness/stick-control` (create/delete/**command** — sends signed STICK_COMMAND to kiosks, no trail), `notifications/help`, `integrations/discover|describe` (spends platform Tier-1 AI budget, no usage trail), `music`.

None of these is an authz hole (all are guarded + tenant-scoped where read); the gap is forensic. Recommend a cheap CI guard: a spec that walks controllers and asserts each `@Post/@Put/@Delete` in a privileged-module allowlist has an audit write in its handler chain — that's how this class stays closed.

## 4. Multi-replica safety inventory (the enumerate-each deliverable) — F-5 (P2 as a class)

`railway.json` pins `numReplicas: 1` — that pin is currently the ONLY thing standing between prod and every item below. No boot assertion exists that detects/refuses >1 replica.

**In-memory state that becomes wrong/weak at 2 replicas:**

| # | Site | What breaks at 2 replicas |
|---|---|---|
| 1 | `auth/mfa-rate-limiter.ts:33` | MFA brute-force lockout per-pod → attacker gets N× attempt budget; resets on deploy. **Security boundary** (file comment admits Redis SETNX alternative) |
| 2 | `sports/sponsors.controller.ts:65` | impression rate limit per-pod → N× write amplification (KNOWN-OPEN H5) |
| 3 | `ai/ai-hourly-cap.ts:63` | **fail-OPEN by contract** when Redis null/down → cap unenforced (KNOWN-OPEN H5); Redis-backed when up, so replica-safe but availability-weak |
| 4 | `branding/branding-rate-limiter.ts:38`, `data-source/data-source-rate-limiter.ts:33`, `bugs/bugs.controller.ts:133`, `sports/sports-board.controller.ts:33` | per-tenant/user throttles become per-pod (N× budget) |
| 5 | `pos/pos-oauth.controller.ts:112` `stateCache` | **OAuth connect state in memory** — callback landing on the other pod = "invalid state", flow dead (see F-4: also dies on any redeploy mid-flow at 1 replica) |
| 6 | `fitness/stick-control.controller.ts:71` `STICKS` | the whole stick registry is a module Map (see F-3) |
| 7 | `screens/manifest-hot-cache.ts:37,38,108` | emergency-state cache: `invalidateTenantState` on trigger only clears the **triggering pod**; the other pod serves stale manifest ≤2s TTL. Bounded + WS is the primary path — **designed and documented** (header comment), acceptable; ping-debounce + audit-debounce maps just dedupe less |
| 8 | `proxy/renderer.service.ts:58`, `player-ota/player-ota.controller.ts:849`, `fitness/youtube-live.controller.ts:42`, `sports/sports.service.ts:73,357` | pure caches — benign duplication |
| 9 | `efficiency/efficiency-metrics.service.ts:47-49` | per-pod metrics → misleading efficiency alerting |

**Interval workers (11 `setInterval` sites) — leader election audit:**
- **SAFE by design:** `webhooks/webhook-retry.worker.ts` (`FOR UPDATE SKIP LOCKED` claim, attempts++ in claim — verified :90-110); `templates/ensure-system-presets.ts` (`pg_advisory_lock(424242)` :323); `sports/clock-advance.service.ts` (anchor-based — server stores clock anchor, sweep only advances *expired* clocks, idempotent).
- **UNGUARDED (double-run at 2 replicas):** `license-reconcile.cron.ts` (double Stripe reconcile + duplicate audit rows), `notifications/offline-screen-scanner.ts` + `efficiency-alerting.service.ts` (**duplicate operator alert emails**), `player-ota/canary-auto-promote.ts` (racing promote decisions), `pos/pos-sync.cron.ts` + `clever-sync.cron.ts` (concurrent syncs vs cursors), `analytics/proof-of-play.sampler.ts`, `screens/screen-wedge-detector.cron.ts`, `realtime/sse.service.ts` (heartbeat — connection-local, fine).

**Verdict:** at 1 replica everything is correct. Before EVER setting `numReplicas: 2`, the preconditions are: Redis-or-DB rate limiters (items 1-4), OAuth state → DB/Redis (5), sticks → Prisma (6), and a shared-lock wrapper (advisory-lock helper exists in-repo) around the 7 unguarded crons. Recommend a boot log/warn keyed off `RAILWAY_REPLICA_ID` as a tripwire.

## 5. Ops verification (every bullet traced)

- **Health endpoints (live curl 2026-06-10T15:46Z):** `/health` 200 `{db:ok, redis:ok, commit:cf5772ae}`; `/health/ready` 200 `{db:ok}`; `/health/emergency-path` 200 `{db:ok, redis:ok, ws_signer:ok}`. Liveness/readiness split real; emergency-path verifies the signer chain pre-drill.
- **`railway-start.sh`:** verified — POSIX sh, `set -e`, fails fast on missing `DATABASE_URL`, runs `prisma migrate deploy --schema=packages/database/prisma/schema.prisma` via 3-path binary resolution + pnpm fallback, `SKIP_MIGRATE` escape documented as CI-smoke-only, then `exec node apps/api/dist/main.js`. **Proven in prod:** the 06-09 boot applied the dedup migration (§1).
- **connection_limit hygiene:** `main.ts:152-170` — API **refuses to start** when `pgbouncer=true` without `connection_limit>=10` (regex-parses the URL, demands `pool_timeout` headroom guidance). Prod is up + `db: ok` ⇒ compliant URL. This is real enforcement, not a doc convention.
- **Boot-time required secrets:** all four traced to `requireSecret()` (throws in prod): `JWT_SECRET` auth.module.ts:25 · `SESSION_SECRET` main.ts:111 · `DEVICE_SECRET_KEY` websocket-signer.service.ts:59 · `DEVICE_JWT_SECRET` jwt-auth.guard.ts:78. (Secret *strength* is the separate KNOWN-OPEN B-2 — weak prod values pending Greg's rotation.)
- **Pre-commit hook:** lockfile-drift gate (`--frozen-lockfile --lockfile-only`) + the `inset:0`/Tailwind-inset Taurus scan with the documented KioskSplash/player allowlist. Real.
- **Pre-push hook:** non-blocking hygiene warning (worktrees/.git health) + **blocking `pnpm preflight`** (workspace TS builds + api + web). Real. **Gap → F-6:** no local secret scan in either hook; gitleaks runs only in `ci.yml` — i.e. *after* the push, when a secret is already public on GitHub. Given the `.codex/config.toml` incident, a staged-files gitleaks pre-commit is the cheap missing layer (CLAUDE.md §17 bullet names "secret scan" as a hook concern).
- **CI gates:** 11 workflows present: `ci` (incl. gitleaks), `deploy-reliability` (4-job build matrix), `taurus-safety`, `cross-browser`, `a11y`, `emergency-path`, `prod-smoke` (+webkit-nav), `lighthouse`, `ota-wiring`, `keep-warm`, `android-player-apk`.
- **Rollback discipline:** `docs/BACKUP_AND_ROLLBACK.md` present; fresh `backup/*` tags exist (latest `backup/pre-shim-v5-20260607-191715`); the 90-stale-tag prune already done (task #226).
- **Worktree/hygiene tooling:** `pnpm worktrees:status|clean` → `scripts/cleanup-worktrees.sh`; `pnpm hygiene[:deps]` → `scripts/hygiene-check.sh`; hygiene wired into pre-push as a warning. Real and wired.
- **Dockerfile:** zero `HEALTHCHECK` directives — KNOWN-OPEN M6 confirmed (Railway's healthcheckPath covers today; portability gap only).

## 6. KNOWN-OPEN (verified still open, already tracked — not new findings)
- **H5a** AI hourly cap fails open without Redis — confirmed at `ai/ai-hourly-cap.ts:63` ("fail-open: no Redis → don't enforce").
- **H5b** Sponsor impression limiter in-process — confirmed `sponsors.controller.ts:65`.
- **H1/P1-8** JWT/panic revocation Redis-backed, silent no-op if Redis down at privilege change (Redis currently ok in prod).
- **M6** Dockerfile HEALTHCHECK absent — confirmed (grep = 0).
- **B-1/B-2/B-3/B-4** config/secret blockers — out of this lane's scope, unchanged status assumed; not re-tested.

## 7. New findings (summary)

| # | Sev | Finding |
|---|---|---|
| F-1 | P2 | Tenants: location-based-emergency / auto-update-player / usb-ingest enable / **usb-ingest rotate-key** mutations write no AuditLog (key rotation explicitly required by §16) |
| F-2 | P2 | Audit breadth: screen DELETE + PAIR, playlist create/update/items/**activate**, schedule create/update, asset upload/url/move/folders, sample-data seeds, stick commands — no AuditLog rows |
| F-3 | P2 | `STICKS` registry is an in-memory Map (stick-control.controller.ts:71) — every Railway deploy wipes all tenants' registered streaming sticks; honest phase-1 TODO in code, but it's a live tenant-facing feature losing data ~daily |
| F-4 | P2 | POS OAuth `stateCache` in memory (pos-oauth.controller.ts:112) — an API restart/redeploy mid-OAuth kills the Square connect flow even at 1 replica; breaks structurally at 2 |
| F-5 | P2 | Multi-replica class broadened beyond H5: MFA lockout limiter + 4 more in-memory throttles + 7 unguarded interval crons (dup alert emails, racing canary promote, double Stripe reconcile); only guard is the railway.json `numReplicas:1` pin, no boot tripwire |
| F-6 | P2 | No local secret scan (pre-commit/pre-push) — gitleaks is CI-only, which on a PUBLIC repo fires after exposure; CLAUDE.md §17 names "secret scan" as a hook control |
| F-7 | P3 | §16 bullet "Tenant.address vs lat/lng" consistency cron does not exist (only License↔Stripe reconcile is built); task #60 still pending |

**Bottom line:** the load-bearing forensic spine is real and verified against prod — immutability trigger (exactly one, UPDATE+DELETE), migrate-on-boot, login/emergency/template/user/billing audit rows, idempotency tables, boot-enforced pool + secrets, live health chain. What's left is breadth (a ring of second-tier mutations with no trail) and the documented-but-unenforced single-replica assumption. Nothing here blocks launch at 1 replica with Redis up; F-1/F-2 are the cheapest trust wins (copy the existing in-file audit pattern), F-5 is a hard precondition gate before scaling.
