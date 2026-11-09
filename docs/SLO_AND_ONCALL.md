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
| **Emergency-delivery latency** (T0) — **contracted 2026-11-09, see §2a** | **≥ 95 % of screen-paints confirmed within 15 s of the trigger**, rolling 30 days, live and drill triggers together; every online proof-capable screen in scope confirmed within 60 s per trigger. Design goal, not yet measurable: < 2 s on the raise path. | Server-confirmed paint: the first `PLAYER_EMERGENCY_PAINTED` audit row per screen after each `TRIGGER_EMERGENCY*` row (the query in §2a); daily per-pane verdicts from the synthetic drill once it is armed (`apps/api/src/emergency/drill/`). | Content-level sync, not hardware genlock. The proof row is the server's receipt of the paint, so this bound includes network and report time; the drill's own pass bar per pane is 5 s. |
| **API availability** (T1) | **99.5%** monthly (≈ 3.6 h/mo budget). | UptimeRobot keyword monitor on `GET /api/v1/health` (see `docs/UPTIME_MONITORING.md`). | Liveness only — `/health` returns 200 even if DB/Redis degraded, by design. |
| **API latency** (T1) | p99 **< 800 ms** for read endpoints under normal load. | Sentry performance traces (10% sample) + Railway request metrics. | Cold-start tail is mitigated by the keep-warm cron (§3). |
| **Player uptime** (T1/T0) | **99%** of paired screens reporting `lastPingAt` within the offline threshold. | `lastPingAt` on `Screen`; offline-screen-scanner flags stale screens (`notifications/offline-screen-scanner.ts`). | A screen offline to the WAN can still be playing locally — uptime here is *cloud reachability*, not *display blank*. |
| **Successful deploys** | **> 95%** of merges reach "Healthy" without a rollback. | Railway deployment status + CI green rate. | Backed by the deploy-reliability CI gates. |

### 2a. The T0 contract (2026-11-09)

**What is measured.** For every emergency trigger — live (`TRIGGER_EMERGENCY`) or drill (`TRIGGER_EMERGENCY_DRILL`) — and every screen in its scope, the **server-confirmed paint latency** is the time from the trigger's audit row to the screen's first `PLAYER_EMERGENCY_PAINTED` audit row within the following ten minutes. The paint row is written when the server receives the screen's paint proof (`apps/api/src/screens/emergency-proof.ts`), so the number includes delivery, render, and the proof's trip back; it never includes a device clock, which is why the old "< 2 s p95" could not be measured and is kept only as the design goal for the raise path.

**The contract.** Rolling 30 days, live and drill together: **at least 95 % of screen-paints within 15 s**; per trigger, **every online, proof-capable screen in scope confirmed within 60 s** (the synthetic drill reports each pane; its own pass bar is 5 s, deliberately tighter than the contract so regressions show before the contract is at risk). A screen that produces no paint row is a **coverage** question — offline, a pre-proof player build, or an LED poster on an old build — answered by the drill's dead-man rule (no PASS in 36 h → owner email), not a latency miss.

