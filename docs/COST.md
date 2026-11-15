**Scope:** what VenueOS pays its hosting providers for, what drives each meter, the budget the code is held to, and the rules that keep a bill from growing unseen. `/CLAUDE.md` section 13 is the core rule; this file is its detail and has the same authority. Last verified: 2026-11-15 (provider prices read from the vendors' own pricing pages that day; evidence in `docs/handoffs/2026-11-15-cost-audit.md`).

# Cost - what bills us, and the rules that hold it

## The one fact to remember

**A request that reaches Vercel costs money on four meters; the same request sent straight to the API on Railway costs almost nothing.** A screen polls around the clock, so *which origin a screen talks to* decides the Vercel bill. Everything else on this page is detail.

## What each provider charges for

| Provider | What we run there | Billed on | Our lever |
|---|---|---|---|
| Vercel | the dashboard, the player shell, the same-origin gateway (`apps/web/src/proxy.ts`) | CDN requests (Flat Rate CDN tier), function and middleware invocations, active CPU, Observability Plus events, Build CPU minutes, deployment storage | keep screens off the gateway; build less; build on Standard machines |
| Railway | the API, the renderer, Redis | vCPU and memory by the second, egress per GB | request volume and payload size |
| Supabase | Postgres, media storage | plan fee, compute per project, egress, storage | queries per request; media egress |
| GitHub Actions | CI, the five-minute keep-warm, nightly suites | free while the repository is public | owner rule 2026-10-12: public until billed minutes are under about 3,000 a month |

Prices move. Read the provider's pricing page before quoting one; the audit handoff records the rates in force on 2026-11-15.

### Vercel, meter by meter

- **Flat Rate CDN tier.** A fixed monthly capacity of CDN requests: 1 M included with Pro, 10 M for $20, 50 M for $100, 150 M for $300. **If a billing cycle's requests exceed the tier, Vercel moves the team up a tier at the start of the next cycle, without asking.** A lower tier is chosen by hand in Billing and takes effect at the next cycle. This is the meter that turned 15.2 M requests into a $100 line on 2026-11-14.
- **Middleware invocations** (billed as function invocations), **active CPU** and **Observability Plus events**: one of each for every request that runs `proxy.ts`. The gateway's `/api/v1/*` requests all do.
- **Build CPU minutes**: build minutes multiplied by the machine's vCPUs. Standard is 4, Enhanced 8, Turbo 30. All four projects are on Elastic, which picks the machine itself. Every push to any branch builds a preview unless `apps/web/scripts/vercel-ignore-build.sh` exits 0.

## The request budget (enforced)

`apps/web/tools/request-budget.json` lists every periodic network call a paired screen makes and the interval it may not go below. `apps/web/tools/check-request-budget.cjs` reads each interval back from the source and fails CI when one is faster than its floor, when the totals pass their ceilings, or when a new timer appears in the player (`.github/workflows/request-budget.yml`; it reports, and becomes blocking when the owner adds it to the ruleset).

Per paired screen, per day, from the web player: **20,400 requests healthy, 53,520 degraded** (push channel down). Run the guard to print the table. The APK's own timers are in the table as well (status heartbeat every 60 s; the native alert watch every 15 s while a panel is off, every 5 s on an unattended face); their floors are checked and they are not part of those two totals.

What those numbers mean in dollars depends on the origin:

| A screen that is… | Requests a month through Vercel |
|---|---|
| on the direct origin (normal) | a few thousand (the bundle check and the nightly reload) |
| on the gateway, push healthy | about 612,000 |
| on the gateway, push degraded | about 1,606,000 |

Sixteen gateway screens with healthy push, or six with degraded push, are enough to pass the 10 M tier on their own.

## Rules

Each rule names what enforces it today, or says *prose* or *GAP*.

1. **The gateway is a fallback, never a home.** A screen uses it only while its direct origin is unreachable, and returns to direct when direct answers again. A change that makes the gateway sticky, or routes a new path through it, is a cost change and says so in its pull request. *Mechanism:* `apiOrigin.ts` `onDirectOriginProven`: once the push WebSocket (which always dials direct) is authenticated and talking, and the session has been on the gateway for five minutes, the HTTP control plane returns to direct as a probe; one failed direct request sends it back, and two failed returns make the gateway final for the session. Offered by the socket supervisor tick in `page.tsx`; tests in `apiOrigin.test.ts`. GAP: a screen whose network blocks WebSockets still waits for the boot probe.
2. **No new periodic network call on a screen without the budget changing in the same pull request.** Prefer a push, a longer interval, or riding an existing call. A floor is a cost floor only: how *slow* a life-safety poll may be is owned by `apps/api/src/emergency/CLAUDE.md`, and nothing here loosens it. *Mechanism:* `check-request-budget.cjs`.
3. **An error is a reason to slow down, never to speed up.** A 401, 402 or 429 answered at full cadence is a storm (857,000 + 259,000 + 310,000 requests in the cycle that ended 2026-11-14). New retry paths back off; changing the existing emergency-path retries is a life-safety CHANGE and goes through that process. *Mechanism:* prose.
4. **A hot device endpoint answers from memory or Redis.** A database query on a route every screen calls every ten seconds runs 8,640 times per screen per day, and the API and its database are in different regions today. *Mechanism:* prose; `emergency-rev` is the model, `emergency/messages` does not follow it yet.
5. **Builds are not free.** A push is a build unless the web inputs are unchanged; do not push work-in-progress snapshots to save them. *Mechanism:* `apps/web/scripts/vercel-ignore-build.sh` skips a build whose web inputs match the last deployment of the branch or, on a branch's first push, the tip of `master`.
6. **Watch the meters, not the invoice.** Each provider's budget alert notifies and never stops the service: a hard stop on Vercel or Railway takes alert delivery down with it. *Mechanism:* GAP - nothing reads Vercel usage today; `ops-sweep` covers CI, backups and health only.

## Measuring

- Vercel requests by path and status: Observability, or the Vercel connector's observability query. The cycle total against the tier is on the Usage page.
- Share of API traffic arriving through the gateway: Vercel request count for the project divided by Railway's HTTP request count for the `api` service, same window. It was 27% for 2026-11-08 to 11-14. Healthy is a few percent.
- Which origin one screen is on: `window.__eduApiOrigin` in a remote debug session.
- Database round trips: `pg_stat_statements`, ordered by calls.
