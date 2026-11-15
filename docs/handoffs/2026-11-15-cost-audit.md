# Cost and efficiency audit - 2026-11-15

The owner's ask, in three messages: the Vercel invoice of 2026-11-14 was $175 and nobody approved it; "do a complete audit and fix our efficiency now ... fix this once and for all"; "not just Vercel, every other service we use as well". Vercel has since refunded the $100 line.

Read-only on every provider: Vercel billing charges and Observability queries, Railway metrics and HTTP counts, Supabase `pg_stat_*` views (aggregates and query shapes only, no row content), GitHub REST. Nothing was changed on any account, screen or database. Code changes are in pull requests; none is merged.

Durable rules that came out of this are in `docs/COST.md` and `CLAUDE.md` section 13. This file is the dated record.

## Situation

- **The invoice.** $100 Flat Rate CDN 50M + $20 Pro + about $55 of usage. Usage for the cycle 2026-10-14 to 11-14 from the billing API, after the $20 included credit: Build CPU Minutes $30.20, Observability Events $14.22, Function Invocations $7.11, Fluid Active CPU $5.28, Deployment Storage $4.36, Fast Origin Transfer $1.14, the rest under $1. (The billing API's day boundaries differ from the invoice's by a few hours, so its lines run a little higher than the invoice's.)
- **Nobody bought the $100 tier.** Flat Rate CDN capacity is 1 M requests included, 10 M for $20, 50 M for $100. Vercel's documentation: "If your total usage for a billing cycle exceeds your monthly capacity, Vercel moves you to a higher tier at the start of the next cycle." The cycle made 15.5 M requests against 10 M.
- **Where 15.5 M requests came from.** About 47 screens are paired and about 34 check in (the 2026-11-14 fleet audit). By status for the `educms` project: 304 11.62 M (75%), 404 1.30 M, 401 0.86 M, 201 0.59 M, 200 0.53 M, 429 0.31 M, 402 0.26 M. Almost all of it is screens talking to the API *through* Vercel.

## Evidence

**1. A quarter of all screen traffic goes through the fallback gateway.** 2026-11-08 to 11-14: 2.28 M requests reached the Vercel project; the Railway `api` service served 8.52 M in the same window. 27%. The gateway (`proxy.ts`, P0-1 2026-09-02) exists for devices that cannot reach Railway at all. It is carrying ordinary screens.

**2. Gateway mode is a one-way door.** `apiOrigin.ts`: three consecutive network-class failures move the whole control plane to the page origin, and "never flap back to direct mid-session". The choice is persisted; on the next boot the screen tries direct once and the threshold is ONE failure. That much is the code. **Which event pushes a given screen over is a hypothesis, not a measurement:** the candidates are an API restart (the API was redeployed 19 times in the three days 2026-11-08 to 11-10), a slow answer (a deadline abort counts as a network failure), and a boot whose first request races the box's own network coming up, which would also explain a screen staying on the gateway night after night. Hourly request counts on Vercel move in steps of roughly one screen's traffic, which fits screens entering and leaving, and proves nothing about why.

**3. On the gateway the push channel cannot connect, so the screen polls harder.** `connect()` builds the WebSocket URL from `getApiRoot()`: in gateway mode that is the web origin, and Vercel cannot carry a WebSocket. Each dial is a 404 at `/realtime`: 210,804 in five days, about 1.3 M in the cycle. With push down the player runs its degraded cadence. `node apps/web/tools/check-request-budget.cjs` prints the table: 20,400 requests per screen per day healthy, 53,520 degraded. Open PR #311 (another session, 2026-11-14) fixes the dial and the SSE rotation; it does not move the HTTP control plane back.

**4. Errors are answered at full cadence.** Week of 2026-10-12: 258,826 responses of 402. Week of 2026-10-19: 848,057 of 401 and 300,160 of 429, nearly all on `/screens/:id/manifest`; one screen took 217,756 refusals in the week, one every 2.8 seconds. Three timers (rev poll falling back to a full fetch, the 5 s HTTP fallback, the 10 s reconcile) all keep firing at a server that is saying no. A rev poll that is throttled three times escalates to the heavier manifest request.

**5. Every gateway request is billed four times.** A CDN request (the tier), a middleware invocation (15.0 M billed as function invocations), active CPU (41 CPU-hours, about 10 ms per invocation for a header rewrite), and an Observability Plus event ($1.20 per million; the plan has it on by default).

**6. Builds are the largest usage line.** 67 deployments in the last 7.5 days, 43 of them previews. Billing is build minutes times vCPUs at $0.0035; all four projects are on Elastic machines, which choose their own size. A production build measured 161 s. A day with one build cost $0.042 (12 CPU-minutes, a Standard machine); 2026-10-31 to 11-03 cost $10.30. `vercel-ignore-build.sh` built the first push of every branch unconditionally because `VERCEL_GIT_PREVIOUS_SHA` is empty then.

**7. The trend since the last audit.** The 2026-09-02 efficiency audit recorded 552,900 API requests a day (`efficiency-metrics.service.ts`). The last seven days averaged 1,216,855.

### The other services

| Service | Measured | Estimated monthly | Finding |
|---|---|---|---|
| Railway | `api` 0.23 vCPU and 0.38 GB average, about 0.14 GB an hour out; `renderer` idle at 0.21 GB; Redis 10 MB | about $16 of usage at list price ($20 a vCPU, $10 a GB, $0.05 a GB out), inside the plan minimum | Not a cost problem. The API runs in us-west2 and its database is in us-east-1: every query crosses the country. |
| Supabase | Pro organisation, two projects. This database 189 MB, storage 7.3 GB, `max_connections` 60 (Micro) | $25 plan + $10 for the second project's compute = $35 | Inside every included quota that SQL can see. Egress is not visible from SQL: read it on the Usage page. The second project (`MouthMap`) costs $10 a month whether used or not. |
| GitHub Actions | 26 workflows; keep-warm every 5 min (8,640 runs a month), security-watch hourly | $0 while the repository is public | Going private makes this billable. The owner rule of 2026-10-12 already holds the repository public for that reason. |
| Sentry | not connected to this session | not measured | The API and the web server trace 10% of everything, polls included: about 3.6 M API transactions a month. If the Sentry plan has a pay-as-you-go budget this is spend; if not, the quota is gone in the first days of each month and real traces are dropped. |
| AI keys, Resend, Stripe, Mux, Maps | not connected | not measured | No finding. Say so rather than guess. |

Database, from `pg_stat_statements` (reset 2026-04-15):

- `GET /emergency/messages` is polled every 10 s by every screen and reads Postgres each time, in two stages (`emergency.controller.ts`, `deviceMessages`): the screen row (18.6 M calls), then the tenant's emergency status (16.4 M) beside the message and override reads (`emergency_messages` 11.6 M + 3.6 M, `screen_emergency_overrides` 7.8 M + 5.6 M). The handler's own comment puts a round trip at about 212 ms and calls the route "uncached by design (it is the emergency HTTP backstop)". `emergency-rev` was built on 2026-09-02 to answer the same kind of question from Redis and memory with no database work; the messages poll was not given that treatment. Changing it is a life-safety decision, not a tidy-up.
- `fleet_samples` has no index that starts with `created_at`. The 15-minute sampler's stand-down read averages 585 ms and its retention delete 479 ms, both sequential scans: 12.7% of all database time for two statements.
- `screens` (286 rows) has taken 11.8 M updates; the cluster has written 2.36 TB of WAL for a 189 MB database.
- `DISCARD ALL` is 18.6% of database time at 51 ms a call. Not explained; it belongs to the pooler, not to our SQL.

## Two investigations

**Why the product failed.** The gateway was designed as a rare fallback and built without a way back. Once a screen is on it, a second defect (the socket dialled an origin that cannot carry sockets) turns it into the most expensive mode the player has. Retry paths have no notion of "the server said no".

**Why our system let it reach the invoice.**
- The September audit's conclusions lived in code comments and in `docs/research/`, which is gitignored. Nothing enforced them and the next sessions could not read them.
- No gate measures request volume. The gates measure bundle size, a11y, tenancy, Taurus CSS. A new timer on a screen passes all of them.
- The owner's standing rule says "proactively watch Supabase / Railway / Vercel health". `ops-sweep` watches CI, backups and liveness. Nothing reads Vercel usage, so a tier that upgrades itself was first seen as a receipt.
- The September gateway work was reviewed as a reliability and security change. Its cost model (every request through it is billed four ways) was never written down.

## What this session changed (pull requests, unmerged)

1. `claude/cost-guardrails` - zero runtime change.
   - `apps/web/scripts/vercel-ignore-build.sh`: a preview with no previous deployment is compared with the tip of `master`; identical web inputs skip the build. Every unknown still builds. Eleven scenarios run in a scratch repository: only the three with identical web inputs exit 0.
   - `apps/web/tools/check-request-budget.cjs` + `request-budget.json` + `.github/workflows/request-budget.yml`: floors on every periodic call, ceilings on the per-screen totals, a tripwire on new timers; negative controls in `--self-test`. Reports; not a required check.
   - `docs/COST.md`, `CLAUDE.md` section 13, this file.
2. `claude/gateway-self-heal` - **life-safety CHANGE class**, stacked on #311. See its pull request.

## Decisions for the owner

| # | Decision | Why | Blast radius |
|---|---|---|---|
| 1 | Flat Rate CDN tier back to 10 M ($20) for the next cycle | Tier changes apply at the next cycle and are made in Billing. It only holds if this cycle stays under 10 M, which needs #311 and the self-heal live within about a week (the cycle is running at 350,000 to 500,000 a day) | Billing only |
| 2 | Build machines: Standard instead of Elastic, all four projects | A build is about 3 minutes; Standard is $0.042 a build, Elastic has charged several times that | Builds may run slower. If a build runs out of memory on 8 GB, go to Enhanced |
| 3 | Observability Plus: off, or keep it | About $14 a cycle, nearly all of it gateway middleware events. It drops to a dollar or two once screens leave the gateway. It is also what made this audit possible | Loses 30-day request analytics if off |
| 4 | Budget alerts on Vercel and Railway, notify only | A tier or a storm is then seen in days. Never a hard stop: pausing Vercel takes the player shell and the gateway down | None |
| 5 | #311 and the self-heal: different-vendor review, the owner's go, a bench drill in gateway mode | The root cause | Player web bundle, fleet-wide at the off-hours update |
| 6 | Error back-off on the manifest and rev polls (design below) | 1.43 M wasted requests in one cycle, and a storm is how the next tier arrives | Emergency path. Not built: it changes how fast a refused screen retries, which is the owner's call |
| 7 | `emergency/messages` answered from memory with Redis invalidation, or folded into `emergency-rev` | Halves the steady-state polling and removes four database reads per poll | Emergency path, API and player |
| 8 | Move the API to a region next to its database (or the reverse) | About 60 to 70 ms per query today | Infrastructure; a planned move |
| 9 | Sentry: sample polls at 1% or less | See the table | Less trace volume on device routes |
| 10 | `fleet_samples(created_at)` index | Two statements, 12.7% of database time | Schema; additive migration |

### Design for decision 6 (not built)

- A manifest answer of 401, 402 or 429 sets a floor on the next NON-emergency manifest attempt: 15 s, doubling to 60 s, cleared by any 2xx or 304 and by a successful credential renewal. `Retry-After` is honoured up to that ceiling.
- The emergency lane is exempt: a signed push, a rev answer that carries an alert, and `preemptReconcile` fetch at once, always.
- A throttled rev poll never escalates to a full manifest fetch while the manifest itself is being throttled.
- Failure direction: if the floor logic throws, there is no floor (today's behaviour). Kill switch: one flag, unset = today's behaviour.
- Cost of the trade, stated plainly: a screen whose credential starts working again without a renewal is noticed up to 60 s later than today. A screen that is being refused cannot receive an alert over HTTP in either design.

## Not done, and why

- Nothing was changed in any provider console. Billing is L1 in the autonomy register: proposed here, applied on the owner's written go.
- No Sentry or AI spend was measured: those accounts are not connected to this session.
- `node scripts/ops-sweep.mjs` was not run: `gh` in this session can use REST only.
- Supabase egress, the one Supabase meter that can run away, was not read.

Models: Claude Fable 5.2 (Anthropic), Claude Code on the web, lead session.
