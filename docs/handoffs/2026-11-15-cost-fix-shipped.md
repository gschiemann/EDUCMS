# Cost fix shipped - 2026-11-15

What merged, what was measured afterwards, and what is still open. Follows `2026-11-15-cost-audit.md` (the audit) and `2026-11-15-gateway-self-heal.md` (the design).

## Merged

- **#321** as `41c07463` (16:31 UTC): the request-budget guard, the build skip on a branch's first push, the cost rulebook. Vercel built it (its files sit under `apps/web`); Railway skipped it.
- **#322** as `a3a62ec3` (17:00 UTC), carrying #311's commit: the WebSocket always dials the direct API origin, SSE re-opens with a fresh ticket instead of ending for the session, and the HTTP control plane returns to the direct origin when the push channel proves it. Vercel production READY at 17:01:25 UTC (76 s build). Railway `api` SUCCESS on the same commit.
- **#324** (same day): the correction of #321's build-skip rule, described below. No runtime change.
- The owner's go and his waiver of the different-vendor review are on `docs/governance/AUTONOMY-REGISTER.md`, with the lead's reading that extended it to #324. **The on-glass drill was not waived and is still owed.**

## Measured afterwards

Counts from the `screens` table (aggregates only): `last_ping_at`, `last_rendered_at` and `last_push_connected_at` inside a recent window. The first two rows use windows of 5, 5 and 10 minutes; the later ones use 2, 6 and 2 (an idle screen proves paint every 5 minutes, so its window has to be longer than that).

| Central time | Checking in | Painting | Push live | On `a3a62ec3` |
|---|---|---|---|---|
| 10:53 (before the merge) | 36 | 35 | 34 | 0 |
| 11:04 (web live 3 min) | 36 | 35 | 34 | 0 |
| 11:14 | 36 | 35 | 34 | 4, all painting, all with push |
| 11:25 | 36 | 35 | 34 | 8, all painting, all with push |

Railway `api`, the hour to 11:05: 50,376 requests, zero 5xx, 42 4xx.

**Why most screens had not moved.** `offHoursUpdate.ts`: a screen that is playing applies a waiting bundle between 03:00 and 04:00 in its own time zone (0 to 20 minutes of jitter); an idle or display-off screen applies it at once. The fleet-wide result cannot be read before the next morning, and the first full Vercel billing day after the roll is the one that ends 08:00 UTC on 2026-11-17.

