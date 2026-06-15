# Platform Metrics + Tech-Currency Audit (2026-06-15) — LIVE DATA

Pulled from live Railway MCP + Supabase Postgres MCP (read-only) + codebase version audit.
Vercel: no MCP available here — assessed from config + the usage screenshot the operator shared.

## 1. Live infra metrics (REAL)

### Railway — `graceful-embrace` / production (api + Redis, both SUCCESS)
| Metric (api, 24h) | Value | Verdict |
|---|---|---|
| CPU avg / max | **4.3% / 17%** of a core | Idle — massive headroom |
| Memory avg / max | **0.19 GB / 0.34 GB** | Tiny footprint |
| Network rx/tx avg | 1.2 / 1.7 MB | Negligible |
| Latest deploy | 2026-06-15 16:57 UTC | Fresh |
→ The API is **wildly over-provisioned** (cheap, fast). No infra concern.

### Supabase Postgres (REAL)
| Metric | Value | Verdict |
|---|---|---|
| Version | **PostgreSQL 17.6** | LATEST major — cutting-edge ✅ |
| DB size | 31 MB | Pre-customer demo data |
| Cache hit ratio | **100.00%** | Perfect (fits in RAM) ✅ |
| Commit ratio | **99.98%** | Healthy ✅ |
| RLS coverage | **66 / 66 tables** | Strong defense-in-depth ✅ |
| Connections | **28 / 60** | OK now; watch at multi-replica scale ⚠️ |
| Extensions | pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp | Modern ✅ |

**Top DB cost (pg_stat_statements — the real hotspots):**
1. `UPDATE screens SET last_cache_report…` — 180,826 calls, **41.6%** of all DB time, **mean 19.84 ms**
2. `UPDATE screens SET last_rendered_at…` — 161,168 calls, **17.4%**, mean 9.33 ms
   → **59% of total DB time is player telemetry writes.** The 9–20 ms mean on a single-row PK update = **row-lock / write-amplification contention** on `screens` (also read 6.3 M times). #1 efficiency fix: throttle/batch telemetry (write every 30–60 s, or buffer in Redis & flush) instead of on every render/cache-report.
3. `SELECT name FROM pg_timezone_names` — 1,591 calls × **527 ms** = **9.7%** of DB time on a **static list**. Pure waste — cache the tz list in the app.
4. `pg_advisory_lock` — 910 calls, **mean 947 ms** (10%). A background job serializes ~1 s/lock; review it.
5. `game_events` table — **33.5% sequential scans**. Fine at 236 rows; **add a composite index `(gameId, createdAt)`** before real game volume.

### Vercel (from config + usage screenshot)
| Metric | Value | Verdict |
|---|---|---|
| Edge Requests | **887K / 1M (88%)** | ⚠️ near cap — *not* customer traffic |
| Fluid Active CPU | 1h57m / 4h | OK |
| Fast Data Transfer | 25.3 / 100 GB | OK |
| Function Invocations | 159K / 1M | OK |
→ Cause (confirmed prior turn): `vercel.json` proxies **all `/api/v1/*` through Vercel's edge**, and the board/ribbon poll every **750 ms** (no WebSocket). Every poll = 1 edge request. Fix: point `NEXT_PUBLIC_API_URL` direct at Railway + slow polling / use WS push.

## 2. Tech currency (versions vs latest stable)
| Tech | Ours | Latest | Status |
|---|---|---|---|
| Next.js | 16.2.6 | 16.x | ✅ latest |
| React | 19.2.4 | 19.x | ✅ latest |
| NestJS | 11 | 11 | ✅ latest |
| PostgreSQL | 17.6 | 17.x | ✅ latest |
| Tailwind | 4 | 4 | ✅ latest |
| TypeScript | 5.7 | 5.x | ✅ current |
| Zod / Zustand / React Query | 4 / 5 / 5 | same | ✅ latest |
| **Prisma** | **5.12** | **6.x** | ⚠️ **one major behind** |
| **Node (Docker)** | **20-alpine** | **22 LTS** | ⚠️ one LTS behind |
| Express | 4 | 5 (GA) | ⚠️ low priority |

**Cutting-edge not yet adopted:** WebSocket push for the live scoreboard (infra exists; currently polling), Next PPR / React Compiler (experimental), Prisma 6 query-engine perf.

## 3. Verdict
- **Secure:** A — PG 17, RLS on all tables, Argon2, vault, audit-log immutability. (Open: rotate the weak prod secrets from the launch audit; passport-saml CVE before SAML.)
- **Fast:** A — 100% cache, sub-ms Prisma reads, 4% API CPU, p-times tiny.
- **Efficient:** B− — three real waste sources: screen-telemetry write amplification (59% of DB), pg_timezone_names (10%), and Vercel edge-proxied 750 ms polling.
- **World-class / cutting-edge:** A− on the *stack* (all latest majors), B on *architecture* (polling where WS should push; Prisma + Node a step behind).

## 4. Prioritized actions
1. **Throttle player telemetry writes** (kills ~59% of DB load). HIGH.
2. **Cache `pg_timezone_names`** in app (kills ~10% of DB load, trivial). HIGH / easy.
3. **`NEXT_PUBLIC_API_URL` → Railway direct + slow/WS the 750 ms polling** (kills the Vercel edge bill). HIGH.
4. **Index `game_events(gameId, createdAt)`** before game volume. MED.
5. **Bump Prisma 5→6 and Node 20→22 LTS.** MED (test on Alpine Docker per CLAUDE.md).
6. Investigate the 947 ms advisory-lock job. LOW.
