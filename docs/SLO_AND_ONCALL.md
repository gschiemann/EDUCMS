# SLOs & On-Call — VenueOS (EDU CMS)

**Status:** PROPOSED targets + HONEST current-state. **Last verified:** 2026-05-30.
**Audience:** the VenueOS team; district IT reviewers asking "what do you promise
and how do you watch it?"

> **Read this first.** The SLO *targets* below are **proposed**, not contractual
> — VenueOS has no signed SLA today. The "What we monitor today" section is the
> truth about current instrumentation; the "Gaps" section is blunt about what we
> do **not** have (chiefly: no paging / on-call rotation). Do not present the
> proposed numbers to a customer as a commitment until they are agreed in a
> contract and the alerting gap is closed.

---

## 1. The service, in tiers

VenueOS has two reliability classes, and they are not equal:

| Tier | What it covers | Why it matters |
|---|---|---|
| **Life-safety (T0)** | Emergency trigger → screens change; all-clear → screens revert. | This is the moat and the liability. It must work **even when the cloud is degraded** — the offline-first player + signed pub/sub + HTTP-polling manifest fallback exist for exactly this. |
| **Everyday signage (T1)** | Dashboard, playlists, scheduling, content sync, billing. | Important, but a 2-minute API blip degrades convenience, not safety. |

The architecture deliberately decouples them: an emergency is a tiny signed
message that flips a switch, not a content download. A player that has synced
once keeps playing (and can still show the pre-cached text emergency) with the
WAN down.

---

## 2. Proposed SLOs (targets, NOT a signed SLA)

| SLO | Proposed target | Measured how (proposed) | Notes |
|---|---|---|---|
| **Emergency-delivery latency** (T0) | Trigger → online player renders the alert in **< 2 s** p95 (WS path); **< 1 polling interval** on the manifest fallback. | Proof-of-display ACK timestamp vs trigger timestamp (data exists in the heartbeat/AuditLog; the dashboard surface is a V2 build — see B-2 in CLAUDE.md). | Content-level sync, not hardware genlock. Sufficient for K-12 / HS; genlock is a pro-tier add-on. |
| **API availability** (T1) | **99.5%** monthly (≈ 3.6 h/mo budget). | UptimeRobot keyword monitor on `GET /api/v1/health` (see `docs/UPTIME_MONITORING.md`). | Liveness only — `/health` returns 200 even if DB/Redis degraded, by design. |
| **API latency** (T1) | p99 **< 800 ms** for read endpoints under normal load. | Sentry performance traces (10% sample) + Railway request metrics. | Cold-start tail is mitigated by the keep-warm cron (§3). |
| **Player uptime** (T1/T0) | **99%** of paired screens reporting `lastPingAt` within the offline threshold. | `lastPingAt` on `Screen`; offline-screen-scanner flags stale screens (`notifications/offline-screen-scanner.ts`). | A screen offline to the WAN can still be playing locally — uptime here is *cloud reachability*, not *display blank*. |
| **Successful deploys** | **> 95%** of merges reach "Healthy" without a rollback. | Railway deployment status + CI green rate. | Backed by the deploy-reliability CI gates. |

These are starting points sized to the current free-tier infrastructure. Tighten
them when paid monitoring + a staging env land (see Gaps).

---

## 3. What we monitor TODAY (the honest current state)

| Signal | Tool | Status | Cite |
|---|---|---|---|
| Unhandled errors (API + web) | **Sentry** (free tier, 10% trace sample, PII-scrubbing `beforeSend`) | LIVE **when `SENTRY_DSN` is set** — disabled with a console warning when unset (honest degradation) | `apps/api/src/sentry.ts:37-40`; `docs/OBSERVABILITY.md` |
| Liveness | `GET /api/v1/health` — always 200, returns `{ status, db, redis, uptime, version }` | LIVE | `apps/api/src/health/health.controller.ts:79` |
| Readiness | `GET /api/v1/health/ready` — 503 when DB unreachable | LIVE (use for monitoring, **not** Railway healthcheck) | `health.controller.ts:126` |
| Emergency-path preflight | `GET /api/v1/health/emergency-path` — verifies DB + WS-signer chain | LIVE (run before a drill) | `health.controller.ts:151` |
| Integration health | `GET` integrations-health — per-provider configured/connected status | LIVE | `apps/api/src/health/integrations-health.controller.ts:155` |
| Cold-start / DNS-edge warmth | Vercel cron pinging `/health` every ~4 min | LIVE | `apps/web/src/app/api/cron/keepwarm/route.ts`; `apps/web/vercel.json` |
| Uptime + outage email/SMS | **UptimeRobot** free tier (4 monitors) | **DOCUMENTED, operator-provisioned** — setup guide exists; confirm it is actually configured for the live hosts | `docs/UPTIME_MONITORING.md` |
| Background-service health | offline-screen-scanner, cohort outage detection, canary auto-promote, license reconcile, webhook retry | LIVE (log to stdout / Sentry) | `apps/api/src/notifications/`, `apps/api/src/billing/license-reconcile.cron.ts`, `apps/api/src/webhooks/webhook-retry.worker.ts` |

