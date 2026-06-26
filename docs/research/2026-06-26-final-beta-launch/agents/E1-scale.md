# Wave E — Multi-franchise / HQ at scale (§11, §14, §17)

**Surface:** S3 tier — an HQ ("Corporate") managing dozens of child locations / hundreds of screens (the Acme ~50-location / ~150-screen demo). Read-only confirmation pass; FIND + REPORT only.
**Scale tier:** S3 (parent tenant + N direct-child location tenants, 1 fleet of 50 verified live in prior #237/#238 test; this pass built a fresh 3-screen / 2-child throwaway fleet end-to-end).
**Standard Audit Surface §§ covered:** §11 (Billing/License: seat enforcement, License↔Stripe reconcile), §14 (Multi-vertical/franchise: fleet roll-up, cross-location publish, fleet-wide offline alerting, cross-tenant scope), §17 (Operational at scale: pool sizing, N+1, pagination, performance).
**Prod commit audited:** `06038352` (web `venue-os.app`, API `api-production-39a1.up.railway.app`).

---

## Step-by-step what I did

1. Read the canonical fleet code: `screens.controller.ts` `GET /screens` + `GET /screens/fleet`, `screens.fleet.spec.ts`, `tenants.controller.ts` (`children` / `switch` / `createChild`), `playlist-distribution.service.ts` + `playlists.controller.ts` publish path, `license.service.ts`, `license-reconcile.cron.ts`, `notifications.service.ts` `scanOfflineScreens` + `offline-screen-scanner.ts`, `screen-wedge-detector.cron.ts`, `jwt-auth.guard.ts`, `FleetRollup.tsx`, `PublishToLocationsModal.tsx`.
2. Confirmed the tenant hierarchy is **2-level by design** (HQ → locations): `createChild` forces `parentId = caller.parentId ?? caller.id`, `fleet` queries `parentId: rootId` (direct children only).
3. **Live prod verification** with a throwaway parent tenant (`E1 Scale HQ`) + 2 children (Austin, Dallas) + 3 paired screens (2 Austin, 1 HQ):
   - `GET /screens/fleet` from HQ → returns all 3 screens across both locations + self, each `sourceTenant`-tagged, correct stats `{total:3, online:3, offline:0, locationCount:3}`. **Fleet roll-up Phase 1 works.**
   - `GET /screens/fleet` from a CHILD (Austin) token → returns **only Austin's 2 screens** (`locationCount:1`). **Child isolation on the read roll-up holds.**
   - Created a `SCHOOL_ADMIN` (store-only manager) in Austin → switch into sibling Dallas = **403**, switch into parent HQ = **403**, `GET /screens/fleet` = **403**, `GET /screens` = its own 2 screens only. **Store-manager isolation holds.**
   - A `DISTRICT_ADMIN` (HQ-level) CAN switch into a sibling (HTTP 201) — verified, by-design (see F-2).
   - `POST /playlists/:id/publish-to-fleet` to a fabricated foreign screenId → **404 "One or more screens not found."**; to a real CHILD (Austin) screen → **201**, copied the playlist into the child + scheduled it. **Cross-location publish Phase 2c works + injection rejected.**
4. Probed prod health (DB flaps `ok`↔`degraded`), fleet endpoint latency (~1.1s for 3 screens, pooler-bound), and re-checked the prior L-1 dashboard-SSR-500 (now 200 — fixed).
5. Cross-referenced prior live tests `docs/research/2026-06-03-50-location-scale-test/` (150 screens, 20× concurrent, no pool exhaustion) and `docs/research/2026-06-02-pos-scale-mapping/04-fleet-rollup-current-state.md`.

---

## Findings table

| # | Sev | area | what | repro | evidence (file:line / curl) |
|---|-----|------|------|-------|------------------------------|
| F-1 | P2 | §14 fleet roll-up depth | Fleet roll-up + cross-location publish + HQ offline-alerting are all **strictly 2-level** (HQ → direct children). A 3-level org (HQ → region → store) would **silently omit grandchild screens** from the HQ roll-up, publish picker, and HQ outage alerts. This is intentional today (matches the flat HQ→locations Acme model) but is an undocumented ceiling that will surprise a regional-franchise buyer. | Create HQ → child → grandchild; HQ `/screens/fleet` omits grandchild screens | `screens.controller.ts:1073` `where:{parentId:rootId}`; `playlist-distribution.service.ts:81` `where:{parentId:parentTenantId}`; `notifications.service.ts:281` `meta?.parentId` (single hop); `tenants.controller.ts:139` forces flat tree |
| F-2 | P2 | §14/§16 cross-tenant scope | A **DISTRICT_ADMIN scoped to a child location can switch into any SIBLING location** under the same parent and act there with full DISTRICT_ADMIN powers (sibling NOT sealed). Correct for the EDU "district admin manages all schools" model; for a true **franchise** where each franchisee admin must be sealed from peer stores, this is too permissive. Mitigated: `SCHOOL_ADMIN`/`CONTRIBUTOR`/`VIEWER` CANNOT switch at all (verified 403), so a store-only manager IS isolated. The risk only exists if franchisees are provisioned as DISTRICT_ADMIN. | Austin DISTRICT_ADMIN `POST /tenants/switch {tenantId: Dallas}` → 201 | `tenants.controller.ts:226` `authorized = target.id===districtId \|\| target.parentId===districtId` ("covers both directions… sibling/child"); live curl HTTP=201 |
| F-3 | P2 | §17 perf at scale | `GET /screens/fleet` runs ~3 mostly-sequential pooler round-trips (self tenant, children `findMany`, screens `findMany`+screenGroup join) with **no pagination/virtualization**. ~1.0–1.1s at 150 screens (prior live test), grows linearly toward ARC's stated 500+. The 3 small reads (self/children/stats) are independent and could be `Promise.all`'d. Not breaking — load test held 20× concurrent with no pool exhaustion. | `time curl /screens/fleet` | `screens.controller.ts:1072-1090` sequential awaits; prior live test L-2 `docs/research/2026-06-03-50-location-scale-test/00-SCALE-AND-ALERTING-TEST.md`; my curl ~1.1s/3 screens |
| F-4 | P2 | §17 alerting at scale | `scanOfflineScreens` per-screen path is batched (`createMany skipDuplicates`, N+1 already fixed), but the **infra-event aggregated path is still a sequential `await this.notify()` loop per affected tenant + a second per-HQ copy**. At ~50 locations simultaneously dropping (WAN-cut infra event), that's up to ~100 sequential upserts every 60s during the outage — exactly when the pool is most stressed. Fine for 1 fleet of 50; a deferred concern for many concurrent large fleets. | code trace | `notifications.service.ts:309-342` (`for…of infraEventTenants { await notify; … await notify(HQ) }`) vs the batched per-screen path at `:293-303` |
| F-5 | P1 | §11 license at scale | **Pilot seat limit is 1000** (raised from 3 for internal testing); CLAUDE.md + the code comment both say drop it to the contracted count "when we onboard the first paying customer." For a beta launch that is now live (water-polo + franchise pilots), seat metering is effectively OFF — an HQ can pair unlimited screens with no billing ceiling, and Stripe quantity drift would only surface via the daily reconcile cron (which no-ops when Stripe is unconfigured, as on the live pilot). Not a security hole; a billing-correctness/launch-readiness gap. Owner: Greg (config decision, not code). | n/a — config | `license.service.ts:33` `PILOT_SEAT_LIMIT = 1000`; `license-reconcile.cron.ts:122` no-ops when `!stripe.enabled()` |
| F-6 | P2 | §14 UX | HQ per-child offline notification + fleet-publish flow link/route is `link:'/screens'` (HQ's own screens page) rather than a deep-link into the affected store. The roll-up has the store slug (`sourceTenant`/`meta.name`) but the alert doesn't carry the operator there in one click. Minor triage-friction at scale. | inspect notification rows | `notifications.service.ts:287` `link:'/screens'` for the HQ copy (store name only in title/body, not the link) |
| — | (info) | §17 infra | Prod `/api/v1/health` `db` flaps `ok`↔`degraded` across consecutive probes (redis ok, readiness 200). Likely transient Supabase-pooler pressure, not a fleet-code defect — flagging for the infra owner; matches the long-standing `connection_limit` sensitivity. | `curl /health` 3× | live: `db=ok, ok, degraded` within 9s |

---

## What I verified is CLOSED / working (no finding)

- **Fleet roll-up Phase 1** — live: HQ sees all child + self screens, `sourceTenant`-tagged, correct stats; child sees only its own. (`screens.controller.ts:1062-1136`, `screens.fleet.spec.ts`)
- **Cross-location publish Phase 2c** — live: HQ → child publish copies playlist+assets into the child (works WITH the schedules cross-tenant guard, not around it); foreign screenId → 404; ownership double-checked against `{parent}∪{direct children}`. (`playlist-distribution.service.ts:79-102`)
- **Fleet-wide offline alerting Phase 2b** — HQ gets a store-labelled copy of every child-screen outage + cohort/infra-event copy; atomic upsert dedup; cohort suppression prevents floods. Verified end-to-end against the live scanner in #238. (`notifications.service.ts:214-342`)
- **Cross-tenant scope** — store-manager (`SCHOOL_ADMIN`) sealed from siblings/parent/fleet (live 403s); publish/switch ownership checks are tenant-scoped; `req.user.id` IS populated (custom `JwtAuthGuard` sets both `id`+`userId`, lines 146-155 — the standalone passport `jwt.strategy.ts` is unused for these routes, so the `actorUserId: req.user.id` in publish is NOT a bug; I confirmed live the publish succeeded).
- **License seat enforcement** — `assertSeatAvailable` counts paired screens, enforces status + expiry; pair claim wrapped in SERIALIZABLE tx + `withDbRetry` (TOCTOU-safe). (`license.service.ts:99-142`, `screens.controller.ts:1184-1217`)
- **License↔Stripe reconcile cron** — read-compare-then-sync only, idempotent, AuditLog-as-dedup, no-ops when Stripe off. (`license-reconcile.cron.ts`)
- **Prior L-1 (dashboard SSR 500 on hard-load)** — now returns 200 live (fixed since the June-3 test, likely via the stale-bundle fix #250).

## Coverage — what I could NOT reach + why

- **3-level hierarchy behavior (F-1)** — inferred from code (`createChild` forces flat tree, so I could not actually create a grandchild via the API to curl the omission). The 2-level ceiling is structurally certain from the queries; the *impact* on a regional buyer is the open question.
- **Live infra-event N+1 (F-4)** — code-traced, not load-reproduced (would require driving 25+ of 50 screens offline within the 90s cohort window on the live scanner; prior #238 verified correctness but not the sequential-upsert latency at fleet scale).
- **Seat enforcement at the real contracted limit (F-5)** — cannot test the "402 LICENSE_EXHAUSTED at limit" path because the pilot ceiling is 1000 and no License row sets a low limit on prod; verified the code path + SERIALIZABLE tx, not a live 402.

## Grade (Greg's 3 lenses)

- **Design — A−.** FleetRollup groups by US state, search/filter/health-triage, click-to-switch deep-links, store-tagged map clusters. Looks like a real manager console (Google MCC / NinjaOne pattern). Minor: no virtualization at 500+, alert links don't deep-link to the store.
- **UX — A−.** HQ overview → "Manage this location" one-click switch → publish-to-locations picker grouped by store with select-all-per-store. A non-IT operator can drive it. Friction: offline alert lands on HQ's own `/screens`, not the affected store (F-6).
- **Functionality — A−.** All three phases (roll-up, cross-location publish, fleet offline-alerting) work end-to-end live; isolation holds; injection rejected; seat tx is race-safe. Dings: 2-level ceiling undocumented (F-1), sibling-switch permissiveness for DISTRICT_ADMIN franchisees (F-2), and **the 1000-seat pilot limit means billing metering is effectively off for a live launch (F-5)** — the one item that genuinely needs a launch decision.
