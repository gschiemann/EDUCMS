# AUDIT — §16 Forensic/Audit · §17 Operational/DX

> Opus 4.8 full-app audit, 2026-05-28. Read-only. `numReplicas: 1` confirmed in
> `railway.json` — de-rates every "multi-replica hazard" to *latent* (breaks the
> instant anyone scales to 2+, not a live bug today).

## Page-1 Coverage (D / UX / F)
| # | Domain | D | UX | F | Status |
|---|---|---|---|---|---|
| 16a | AuditLog row on every privileged action | — | B | **C** | gaps: login/template/sponsor/notification mutations write NO DB audit row |
| 16b | Global `AuditInterceptor` (claimed catch-all) | — | — | **D** | **Theater** — stdout only; references a FluentBit→S3/CloudWatch shipper that does not exist |
| 16c | DB immutability triggers (UPDATE+DELETE) | A | — | **A** | blocks BOTH; live `/health` proves DB up |
| 16d | Cross-tenant scope verification | A | — | **A** | only `super-license` reads client tenantId; all tenant endpoints use `req.user.tenantId` |
| 16e | Replay-attack defense (Stripe dedup, eventId) | A | — | **A** | `processed_stripe_events` ledger + ordering guard |
| 16f | Cron consistency checks (License↔Stripe, addr↔geo) | — | — | **F** | not built — Stripe sync is event-driven fire-and-forget only |
| 17a | Health endpoints | A | A | **A** | all 3 live & correct (curl below) |
| 17b | Pre-deploy CI gates | A | — | **A** | all gate on push+PR to master |
| 17c | Pre-push/pre-commit hooks | B | — | **B** | secret-scan is CI-only, NOT in the hook (CLAUDE.md §17 doc wrong) |
| 17d | Rollback procedure | A | A | **A** | docs + tag discipline |
| 17e | Multi-replica safety | — | — | **B** | 3 in-memory rate limiters; safe at numReplicas:1, breaks at 2+ |
| 17f | Connection pool sizing | A | — | **A** | boot refuses connection_limit<10/pool_timeout<20; live db:"ok" |
| 17g | Boot-time required-secret enforcement | A | — | **A** | requireSecret throws in prod |

## Live health curl (prod, 2026-05-28 18:26 UTC)
```
GET /health            → 200 {"status":"ok","db":"ok","redis":"ok",commit:45d07b5}
GET /health/ready      → 200 {"status":"ok","db":"ok"}   (503 if DB down — code L140)
GET /health/emergency-path → 200 {"db":"ok","redis":"ok","ws_signer":"ok"}
```
All healthy, commit matches master HEAD — deploy current.

## PRIVILEGED-ENDPOINT × AUDIT-ROW MATRIX (selected)
| Action | AuditLog? | Tenant-scoped? | Evidence |
|---|---|---|---|
| emergency trigger/all-clear | ✅ (9) | ✅ | emergency.controller.ts |
| **`POST /auth/login` (success+failure)** | ❌ **NONE** | n/a | auth.controller.ts L36-40 — zero audit on login |
| auth/logout | ✅ | ✅ | L84 |
| MFA mutate | ✅ | ✅ | mfa.controller.ts |
| AI key set/rotate/revoke | ✅ (3) | ✅ | ai-key.controller.ts |
| Stripe → License mutation | ✅ (3) | ✅ | stripe.service.ts |
| super/license/comp | ✅ (4, in tx) | SUPER cross-tenant by design | super-license.controller.ts L173 |
| Submission approve/reject | ✅ | ✅ | submissions.controller.ts L292 |
| Bug approve/triage | ✅ (8) | ✅ | bugs.controller.ts |
| CTS cue-fired ingest | ⚠️ GameEvent not AuditLog | ✅ | sports-board.controller.ts L91 — proof-of-play table, defensible |
| CTS snapshot ingest | ❌ none (Game.stats.cts) | ✅ HMAC | L123 — transient state, defensible |
| **`templates/*` create/update/delete/import** | ❌ **NONE** | ✅ | templates.controller.ts — 14+ mutating endpoints, zero audit |
| Asset/Playlist/Schedule/Screen/Branding/Tenant/User/GPIO/POS/Streaming/SSO/USB/Floorplan | ✅ | ✅ | (all audited) |
| **Sponsor create/update/delete** | ❌ **NONE** | ✅ | sponsors — revenue config unaudited |
| Notification mutate | ❌ none | ✅ | low-value, acceptable |

