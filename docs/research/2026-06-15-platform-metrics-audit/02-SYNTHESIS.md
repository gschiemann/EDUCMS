# Full-Company Health Scorecard (2026-06-15)

8 surface audits + adversarial verification (29 agents, ~3M tokens), grounded in live Railway + Postgres metrics. Raw: `01-full-company-audit-raw.json`.

## Grades
| Surface | Grade | One-line |
|---|---|---|
| Security | **A−** | Argon2id + DNS-rebind SSRF pin + CSRF-default + audit-log immutability + RLS on all 66 tables. Mature. |
| Player (kiosk + APK) | **B+** | Multi-transport emergency (WS→SSE→poll), SHA-256 SW cache, jitter-backoff reconnect. Hurt by telemetry write-amp. |
| Tech-currency / deps | **B+** | All latest majors, remediated lockfile, Docker-image CI. Hurt by Node 20 EOL, Multer 1.x, no staging. |
| Mobile (responsive web) | **B** | Overlay-lock pattern, viewport-clamped popovers, pro panic page. Hurt by redundant polling + browser geocode calls. |
| Web dashboard | **B** | Favicon-crash fix, stale-bundle self-heal, smart api-client. Hurt by eager-loaded widget tree + monolithic client routes. |
| Database | **B** | Disciplined migrations, RLS, hot-path caching. Hurt by the 59%-of-DB telemetry writes + a missing index column. |
| API (NestJS) | **B** | Strong error normalization, DbRetry, multi-replica billing. Hurt by user-delete 500, unprotected hot writes, envelope gaps. |
| Vercel / edge | **B** | SSRF-locked asset proxy, hashed caching, security headers. Hurt by 750ms polling + undocumented load-bearing config. |

**Overall: a legitimate B+ company on fundamentals.** Not "startup duct tape" — security and reliability are genuinely senior-grade. The drag is a tight, specific list of efficiency, one launch bug, and ops-maturity gaps.

## Verified critical findings (19; the ones that matter)

### P0 — config blocker (only you can do)
- **Weak prod JWT/SESSION/DEVICE secrets** still in use. Boot guard checks length, not entropy → rotate `JWT_SECRET`, `SESSION_SECRET`, `DEVICE_SECRET_KEY`, `DEVICE_JWT_SECRET` on Railway.

### P1 — code-fixable (I can do these)
1. **Telemetry write-amplification = ~59% of ALL DB time** (confirmed 3× + live pg_stat_statements). `cache-status` + `render-proof` do an unconditional `screens` UPDATE every 30s with no debounce and no `withDbRetry`. The fix (`shouldSkipLastPingWrite`) already exists on the ping path. **#1 efficiency win.**
2. **User deletion 500s** on any tenant with history — 7 `User` relations default to FK `Restrict` (P2003). Real launch bug. Fix: `onDelete: SetNull/Cascade` (additive migration) or catch P2003.
3. **`game_events` index omits `type`** — board sub-queries seq-scan per type (live 33.5%). Add `(gameId, type, createdAt)`.
4. **Hot writes not wrapped in `withDbRetry`** — the two highest-frequency writes lack the resilience primitive everything else uses.
5. **Error-envelope discipline (task #57)** — several controllers return HTTP 200 with bare `{error}` and no `code`. Clients can't tell success from failure.
6. **`NEXT_PUBLIC_API_URL` is undocumented load-bearing config** — must be Railway-direct (proxy breaks WS + spikes edge cost); one edit from a fleet outage. Document in `vercel.json`.
7. **Floor-plan images in a PUBLIC Supabase bucket** (sensitive building layouts; signed-URL is a fig leaf) — task #200. Move to private bucket.
8. **No staging environment** — master deploys straight to prod; prod-smoke runs AFTER customers are served. Ops-maturity gap (task #221).

### P2 — hardening (batchable)
- Mobile screens page double-polls the fleet every 10s; address picker still hits Nominatim/Photon directly from the browser (data leak / OSM ToS).
- Player: 3 overlapping heartbeats per kiosk.
- API: no global `ValidationPipe` (~18 controllers take raw `@Body()`); background crons single-replica-only (scaling landmine).
- Security: JWT revocation **fails OPEN** when Redis is down (contradicts the fail-closed comment).
- Tech: deprecated **Multer 1.x** in prod; **Node 20 EOL** (→ 22 LTS), no version pin; **Prisma 5→6**.

## Recommended sequencing
- **Wave 1 (biggest ROI, code):** telemetry debounce (#1) + game_events index (#3) + withDbRetry on hot writes (#4) → kills ~59% of DB load + fixes the scale path. Verify via pg_stat_statements delta.
- **Wave 2 (launch correctness, code):** user-delete FK (#2) + error envelopes (#5) + vercel.json doc (#6) + fail-open revocation (P2).
- **Wave 3 (you):** rotate secrets (P0) + private floor-plan bucket + staging env + Node 22 + Prisma 6.