---

## 4. Gaps — what we do NOT have (be honest)

- **No paging / on-call rotation and no real-time alerting pipeline.** Today,
  outages surface in **Sentry** and **Vercel/Railway logs**, and UptimeRobot can
  email/SMS — but there is **no PagerDuty/OpsGenie, no rotation, no escalation
  policy, and no guaranteed human response time.** Detection ≠ response. This is
  the single biggest reliability gap.
- **No error-budget policy.** The SLOs above are not yet tied to a
  "stop-shipping-features-when-budget-burns" rule.
- **No staging environment.** `push-to-master = production` (see
  `SECURITY_GAPS.md` G7). A bad merge hits prod; rollback is git tag + tarball.
- **No synthetic emergency drill on a schedule.** The `emergency-path` health
  check exists but is run manually; there is no automated periodic life-safety
  canary.
- **Proof-of-display dashboard is V2.** The ACK data exists in the heartbeat /
  AuditLog, but the operator-facing "which screens rendered the alert, when"
  surface is not yet built (CLAUDE.md V2 B-2).
- **Single API replica** — see `SECURITY_GAPS.md` G5; affects both scaling
  headroom and the correctness of in-memory rate limits.

---

## 5. Proposed escalation path (until a real on-call exists)

This is a **proposed** human workflow, not an implemented automation:

1. **Detection.** Sentry alert, UptimeRobot down-notice, or a customer report.
2. **Triage by severity** (mirrors `INCIDENT_RESPONSE.md`):
   - **SEV-1** — life-safety (emergency fired wrongly / failed to fire), auth
     bypass, cross-tenant leak, or full API outage. → **Greg immediately**
     (only Greg can rotate secrets / suspend a tenant).
   - **SEV-2** — degraded API, single-integration outage, elevated error rate.
     → owner of the affected area; fix within the business day.
3. **Act.** Use the runbooks in `INCIDENT_RESPONSE.md`. First moves:
   `curl https://<api>/api/v1/health` (is the container up?), check Railway
   Deploy Logs, check Sentry for the stack trace.
4. **Recover.** Railway → Restart latest (auto-restart covers most blips: 10
   retries / 300 s); or roll back to the last-good git tag
   (`docs/BACKUP_AND_ROLLBACK.md`).
5. **Post-incident.** Required for every SEV-1 (see `INCIDENT_RESPONSE.md` §9):
   timeline, root cause, and a tracked follow-up to prevent recurrence.

**Closing the on-call gap** (recommended order): (1) wire UptimeRobot + Sentry
alerts into a single inbox/Slack channel that is actually watched; (2) write a
lightweight rotation + response-time expectation even if it is one person; (3)
add PagerDuty/OpsGenie (V2 responder-escalation surface in CLAUDE.md §9) when
contracts justify it.

---

## 6. Cross-references

- `INCIDENT_RESPONSE.md` — the actual runbooks (false emergency, breach, key
  compromise, API down, cross-tenant leak).
- `docs/OBSERVABILITY.md` — Sentry setup + what is tracked + PII scrubbing.
- `docs/UPTIME_MONITORING.md` — UptimeRobot monitor config.
- `CLAUDE.md` "Deploy reliability" + "Deploy Reliability" — health endpoints,
  the never-do list (don't add DB checks to liveness; keep the 10-retry restart;
  keep the 7 s Redis hard-cap), and CI gates.
- `SECURITY_GAPS.md` — the security-side gap register.