**Caveat across ALL writes:** every `auditLog.create` is fire-and-forget
`.catch(()=>{})`. A DB hiccup silently drops the forensic row while the action
succeeds. "100% audit coverage" is best-effort, not guaranteed.

## MULTI-REPLICA HAZARD LIST (latent at numReplicas:1)
| Location | State | Role | Acknowledged? |
|---|---|---|---|
| ai.service.ts L108 `recentByTenant` | Map | 30/hr AI gen cap | yes |
| ai.service.ts L120 `recentFailuresByTenant` | Map | 200/hr AI failure cap | yes |
| branding-rate-limiter.ts L38-39 | Map+array | 30/tenant/hr + 1000 global scrape cap (SSRF boundary) | yes |
| sports-board.controller.ts L33 `feedHits` | Map | CTS feed+cue rate limit | partial |
| realtime.gateway.ts L33 `clients` | Map | WS registry | N/A — correctly per-replica |

**Sharpest:** branding-scraper global cap + AI failure cap are **abuse/SSRF
defenses**. At N replicas, effective limits multiply ×N — weakens the security
boundary, not just a UX cap.

## Verified strengths
- Immutability trigger real + complete (blocks UPDATE and DELETE, no exception).
- Stripe replay + ordering defense real.
- Boot-time secret enforcement real (SESSION_SECRET, ALLOWED_ORIGINS, DATABASE_URL pool).
- CI gates all fire on push AND PR + gitleaks in ci.yml.

## RANKED FIXES
**P0-1. `AuditInterceptor` is safeguard theater** (`security/audit.interceptor.ts`).
Registered globally; comment claims privileged actions go to "FluentBit → S3/
CloudWatch." **No such config exists** (grep returns only the comment). It only
`logger.log()` to stdout → Railway ephemeral buffer. Reads as "all POST/PUT/DELETE
audited" — they are not. Same pattern as the 2026-05-21 verifyMessage theater.
**Fix:** make it write a real AuditLog row for uncovered actions, OR delete the
comment + rename to `RequestLogInterceptor`.

**P0-2. `POST /auth/login` writes no AuditLog — success OR failure.** Only logout
is audited. Failed-login forensics (credential stuffing: when, from which IP,
against which accounts) exist only as the throttler counter + stdout. **Fix:**
`AUTH_LOGIN_SUCCESS`/`AUTH_LOGIN_FAILED` rows (IP, UA, email-hash). Sweep the class.

**P1-3. Entire `templates` module writes zero AuditLog rows.** 14+ mutating
endpoints (create/update/delete/import/scenes/generate-touch), all SCHOOL_ADMIN+,
`grep auditLog apps/api/src/templates/` → nothing. A bad admin can delete/rewrite
every layout with no trail. **Fix:** `TEMPLATE_{CREATED,UPDATED,DELETED,IMPORTED}`.

**P1-4. Sponsor (ad-inventory) mutations unaudited** — revenue config that
proof-of-play billing depends on, no audit row. **Fix:** audit sponsor CRUD.

**P1-5. No periodic License↔Stripe reconcile cron** (CLAUDE.md §16 names it).
`syncSubscriptionQuantity()` is event-driven fire-and-forget on pair/unpair/delete
(`screens.controller.ts L1101,1206,2247`). If any call silently fails, Stripe
quantity drifts from seat count **permanently**. **Fix:** daily reconcile pass.

**P2-6. Multi-replica readiness debt** — move rate-limit/abuse counters to Redis
before scaling past 1 replica (infra already present). Add a guard/comment in
`railway.json`.

**P2-7. No `Tenant.address`↔lat/lng reconcile** (CLAUDE.md §16). N/A today (Sprint
8 map not wired); deferred-with-reason.

**P2-8. CLAUDE.md §17 doc inaccuracy** — secret scan (gitleaks) is CI, not the
pre-push hook (hook does lockfile + inset-0 only). Move gitleaks to pre-push or
fix the doc.
