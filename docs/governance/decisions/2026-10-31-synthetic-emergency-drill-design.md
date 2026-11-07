# Decision — Synthetic emergency drill on bench glass

Foundry Standard Phase 1, backlog item 2 (Articles 19, 20, 23, 33). Design only, no product code. 2026-10-31.

| | |
|---|---|
| **Situation** | Nothing continuously checks that a life-safety alert paints on real glass: `.github/workflows/emergency-path.yml` is mocked, not required, and stayed green while broadcasts dropped ~24 s after delivery. Proposal: a leased job drills one bench screen per hardware class daily through the real DRILL path, proves the paint, clears, and alerts the owner when it cannot. |
| **Evidence** | • A drill is mechanically an alert with its own audit actions (`apps/api/src/emergency/emergency-drill.ts`); a live alert refuses or ends it; an `isDrill: true` all-clear ends drills only. • `triggerEmergency` publishes before writing; device scope covers every face; `expiresAt` binds the manifest and the player's cache (`cacheEmergency`). • Paint proof (`apps/web/src/app/player/emergencyPaintProof.ts`, `apps/api/src/screens/emergency-proof.ts`): two visible frames, plus the APK window receipt; audited `PLAYER_EMERGENCY_NO_PAINT_PROOF` / `PLAYER_EMERGENCY_PAINTED`; `Screen.lastRenderedHash` reads `pending\|em:` / `em:` / `unconfirmed\|em:`, re-proved every 60 s. • `recordEmergency` emails a copy of every drill. • `Tenant.isInternal` marks VenueOS's own organisations ("NEVER set it on a paying customer"). • **Unknown:** glass latency per class; APK receipt within 5 s; the bench units' organisations. |
| **Recommendation** | (1) Call the controller's own `triggerEmergency` / `clearEmergency` in-process; no controller edit. (2) Verdict from server-recorded paint evidence on every pane. (3) Three releases (payload `expiresAt` +180 s, an all-clear in `finally` by +150 s, an orphan sweep), then a verified release. (4) Results as append-only `audit_logs` rows; no migration. |
| **Risk** | CHANGE class on the life-safety path, additive: trigger, manifest, player and APK untouched. Risks: allowlist misconfiguration (§1); false FAILs (shadow first; a slow APK receipt is a real defect, since the fleet UI reads the same evidence); a stuck drill (§2). Priority: life safety over rollout speed. |
| **Validation** | **Unverified**: nothing built or run. |
| **Rollback** | `EMERGENCY_DRILL_CRON_DISABLED=1` or unset `EMERGENCY_DRILL_SCREENS`, restart; revert the PR. No schema; audit rows stay. |
| **Models involved** | Design: Claude Opus 5.5 (Anthropic, Claude Code). Implementation review: a different vendor. |
| **Decision requested** | Approve / Reject / Modify. Two-way door; by default nothing runs. |
| **Decision** | (owner) · date |

## 1. Guards and threat model

Dispatch requires all five, re-checked just before:

1. Listed in `EMERGENCY_DRILL_SCREENS`, checked inside `runOnce(screenId)` so no caller can pass another id.
2. Organisation **root** `isInternal = true`, read fresh.
3. Paired, not `REVOKED`, checked in within 2 min, not in `intendedDowntime`.
4. No override entry on any pane; tenant `INACTIVE`; a `pl:` proof under 2 min old.
5. Redis connected; no `platform:critical` component.

Otherwise `SKIPPED`, nothing dispatched; failing guard 2 also alerts the owner once per boot.

- **No new trigger path:** no route, button or webhook, only an in-process timer (a spec asserts `drill/` declares no controller or route); one frozen builder emits `isDrill: true`, device scope, `expiresAt ≤ +180 s`.
- **No new privilege:** no token, user or key; an in-memory `{ role: SCHOOL_ADMIN, tenantId: <screen's tenant> }` with **no `id`** (a fake id fails the audit insert after the fan-out left). Not SUPER_ADMIN: `assertSupportReach` is a no-op outside a request frame (`support-access.context.ts`).
- **Skipped HTTP layers** carry no delivery; the runner applies `TriggerEmergencyInputSchema.parse`.
- **Email suppression** covers only ids this process minted (`ovr_drill_<uuid>`), only when `isDrill === true`.
- **Real emergencies win:** live alerts refuse and end drills; a drill all-clear cannot end a live alert.
- **An attacker who can write env vars** already holds `DEVICE_SECRET_KEY`.