**Not verified:** a live fetch of `/api/v1/health` (this session's sandbox cannot reach the hosts). The evidence used instead is Railway's SUCCESS for the commit, the commit on the Vercel production deployment, and the screens' own reports. Nothing was verified on glass.

## One of the three fixes did not work, and was corrected (#324)

#321's rule "do not build a branch's first push when its web inputs equal production's" never skipped anything inside Vercel. The first docs-only branch pushed after it built in full (deployment `dpl_DGDoPgYDpcnSseobnWELk9o9DWzH`): the script answered BUILD in 261 ms and printed nothing.

- **Cause.** The script took its base from `git fetch origin master`. Vercel's checkout is a depth-10 shallow clone with no remote at all. The corrected script prints what it finds, and its first build inside Vercel printed `remotes: []`.
- **Why the validation missed it.** The hand test used a scratch repository that had an `origin`. The run inside Vercel used a branch that changed the web, where BUILD is right whether or not the fetch worked. Neither could tell a working skip from a failed fetch.
- **Correction.** The base is fetched from the repository's URL. Every decision prints one `[ignore-build]` line. `apps/web/scripts/vercel-ignore-build.test.sh` rebuilds Vercel's checkout and runs in `request-budget.yml`; against the script as merged in #321 it fails on exactly the docs-only first push.
- **End-to-end proof.** The branch that carries this file is a docs-only first push made after #324 merged. Whether Vercel skipped it is recorded on the pull request that merged this file.
- **Still open.** The comparison is an anonymous fetch. A private repository refuses it; the script then builds and says so in the log.

The money in it is small: every build read today and yesterday ran on the Standard 4-core machine for about 60 to 76 seconds, about 2 cents. The point is the claim: the rulebook named a mechanism that did not exist.

## Seen while measuring, older than this change

- One screen checks in every few seconds and has sent no paint proof and held no push channel for 44 hours. It runs a bundle from 2026-11-10.
- One screen paints normally and has had no push channel for 21 hours. If it is a gateway-mode screen, #311 should bring its push back once it takes the new bundle; worth reading its row after the night.

## Vercel, as it stands

- Billing rows for the two billing days ending 2026-11-15 08:00 UTC, effective cost $7.41: Pro seat 1.31, Build CPU Minutes 1.04, Observability Events 0.78, Function Invocations 0.39, Fluid Active CPU 0.30, Deployment Storage 0.14, Fast Origin Transfer 0.06.
- The category "Subscription Licenses" is 4.65 for those two days: the seat plus 3.33. 3.33 a day is 100 over a 30 day cycle. Read: the Flat Rate CDN tier Vercel moved the team onto is still on in the cycle that began 2026-11-14. This is an inference from the rows; the service line itself falls outside the 50 service groups the billing tool returns. (2026-11-16: the rows of the next day name it, "Flat Rate CDN 50M", 3.3333 a day. The owner reports he lowered the tier on 2026-11-16; later rows will show it.)
- Observability Plus was disabled at 15:05:51 UTC under the owner's login (team event `observability-disabled`). This session did not change it. Its event meter stops. Per-path request queries now answer 402, so the gateway's share can only be read from the billing rows it drives: Function Invocations, Fluid Active CPU, Fast Origin Transfer.
- Out of an agent's reach: the Flat Rate CDN tier, spend alerts, and the build machine setting (the connector answers "You must be a team owner or project admin"). All three are dashboard settings. The third matters least: the build logs of 2026-11-14 and 2026-11-15 all read "4 cores, 8 GB (Standard Build Machine)", so pinning it only prevents a later automatic upgrade.

## Capacity, which is the real limit

**Corrected 2026-11-16.** The first two lines and the cost line below were written from the request budget's totals, which leave out the APK's own timers. Measured on 2026-11-16: 53,080 API requests in one hour from 40 screens, about 32,000 per screen per day, not 22,000. The gateway fix moved requests off Vercel; it did not reduce them. The corrected figures are in place below, and the measurement is in `docs/handoffs/2026-11-16-device-messages-fast-304.md`.

- A screen makes about 32,000 API requests a day (measured; the first version of this line said 22,000).
- **The API process.** 0.23 vCPU at 14 requests a second today. One Node process is one core, so about 60 to 75 requests a second: 160 to 200 screens on the single replica (the first version said 240 to 300).
- **The database.** `GET /emergency/messages` reads Postgres 3 to 4 times per screen every 10 seconds, across the country (API in us-west2, database in us-east-1), on a pool of 10 connections. Ceiling 150 to 350 screens.
- **Cost once those are removed**, per 1,000 screens a month: Railway about $275 (the first version said $190; scaled by the measured request rate), Vercel about $40 when screens are direct, Supabase $35 plus media egress, which is unmeasured. Roughly $0.35 a screen.
- A screen on the gateway costs Vercel about 612,000 requests a month. A direct screen costs about 4,500.

## The API has no hostname of its own

The `api` service answers only on its `*.up.railway.app` service domain (Railway, list of domains, 2026-11-15). A web filter that allows `venue-os.app` has no reason to allow that host, which is the likely reason a unit on a school network falls to the gateway. That is a hypothesis: no blocked site was measured. A custom domain under `venue-os.app` costs nothing per request. It moves the player's trust anchor (R-01), so it is a consequential change that needs its own design.

## Known residual in #322

`createControlPlaneRequest` reports success and failure without recording which origin the request was sent on. A gateway request still in flight at the instant of a return to direct can mark the return as proven. Bounded: the next direct failure then needs 3 strikes instead of 1 and does not spend the failed-heal budget. It needs a screen whose push socket is healthy while new HTTP requests to the same host fail. Fix: stamp an origin epoch at send time and ignore reports from an earlier epoch.

## Open, in order

1. The on-glass bench drill for #311 and #322. The owner approves each test.
2. Dashboard: the CDN tier back down before the cycle renews on 2026-12-14; a spend alert that notifies and never pauses (a paused project takes the player page down); pinning the build machine to Standard is optional.
3. The alert-messages poll served from memory with write-through invalidation. Emergency CHANGE class. (2026-11-16: built on branch `claude/device-messages-fast-304`, shipped switched off; record in `docs/handoffs/2026-11-16-device-messages-fast-304.md`.)
4. The API in the database's region.
5. Back-off for 401, 402 and 429 (design in the audit handoff).
6. Sentry trace sampling for device polls; an index on `fleet_samples(created_at)`.
7. The API's own hostname; a second replica; a load test as a gate.

Models: Claude Fable 5.2 (Claude Code, cloud session).