**Error budget and consequence.** 5 % of screen-paints per 30 days may exceed 15 s. While the budget is burning, fleet-wide actions for the player class drop to L1 (Article 34's first automatic rule, `docs/governance/AUTONOMY-REGISTER.md`) and the weekly review names the cause; the drill emails the owner on every FAIL in `alert`/`on` mode.

**Baseline when contracted** (production audit rows, read-only; UTC):

| Window | Trigger kind | Screen-paints | Triggers | p50 | p90 | p95 | Within 15 s |
|---|---|---|---|---|---|---|---|
| 30 days to 2026-11-09 | live | 48 | 7 | 0.8 s | 9.7 s | 175 s | — |
| 30 days to 2026-11-09 | drill | 127 | 16 | 1.9 s | 166 s | 269 s | — |
| since 2026-11-03 (after the dual-face echo fix) | live | 29 | 2 | 0.6 s | 9.0 s | 9.8 s | 28 of 29 |
| since 2026-11-03 | drill | 103 | 10 | 1.4 s | 9.1 s | 191 s | 93 of 103 |

So the contract is **not met on the 30-day window today** (the tail is the late-October runs before paint proof existed and the 2026-11-03 echo investigation) and **met by the two live triggers since 2026-11-03**. Paint proof exists only since 2026-10-27 (player 1.1.55+); earlier triggers have no rows and are not counted.

**The measurement** (read-only; run against production by the lead, or by the drill's daily verdicts once armed):

```sql
WITH trig AS (
  SELECT id, tenant_id, created_at AS t0, action FROM audit_logs
  WHERE action IN ('TRIGGER_EMERGENCY','TRIGGER_EMERGENCY_DRILL') AND created_at > now() - interval '30 days'
), paints AS (
  SELECT tenant_id, target_id AS screen_id, created_at AS tp FROM audit_logs
  WHERE action = 'PLAYER_EMERGENCY_PAINTED' AND created_at > now() - interval '30 days'
), firstpaint AS (
  SELECT trig.id AS trig_id, trig.action, trig.t0, p.screen_id, min(p.tp) AS tp
  FROM trig JOIN paints p ON p.tenant_id = trig.tenant_id AND p.tp >= trig.t0 AND p.tp < trig.t0 + interval '10 minutes'
  GROUP BY trig.id, trig.action, trig.t0, p.screen_id
)
SELECT action, count(*) AS screen_paints,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM tp - t0)) AS p95_s,
  count(*) FILTER (WHERE tp < t0 + interval '15 seconds')::float / count(*) AS share_within_15s
FROM firstpaint GROUP BY action;
```

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
| Cold-start warmth + outside-in health sweep | **GitHub Actions cron** every 5 min — reads the liveness BODY (`"db":"ok"`), requires `/ready` + `/emergency-path` 200; failure emails the workflow author. (The old Vercel-cron claim was stale — Hobby plan only allows daily crons; `apps/web/src/app/api/cron/keepwarm/route.ts` survives as a manual passthrough.) | LIVE | `.github/workflows/keep-warm.yml` |
| Infra self-monitoring (DB / Redis / WS-signer) | **PlatformHealthMonitorService** — in-app probe every 5 min; on transition into degraded/critical emails `PLATFORM_ALERT_EMAILS` (re-alert ≤ 6h, recovery all-clear), Sentry capture on critical | LIVE (2026-08-05) | `apps/api/src/health/platform-health-monitor.service.ts` |
| Storage upload transport | **StorageWatchdogService** — real upload probe every 5 min → same alert routing | LIVE | `apps/api/src/storage/storage-watchdog.service.ts` |
| Public status page | `/status` on the web app (Vercel — independent deploy surface from the API) shows live component health: API, DB, realtime, emergency path, storage | LIVE (2026-08-05) | `apps/web/src/app/status/` |
| Uptime + outage email/SMS | **UptimeRobot** free tier (4 monitors) | **DOCUMENTED, operator-provisioned** — setup guide exists; confirm it is actually configured for the live hosts | `docs/UPTIME_MONITORING.md` |
| Background-service health | offline-screen-scanner, cohort outage detection, canary auto-promote, license reconcile, webhook retry | LIVE (log to stdout / Sentry) | `apps/api/src/notifications/`, `apps/api/src/billing/license-reconcile.cron.ts`, `apps/api/src/webhooks/webhook-retry.worker.ts` |

---

## 4. Gaps — what we do NOT have (be honest)

- **No paging / on-call rotation.** Detection now emails
  `PLATFORM_ALERT_EMAILS` in near-real-time (PlatformHealthMonitor, storage
  watchdog, efficiency alerts, keep-warm sweep failures) — but there is still
  **no PagerDuty/OpsGenie, no rotation, no escalation policy, and no
  guaranteed human response time.** Detection ≠ response; email ≠ paging.
  This remains the biggest reliability gap.
- **No error-budget policy.** The SLOs above are not yet tied to a
  "stop-shipping-features-when-budget-burns" rule.
- **No staging environment.** `push-to-master = production` (see
  `SECURITY_GAPS.md` G7). A bad merge hits prod; rollback is git tag + tarball.
- **No synthetic emergency drill on a schedule.** The `emergency-path` health
  check exists but is run manually; there is no automated periodic life-safety
  canary. **Update 2026-11-09:** the drill is built (`apps/api/src/emergency/drill/`, PR #282, dark until `EMERGENCY_DRILL_SCREENS` names bench screens); the T0 contract above is what it measures.
- **Proof-of-display dashboard is V2.** The ACK data exists in the heartbeat /
  AuditLog, but the operator-facing "which screens rendered the alert, when"
  surface is not yet built (docs/roadmap/ROADMAP.md B-2).
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
add PagerDuty/OpsGenie (V2 responder-escalation surface in docs/roadmap/ROADMAP.md) when
contracts justify it.

**Setting up the on-call routine (owner step).** As of 2026-11-09 the repository
secrets `ROUTINE_FIRE_URL` and `ROUTINE_FIRE_TOKEN` are **absent** and no on-call
routine exists, so a failed workflow only opens a GitHub issue (and the daily
`ops-sweep.yml` run is the backstop). To turn the pager on:

1. Open claude.ai/code/routines and create a routine for this repository. Its
   prompt is the one described in the header of
   `.github/workflows/scheduled-failure-issue.yml`: read the failure that arrives
   in the trigger text, find the matching `ops:` issue, read the failed log, fix
   what is a code or secret problem, and only report when the classification is
   BILLING.
2. On the routine's edit page, add an API trigger. The trigger URL and its token
   are shown once; copy both before leaving the page.
3. In GitHub, Settings, Secrets and variables, Actions, add them as the repository
   secrets `ROUTINE_FIRE_URL` and `ROUTINE_FIRE_TOKEN`.
4. Check it: re-run a failed workflow and confirm the "Fire the on-call routine"
   step runs instead of the "On-call routine not configured" notice.

---

## 6. Cross-references

- `INCIDENT_RESPONSE.md` — the actual runbooks (false emergency, breach, key
  compromise, API down, cross-tenant leak).
- `docs/OBSERVABILITY.md` — Sentry setup + what is tracked + PII scrubbing.
- `docs/UPTIME_MONITORING.md` — UptimeRobot monitor config.
- `docs/DEPLOY.md` "Deploy reliability" + "Deploy Reliability — CI gates" — health endpoints,
  the never-do list (don't add DB checks to liveness; keep the 10-retry restart;
  keep the 7 s Redis hard-cap), and CI gates.
- `SECURITY_GAPS.md` — the security-side gap register.