## 2. One drill run

`LEASE.EMERGENCY_DRILL` gates the tick only; trigger and all-clear stay un-leased (lease rule 2). No Redis, no drill, so leadership is never degraded. Serial, ≤ 12 screens.

| t | Step |
|---|---|
| before | Redis NX slot claim, orphan sweep, guards; rotate the type through all six; register the id; audit `EMERGENCY_DRILL_STARTED`. |
| 0 | `triggerEmergency`: device scope, `isDrill: true`, default severity, no text (nothing to translate), `expiresAt` +180 s. A 409 → `ABORTED`. |
| +5 s | **Link 1, delivery + paint:** every pane painted the expected identity (the player's rule over `{type, severity, isDrill}`); separate raise and paint times let a FAIL name delivery or render. |
| +60 → +135 s | **Link 2, persistence:** 5 s point reads until each pane posts a painted proof dated ≥ +60 s (telemetry's 60 s cadence lands one by ~+120 s); any hash other than `em:<expected>` after first paint fails (the ~24 s drop class). |
| by +150 s | `clearEmergency(id, { device, isDrill: true })`, also in `finally`. |
| clear + 150 s | **Link 3, release:** each pane's hash has left every `em:` form, dated after the clear. |
| end | `EMERGENCY_DRILL_RESULT`: PASS needs all three; FAIL names the first failed link; INCONCLUSIVE = unreadable evidence. |

- **Owner email** (`alert`/`on`): ≤ 1 per tick (Redis-claimed, `PlatformAlertMailer`) listing every FAIL and INCONCLUSIVE; never a retry.
- **Dead-man** (`alert`/`on`): a daily email per screen with no PASS in 36 h.
- **Live alert mid-run:** `ABORTED`, no email.
- **Process dies:** `expiresAt` releases the glass on the next live manifest; an unreachable screen keeps the drill (RUNTIME rule), reported by link 3.
- **Orphan sweep** (boot + 2 min, each tick): one all-clear for a STARTED run without a RESULT.

## 3. Data model: no new table

Each run writes `audit_logs` rows on the bench tenant: `targetType 'Screen'`, `userId` null, details Zod-checked as `v: 1`.

- `EMERGENCY_DRILL_STARTED`: runId, overrideId, slot, mode, type, paneIds, hardwareModel, playerVersion, dispatchAt, expiresAt.
- `EMERGENCY_DRILL_RESULT`: verdict (PASS · FAIL · INCONCLUSIVE · SKIPPED · ABORTED), reason, failedLink, per-pane times and last hash, expected identity, alerted.

They sit beside the real path's rows (`TRIGGER_EMERGENCY_DRILL`, `PLAYER_EMERGENCY_*`, `CLEAR_EMERGENCY_DRILL`), readable today in Activity → All events (`?view=all`, SUPER_ADMIN) and its CSV export; the screen's Interruptions section shows the drill as "not counted". The existing DRILL labels apply because the payload is real. No customer feed shows them: drill actions need a person actor (`customer-activity.ts`).

**Why no `drill_runs` table:** it would need a new route and UI (owner rule) plus a migration (L2). Audit rows have no unique constraint, but the Redis claim covers that, since drills never run without Redis.

## 4. Configuration and failure directions

| Variable | Default | Values | Failure direction |
|---|---|---|---|
| `EMERGENCY_DRILL_SCREENS` | unset = nothing runs | screen UUIDs, no wildcard, ≤ 12 | bad tokens are ignored and logged; never widens |
| `EMERGENCY_DRILL_CRON_DISABLED` | unset | `1` = off, beats every other setting | subtractive |
| `EMERGENCY_DRILL_MODE` | `shadow` | `shadow` · `alert` · `on` · `off` | unknown → `shadow` + error log |
| `EMERGENCY_DRILL_SCHEDULE` | `10:00` UTC | ≤ 4 `HH:MM` UTC slots | invalid → no drills + error log; the dead-man check reports the gap |

All off under `NODE_ENV=test`.

- **Cannot run:** nothing is dispatched; a `SKIPPED` row is written if the DB is writable.
- **Cannot verify:** `INCONCLUSIVE`; the all-clear is still sent and the owner is alerted.
- **In doubt:** never trigger, always clear.

This becomes a Register B row.

## 5. Rollout and governance

| Stage | Behaviour |
|---|---|
| Dark | Deployed with no screens listed. |
| `shadow` | Drills run, verdicts recorded, no email; first run camera-witnessed. Exit: 14 days, every class daily, every FAIL explained, zero false FAILs. |
| `alert` | Owner gets per-tick and dead-man emails. |
| `on` | Verdicts become `MECHANISMS.md` evidence (Articles 19, 20, 23); holding promotion is Q4. |

CHANGE class on the life-safety path: work ≤ L1, a different-vendor review, the owner's merge, and the camera-witnessed drill (§7) before "done". Also consequential: it changes which emails go out. No schema or workflow edit; it never writes `HARDWARE-QUALIFICATION.md`.

## 6. Files

**Create** in `apps/api/src/emergency/drill/`:

| File | Purpose |
|---|---|
| `synthetic-drill.config.ts` | env parsing |
| `synthetic-drill.policy.ts` | pure rules: guards, rotation, grading, verdict, dead-man |
| `synthetic-drill.runner.ts` | schedule, lease, sequence, email; gets `EmergencyController` via `ModuleRef` |
| `synthetic-drill.registry.ts` | module state: minted ids (15 min TTL), screens in flight |
| `synthetic-drill.copy.ts` | owner email text |

Also `packages/api-types/src/emergency-paint-identity.ts` (a copy of the player's identity rule; the player keeps its own), and specs `synthetic-drill.{config,policy,runner,integration}.spec.ts` plus `apps/web/src/app/player/__tests__/paint-identity-parity.test.ts`.

**Change:**

| File | Edit |
|---|---|
| `apps/api/src/realtime/leader-lease.service.ts` | add the lease |
| `apps/api/src/app.module.ts` | register the provider |
| `apps/api/src/notifications/customer-alerts/customer-alert-emails.service.ts` | `recordEmergency` skips registered drill ids; `loadFacts` reads drill rows |
| `apps/api/src/notifications/customer-alerts/customer-alert-policy.ts` | defer reason `synthetic-drill` (run + 10 min), excluded from `platformClusterAround` |
| `packages/api-types/src/index.ts` | export the identity rule |
| `CLAUDE.md`, `.env.example`, `docs/governance/AUTONOMY-REGISTER.md` | env rows; the Register B row |

**Unchanged:** `apps/api/src/emergency/emergency.controller.ts`, `apps/api/src/screens/screens.controller.ts`, `apps/web/src/app/player/**`, `apps/player/**`, `.github/workflows/emergency-path.yml`.

## 7. Tests

- **Unit:** nothing set runs nothing and typos never widen; `drill/` has no controller or route; each guard skips without dispatching; every type's payload is a device-scoped drill expiring within 180 s that parses; grading over sequences cut from the producer (`emergencyRenderHash`, the identity rule, the render-proof handler's rows); a live alert is never suppressed; the `synthetic-drill` defer applies.
- **Runner** (fake clock): the all-clear goes out on every exit (throw, lost lease, deadline); one run per slot, in series; one email per tick, no retry; a 409 or a live-alert end gives `ABORTED`; the orphan sweep acts once.
- **Integration** (styled on `emergency.success-path.spec.ts`): the runner drives the real controller and gets a signed OVERRIDE on every face, `isDrill` rows with `expiresAt`, `TRIGGER_EMERGENCY_DRILL` and no record copy; the real render-proof handler fed the watcher's proof gives PASS, withheld gives FAIL (render); after `expiresAt` the manifest has no emergency.
- **Parity** (web Jest): the shared identity equals the player's across every type, severity, drill/live and case.
- **On glass**, per class, camera on the panel and the Activity page: a shadow run PASSes with paint ≤ 5 s on every pane; the video shows the alert until the clear, then content; no record copy. **Negative control:** unplug a unit's network before its slot; expect FAIL (delivery), exactly one owner email in `alert`, the all-clear sent, content restored. A gate never seen to fail is a hypothesis (Article 18).

## 8. Open questions for the owner

1. Which bench screen ids (GUQ, rk3288 double-sided, rk3328, Taurus)? Are they all in an internal organisation?
2. Are the panels awake at 10:00 UTC?
3. Add a standby variant with a 30 s bar? (The native watch polls dark panels every 15 s.)
4. Should a FAIL hold canary auto-promotion for that class?
5. v1 covers device-scope OVERRIDE only; the 2026-10-22 drop was in pushed messages and district copies (no drill payload). Add a bench district drill and a broadcast drill flag?
6. Which vendor reviews?

## 9. Lead review (Claude Fable 5.1, 2026-10-31) — verdicts before the owner reads

**Adopted as designed:** the in-process call of the real `triggerEmergency` / `clearEmergency` (no route, token or privilege added); the verdict from server-recorded paint evidence on every pane; the three releases (`expiresAt` ≤ +180 s, the all-clear in `finally`, the orphan sweep); the double block on customer screens (allowlist **and** the organisation root's `isInternal`); email suppression scoped to runner-minted ids with `isDrill`; shadow → alert → on; results as audit rows for v1.

**Modified — these are requirements for the implementation PR, not suggestions:**

1. **Attribution.** Drill rows must not carry `userId: null`. The reason given (a fake id fails the audit insert after the fan-out has left) is right about a *fake* id; the answer is a *real* one: a login-disabled service identity per bench organisation (e.g. a `drill-runner` user, `SCHOOL_ADMIN`, `can_trigger_panic` true, no usable credential), created only for `isInternal` organisations. Every audit row then names the runner, and "who fired this alert?" is always answerable (Article 37). If the trigger path rejects a disabled principal, the implementer proposes the smallest change (a dedicated status is an L2 schema change) rather than falling back to `null`.
2. **Coverage — v1 must drill the failure we actually had.** The device-scope OVERRIDE is necessary but it is the path that already worked; the ~24 s drop of 2026-07 → 10-22 was in **pushed broadcast messages and district copies**. v1 includes a broadcast-message drill (`isDrill`, bench screen, same three links) and, where a bench district exists, a district-copy check. Exit from `shadow` requires both drill kinds passing daily per class. (Open question 5: yes, in v1.)
3. **Schedule in the panels' own ON window.** `10:00 UTC` is 02:00–03:00 Pacific; a panel on an on/off schedule is in `intendedDowntime` then, every run is `SKIPPED`, and the dead-man email becomes the only output. Slots are expressed in the screen's own time zone (now known per screen, `screen-time-zone.ts`) inside its ON window — default mid-morning local — and the dead-man check still catches a class that is never drilled. (Open question 2 answered.)
4. **A FAIL holds canary auto-promotion for that hardware class** (open question 4: yes). That is Article 34's error-budget rule applied where it matters most.
5. **Standby variant** (open question 3): not in v1, first thing after — the 2026-10-05 P0 was a panel that is OFF, and a drill against a panel in standby is the highest-value drill we can run.
6. **Reviewer vendor** (open question 6): the implementation is reviewed by a model from a vendor other than Anthropic (Codex), because the designer and the implementer are both Claude.

**Owner decisions still needed:** question 1 (which bench units, and confirming their organisations are flagged internal — flagging one is an owner action), and approval of this design as modified above. No code is written until then.

## 10. Owner's answers and the lead's defaults (2026-11-01)

The owner approved the design as modified in §9 ("today we wrap up"; he does not want to adjudicate bench lists). The lead's defaults, which the owner may veto:

- **Bench organisation:** the internal tenant `dodgers` ("Brookfield Residential Northern California", `is_internal = true`, 21 screens, 1 user) is the owner's bench — every unit on it is a test unit. **Before any drill ever runs, the real launch customer's production organisation must be a separate, non-internal tenant**; the drill's guard 2 (root `isInternal`) is only a guard if that stays true. The lead will verify this at implementation time and again before `shadow` starts.
- **Bench screens (≤ 12, one per hardware class, from the internal tenant):** GUQ55 `1cff5eb0-…`, GUQ65 `69b7bf43-…` (Goodview GUQ class), DH43 `40864836-…` + DH43 — Back `80bf9b8d-…` (rk3288 double-sided, both faces), M43 `c4945182-…`, M86 `8c83e356-…`, L55VEC `882706a8-…` (MAXHUB), LED Poster 3 `430ec97c-…` and Foldable LED `cf213ae7-…` (NovaStar Taurus — web-only player, RUNTIME class differs), G75 `ba3fc3b3-…`, Mobile A-Frame `81bdb7e5-…`. Full ids in the Register B row at implementation.
- **Schedule:** mid-morning in each screen's own zone (default 10:30 local), per §9.3.
- **Reviewer:** Codex, per §9.6.
