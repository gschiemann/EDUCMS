# Cost fix shipped - 2026-11-15

What merged, what was measured afterwards, and what is still open. Follows `2026-11-15-cost-audit.md` (the audit) and `2026-11-15-gateway-self-heal.md` (the design).

## Merged

- **#321** as `41c07463` (16:31 UTC): the request-budget guard, the build skip on a branch's first push, the cost rulebook. Vercel built it (its files sit under `apps/web`); Railway skipped it.
- **#322** as `a3a62ec3` (17:00 UTC), carrying #311's commit: the WebSocket always dials the direct API origin, SSE re-opens with a fresh ticket instead of ending for the session, and the HTTP control plane returns to the direct origin when the push channel proves it. Vercel production READY at 17:01:25 UTC (76 s build). Railway `api` SUCCESS on the same commit.
- The owner's go and his waiver of the different-vendor review are on `docs/governance/AUTONOMY-REGISTER.md`. **The on-glass drill was not waived and is still owed.**

## Measured afterwards

Counts from the `screens` table (aggregates only): `last_ping_at`, `last_rendered_at` and `last_push_connected_at` inside a recent window. The first two rows use windows of 5, 5 and 10 minutes; the last uses 2, 6 and 2 (an idle screen proves paint every 5 minutes, so its window has to be longer than that).

| Central time | Checking in | Painting | Push live | On `a3a62ec3` |
|---|---|---|---|---|
| 10:53 (before the merge) | 36 | 35 | 34 | 0 |
| 11:04 (web live 3 min) | 36 | 35 | 34 | 0 |
| 11:14 | 36 | 35 | 34 | 4, all painting, all with push |

Railway `api`, the hour to 11:05: 50,376 requests, zero 5xx, 42 4xx.

**Why only 4 screens moved.** `offHoursUpdate.ts`: a screen that is playing applies a waiting bundle between 03:00 and 04:00 in its own time zone (0 to 20 minutes of jitter); an idle or display-off screen applies it at once. The fleet-wide result cannot be read before the next morning, and the first full Vercel billing day after the roll is the one that ends 08:00 UTC on 2026-11-17.

**Not verified:** a live fetch of `/api/v1/health` (this session's sandbox cannot reach the hosts). The evidence used instead is Railway's SUCCESS for the commit, the commit on the Vercel production deployment, and the screens' own reports. Nothing was verified on glass.

## Seen while measuring, older than this change

- One screen checks in every few seconds and has sent no paint proof and held no push channel for 44 hours. It runs a bundle from 2026-11-10.
- One screen paints normally and has had no push channel for 21 hours. If it is a gateway-mode screen, #311 should bring its push back once it takes the new bundle; worth reading its row after the night.

## Vercel, as it stands

- Billing rows for the two billing days ending 2026-11-15 08:00 UTC, effective cost $7.41: Pro seat 1.31, Build CPU Minutes 1.04, Observability Events 0.78, Function Invocations 0.39, Fluid Active CPU 0.30, Deployment Storage 0.14, Fast Origin Transfer 0.06.
- The category "Subscription Licenses" is 4.65 for those two days: the seat plus 3.33. 3.33 a day is 100 over a 30 day cycle. Read: the Flat Rate CDN tier Vercel moved the team onto is still on in the cycle that began 2026-11-14. This is an inference from the rows; the service line itself falls outside the 50 service groups the billing tool returns.
- Observability Plus was disabled at 15:05:51 UTC under the owner's login (team event `observability-disabled`). This session did not change it. Its event meter stops. Per-path request queries now answer 402, so the gateway's share can only be read from the billing rows it drives: Function Invocations, Fluid Active CPU, Fast Origin Transfer.
- Out of an agent's reach: the build machine type (the connector answers "You must be a team owner or project admin"), the Flat Rate CDN tier, spend alerts. All three are dashboard settings.

## Capacity, which is the real limit

- After the fix a screen makes about 22,000 API requests a day.
- **The API process.** 0.23 vCPU at 14 requests a second today. One Node process is one core, so about 60 to 75 requests a second: 240 to 300 screens on the single replica.
- **The database.** `GET /emergency/messages` reads Postgres 3 to 4 times per screen every 10 seconds, across the country (API in us-west2, database in us-east-1), on a pool of 10 connections. Ceiling 150 to 350 screens.
- **Cost once those are removed**, per 1,000 screens a month: Railway about $190 (about 4 vCPU and 1.8 TB of egress), Vercel about $40 when screens are direct, Supabase $35 plus media egress, which is unmeasured. Roughly $0.27 a screen.
- A screen on the gateway costs Vercel about 612,000 requests a month. A direct screen costs about 4,500.

## The API has no hostname of its own

The `api` service answers only on its `*.up.railway.app` service domain (Railway, list of domains, 2026-11-15). A web filter that allows `venue-os.app` has no reason to allow that host, which is the likely reason a unit on a school network falls to the gateway. That is a hypothesis: no blocked site was measured. A custom domain under `venue-os.app` costs nothing per request. It moves the player's trust anchor (R-01), so it is a consequential change that needs its own design.

## Known residual in #322

`createControlPlaneRequest` reports success and failure without recording which origin the request was sent on. A gateway request still in flight at the instant of a return to direct can mark the return as proven. Bounded: the next direct failure then needs 3 strikes instead of 1 and does not spend the failed-heal budget. It needs a screen whose push socket is healthy while new HTTP requests to the same host fail. Fix: stamp an origin epoch at send time and ignore reports from an earlier epoch.

## Open, in order

1. The on-glass bench drill for #311 and #322. The owner approves each test.
2. Dashboard: the CDN tier back down before the cycle renews on 2026-12-14; build machines to Standard; a spend alert that notifies and never pauses (a paused project takes the player page down).
3. The alert-messages poll served from memory with write-through invalidation. Emergency CHANGE class.
4. The API in the database's region.
5. Back-off for 401, 402 and 429 (design in the audit handoff).
6. Sentry trace sampling for device polls; an index on `fleet_samples(created_at)`.
7. The API's own hostname; a second replica; a load test as a gate.

Models: Claude Fable 5.2 (Claude Code, cloud session).
