# Alert-path launch fixes 1-5: push reconnect, pushed-message stack, refresh deferral, alert identity, OTA hold (2026-11-21)

**Status.** Branch `claude/launch-fixes-1-5`, cut from `origin/master` `e20c3b8a2`: four `--no-ff` merges of the per-fix branches, one integration follow-up commit, and this document. Not merged. This is life-safety **CHANGE class** (`CLAUDE.md` §5). Before anyone relies on it, it needs all four of these:
- a **different-vendor review**, which is required and **not waived**: every review so far was done by Anthropic models;
- the owner's written go to merge;
- CI green on the nine required checks, including `webkit · Emergency path`, which nobody could run locally;
- an owner-approved on-glass drill on bench screens after deploy.

**Who wrote it.** Claude Opus 5.5 (`claude-opus-5-5`) wrote the code. Reviews ran on Claude Opus 5.5 and on Fable 5.2 (`claude-fable-5-2`). The harness was Claude Code on the web, with workflow-orchestrated agents. Each fix had its own author and an independent reviewer, then one more reviewer read the combined branch.

The owner approved fixes 1-5 from the 2026-11-21 launch audit in writing. There are five audit items in four change sets:

| # | Item | What went wrong (reliability) | What changes | Kill switch | Schema |
|---|---|---|---|---|---|
| 1 | EMG-03 | After a Redis blip longer than about a second, the API stopped reconnecting. Instant push to screens stayed down until a restart, and health still read "ok". | Both Redis connections reconnect forever. While push is down, the API delivers pushes to its own screens, and health says "degraded". | none new (see below) | none |
| 2 | EMG-04 | The web player held one pushed message. A newer INFO banner replaced an SOS, and any message clear removed whatever was on screen. | The player keeps every pushed message, shows the most severe, and clears by id. | none (client; rollback is a web redeploy) | none |
| 3 | FLT-09 | A durable "Resync" (`REFRESH_WEB`) could reload the page while an alert was on the glass. | The durable refresh waits, unacknowledged, until the alert ends, then runs once. | none (client) | none |
| 4 | EMG-01 | The tenant-wide alert had no id. An all-clear sent for an older alert ended a newer one, and a district clear ended a school's own later alert. | The tenant-wide alert carries an id. The all-clear is a compare-and-set on it, and a mismatch gets 409 `ALERT_CHANGED`. | `EMERGENCY_ALERT_IDENTITY_DISABLED` | additive migration |
| 5 | FLT-04 | A screen could be offered and install an APK update during an alert. The install restarts the player, which takes the alert off the glass. | The update check holds the offer while any alert, drill or pushed message is in force for the screen or any side of its unit. | `OTA_EMERGENCY_HOLD_DISABLED` | none |

## Commits

| Commit | What |
|---|---|
| `a0b8304dd` | merge `claude/fix-emg-03` (fix `8e5064b59`) |
| `4f3992a6c` | merge `claude/fix-emg-04` (fix `c6f927bf1`), EMG-04 + FLT-09 |
| `b30cb1693` | merge `claude/fix-flt-04` (`6ac12a573`, review round 1 `41dae36fd`) |
| `4be586a15` | merge `claude/fix-emg-01` (`af55bd1ca`, review rounds 1-3 `9559873b9`, `acdfdee1a`, `a4532163d`). The only conflict was the generated count line in `docs/ENVIRONMENT.md`, which was regenerated with `apps/api/tools/generate-env-docs.cjs` (279 variables, 70 kill switches). |
| `8d0dd31ef` | Integration follow-ups: the operator readiness "Delivery chain" item now uses the live push-channel state, and a stale comment about how the player clears messages is corrected. |

## 1. EMG-03: the push channel survives a Redis outage

**Before.** The Redis clients gave up after three retries. After any blip longer than about a second, ioredis ended both connections for good. The `connected` flag was set once at boot and kept reading true. So `publish()` kept writing to a dead connection and never used the in-process fallback, which on today's single replica reaches every screen. Screens fell back to the 5-12 s poll until someone restarted the API, and the health probe said "fallback / ok".

**After.**
- **Reconnect.** Both connections reconnect forever, with backoff capped at 5 s. A connection that still reaches `end` is dialled again. The 7 s boot cap is unchanged.
- **Honest state.** `connected` is true only while the publisher is ready and the subscriber has confirmed its `psubscribe` on its current connection. The subscriber re-subscribes on every `ready`.
- **While push is down.** `publish()` delivers once to this process's WebSocket and SSE clients, through the same HMAC gate, and sends nothing to Redis. The offline queue stays off, so nothing is replayed late.
- **While connected.** A screen-channel publish that Redis rejects, loses in flight, leaves unanswered for 1 s, or delivers to no subscriber is delivered locally at once. After a timeout, later publishes go local first, so a district fan-out pays one wait, not one per school.
- **Duplicates.** A memory of delivered (channel, eventId) pairs drops the copy ioredis re-sends after a reconnect, so a screen never sees a duplicate or a cleared alert raised again. Telemetry channels such as `metrics:ack` keep their single plain PUBLISH.
- **Revocations.** A token revoked during an outage reaches only the Postgres mirror. So after any lost connection, or any revocation write that missed Redis, a Redis miss is not trusted until a restore that started afterwards has finished. Until then, lookups read Postgres. A process that never lost Redis behaves as before.
- **Shutdown.** It closes connections that are still reconnecting, so it no longer hangs.
- **Health.** `/api/v1/health/emergency-path` adds `checks.push`. While push is down it reports `status: "degraded"` with a plain `push_reason`. HTTP codes are unchanged: 503 only for the database or the signer. The platform-health email reports a lost push channel as DEGRADED, gives the reason and says no restart is needed.
- **Readiness (integration commit `8d0dd31ef`).** In `apps/api/src/emergency/emergency-readiness.service.ts`, `probeDelivery()` counts a publisher PONG as ok only while `pushChannelState().live` is true. Otherwise, or if reading the state throws, the item shows the existing WARN / `delivery.fallback` code, so there are no new strings. This change can only lower the grade.

**Files.**
- `apps/api/src/realtime/redis.service.ts`
- `apps/api/src/health/health.controller.ts`
- `apps/api/src/health/platform-health-monitor.service.ts`
- `apps/api/src/emergency/emergency-readiness.service.ts`
- `apps/api/src/config/env-schema.ts` (the `REDIS_URL` note)
- `docs/ENVIRONMENT.md`
- `docs/DEPLOY.md`

**Configuration.** No new variable. The existing `REDIS_DISABLED=true` is subtractive: Redis is treated as absent, and realtime drops to HTTP polling. It turns the instant path off; it does not restore the old reconnect behaviour. Rolling back the code means redeploying the previous build.

**Failure direction.**
- Toward local delivery and the poll backstop, never toward silence.
- Revocation checks fall toward Postgres.
- The health body reports degraded while the status stays 200.

**Client compatibility.** No client or wire-format change. Old web bundles, APKs 1.1.23-1.1.67, panic phones, GPIO and API keys get the same signed envelopes, and now also receive pushes during an outage.

## 2 and 3. EMG-04 + FLT-09: the player's pushed-message stack and refresh deferral

**Before.** The web player held only one pushed message, so every SOS, broadcast or media-alert push replaced it, and an INFO banner could take a CRITICAL SOS off the glass. Every `ALL_CLEAR_MESSAGE` emptied that one slot without reading the `messageId` the API signs. A durable `REFRESH_WEB` (the manifest's `refreshRequestedAt`) could reload the page while an alert was showing.

**After.**
- **The held set.** Every push that passes the signature, freshness and replay gates is kept, keyed by `messageId`. The code is a small pure module, `apps/web/src/app/player/pushedMessages.ts`.
- **What the glass shows.** The highest severity, then the newest. This is the overlay poll's own ordering, moved into one shared comparator.
- **Clears.** A clear removes only the id it names. A clear for an unknown id, or with no id, changes nothing: the API always signs an id, so this fails toward showing the alert.
- **Reconcile.** The existing 12-second server check releases a held id after two misses. It also raises messages the server lists that this screen never received as a push. It uses the same request at the same rate, with guards for requests already in flight.
- **Limits.** A hidden entry expires at its own `expiresAt` + 60 s on the monotonic clock. The message on the glass never leaves on a clock alone. The set is capped at 50.
- **Poll handover.** A message the overlay's own poll was showing is carried into the held set when the first push lands, so a later banner cannot hide it.
- **FLT-09.** The durable refresh waits, unacknowledged, while any alert is on the glass (`refreshWaitsForAlert` in `apps/web/src/app/player/durableRefresh.ts`). It runs on the first live manifest answer (200 or 304) after the alert ends. After a reload, the overlay's existing immediate poll brings active messages back. No boot call and no new timer were added: the timer baseline is unchanged, and the request budget passes.

**Files.**
- `apps/web/src/app/player/pushedMessages.ts` (new)
- `apps/web/src/app/player/durableRefresh.ts` (new; the code was moved out of the page)
- `apps/web/src/app/player/page.tsx`
- `apps/web/src/components/player/EmergencyOverlay.tsx`
- `apps/api/src/emergency/emergency.controller.ts` (comment only, `8d0dd31ef`)

**Configuration.** No variable and no server change. Rollback is a web redeploy.

**Failure direction.**
- Toward showing the alert: an unknown or id-less clear keeps the message, and the server reconcile releases it within about 24 s.
- Toward deferring a refresh rather than reloading over an alert.

**Client compatibility.** Old clients keep their earlier behaviour: service-worker-cached bundles until they update, and the APKs. Taurus: the added player code uses no `inset` shorthand and no flex `gap`. `check-inset-serialization` and `check-taurus-safety` pass.

## 4. EMG-01: the tenant-wide alert carries an id

The full design, the reproduction against a real Postgres 16 and the drill are in `docs/handoffs/2026-11-21-emg-01-alert-identity.md`. In short:
- **Schema.** Two nullable columns, `Tenant.emergencyAlertId` and `Tenant.emergencyTriggeredAt`. Every tenant-level trigger writes them in the same update as the status. This covers the dashboard, `/panic`, panic phones, drills, API keys and the district fan-out.
- **Refusal.** When an all-clear names a different, identified, active alert, it is refused before anything is dispatched, with 409 `ALERT_CHANGED` and `currentAlert`. An immutable `CLEAR_EMERGENCY_REFUSED` audit row is written. The method-scoped `TenantAlertChangedConflictFilter` carries the 409 body past the global filter.
- **Compare-and-set.** The root write, the district descendants' write and the End Drill batch all carry the compare-and-set. A trigger that lands between the read and the commit rolls the whole batch back, so nothing is committed.
- **District clears.** A district all-clear leaves a school that holds its own, different alert alone. `GET /emergency/active` lists that school's alert beside the district's, each alert once. The response's `keptTenantIds` names one entry per kept alert, and `keptListedForCaller` decides which toast wording the dashboard uses (en, es, zh).
- **Web.** The dashboard overlay and `/panic` send the listed alert's id. On a 409 they ask for a fresh confirmation, and the next clear names the alert the 409 reported. Every response body read in the trigger and all-clear actions is bounded at 3 s, so a landed all-clear is never reported as not sent.
- **Old clients.** These clear exactly as before: a request with no id, `clear_<uuid>`, `global_clear`, a stored NULL id (an alert raised before deploy), and the kill switch.

**Files.**
- API:
  - `apps/api/src/emergency/emergency.controller.ts`
  - `apps/api/src/emergency/tenant-alert-identity.ts` (new)
  - `apps/api/src/emergency/tenant-alert-changed.filter.ts` (new)
  - `apps/api/src/tenants/tenants.controller.ts` (`GET /tenants` returns the id)
  - `apps/api/src/emergency/emergency.targeting.world.ts`
- Web:
  - `apps/web/src/actions/trigger-emergency.ts`
  - `apps/web/src/components/layout/EmergencyOverlay.tsx`
  - `apps/web/src/app/panic/page.tsx`
  - `apps/web/src/lib/emergency-target.ts`
  - `apps/web/src/i18n/messages/{en,es,zh}.json`
- Docs:
  - `apps/api/src/emergency/CLAUDE.md`
  - `packages/database/CLAUDE.md`
  - `docs/BACKUP_AND_ROLLBACK.md` (rolling back across EMG-01, then forward)
  - the EMG-01 handoff

**Migration.** `packages/database/prisma/migrations/20261121120000_tenant_emergency_alert_identity/migration.sql`.
- It adds two nullable columns with no default, in one `ALTER TABLE "tenants"` using `ADD COLUMN IF NOT EXISTS`, under `SET lock_timeout = '5s'`, because `tenants` is read by every manifest poll.
- It is catalogue-only: no rewrite and no backfill.
- It applied cleanly with all 174 migrations on a throwaway Postgres 16, and re-running it by hand is a no-op.
- The previous build ignores both columns.

**Kill switch.** `EMERGENCY_ALERT_IDENTITY_DISABLED` (`1 | true | yes`, case-insensitive, read per request) is subtractive. The trigger keeps writing the id, so unsetting the variable restores the rule with nothing lost. Set it only if operators are refused an all-clear they must send: it brings back the old defect.

**Failure direction: closed.** If the pre-dispatch identity read cannot run, the all-clear is not refused at that point, and the compare-and-set on the write still keeps a newer alert.

## 5. FLT-04: no APK install offered while an alert is on the glass

**Before.** `POST /api/v1/player/update-check` read no emergency state. An operator push, a bulk push, a field-build push, an automatic off-hours offer, a canary cohort or a panel tap could install an APK during an alert. Android then kills the player process, and the alert leaves the glass until the new build relaunches.

**After.**
- **The check.** `resolveOtaEmergencyHold` (`apps/api/src/player-ota/ota-emergency-hold.ts`) runs once, after the existing auto, push, window and canary gates, and before any release lookup, offer count, field-offer audit or push clear. It runs only when an offer is about to be made.
- **What holds an install.** Any of these: a per-screen override that has not expired; a tenant or ancestor whose `emergencyStatus` is not INACTIVE, live or drill (this reuses `resolveEmergencyHold`); an active pushed message the screen may see, of any severity; or render proof from the last 10 minutes that names an emergency.
- **Double-sided units.** A double-sided unit is read whole: the primary and every face, in one tenant-scoped query.
- **The held answer.** `{ uptoDate: true, heldFor: "emergency" }`. Player 1.1.23-1.1.67 and Manager 1.0.24 read it as "nothing newer".
- **The push is deferred, not dropped.** The push record is left unchanged and is offered on the screen's next check after the all-clear. It ends as EXPIRED only under the existing 24 h rule.
- **Legacy Manager lane.** When `MANAGER_SELF_UPDATE_LEGACY_LANE=on`, the same hold applies.
- **Not held.** The Manager's bootstrap of a kiosk that has no Player, because that install is how the alert reaches that glass.
- **Log.** `[ota] decision=uptoDate-held-for-emergency … source=<screen|tenant|ancestor|message|glass|unreadable> unit-screen=<id>`.

**Files.**
- Code:
  - `apps/api/src/player-ota/ota-emergency-hold.ts` (new)
  - `apps/api/src/player-ota/player-ota.controller.ts`
  - `apps/api/src/player-ota/push-tracking.ts` (the stored EXPIRED reason names an alert as a possible cause)
- Spec harnesses that now state "no alert anywhere": seven player-OTA specs and `field-window-gate.http.spec.ts`.
- Config and docs:
  - `apps/api/src/config/env-schema.ts`
  - `docs/ENVIRONMENT.md`
  - `docs/governance/AUTONOMY-REGISTER.md` (one Register B row)

**Kill switch.** `OTA_EMERGENCY_HOLD_DISABLED` (`1 | true | yes`, any case) restores the previous behaviour exactly: nothing is read and nothing is held.

**Failure direction: closed.** When emergency state cannot be read, the install is held. A delayed update is safe; an install during an alert is not.

## Configuration summary

| Variable | Default | Kill switch | Failure direction | Declared in |
|---|---|---|---|---|
| `EMERGENCY_ALERT_IDENTITY_DISABLED` (new) | unset (rule on) | yes, subtractive | closed | `env-schema.ts`, generated rows in `docs/ENVIRONMENT.md` and `.env.example` |
| `OTA_EMERGENCY_HOLD_DISABLED` (new) | unset (hold on) | yes, subtractive | closed | `env-schema.ts`, generated rows plus the hand-kept row in `docs/ENVIRONMENT.md`, `.env.example`, Register B |
| `REDIS_URL` (note changed) | — | `REDIS_DISABLED=true` (existing) | open (toward local delivery and polling) | `env-schema.ts` |

## Tests

New or extended specs on the integrated branch, all passing (run 2026-11-22):

| Spec | Tests | Fix |
|---|---|---|
| `apps/api/src/realtime/redis.service.reconnect.spec.ts` (new) | 15 | EMG-03 |
| `apps/api/src/realtime/redis-revocation-continuity.spec.ts` | 20 (5 added) | EMG-03 |
| `apps/api/src/health/health.emergency-path.spec.ts` (new) | 6 | EMG-03 |
| `apps/api/src/health/platform-health-monitor.spec.ts` | 17 (3 added) | EMG-03 |
| `apps/api/src/emergency/emergency-readiness.service.spec.ts` | 24 (4 added) | EMG-03 follow-up |
| `apps/web/src/app/player/__tests__/pushedMessages.test.ts` (new) | 33 | EMG-04 |
| `apps/web/src/app/player/__tests__/durableRefresh.test.ts` (new) | 16 | FLT-09 |
| `apps/web/src/app/player/__tests__/pushedMessagesWiring.test.ts` (new) | 8 | EMG-04 |
| `apps/web/tests/e2e/emergency-path.spec.ts` 8b, 8c, 8d (new); test 8, `broadcast-playback.spec.ts` and `broadcast-banner-style.spec.ts` moved to the signed `{ messageId }` clear | Playwright | EMG-04, FLT-09 |
| `apps/api/src/emergency/emergency.alert-identity.spec.ts` (new) | 42 | EMG-01 |
| `apps/api/src/emergency/tenant-alert-identity.spec.ts` (new) | 37 | EMG-01 |
| `apps/api/src/emergency/tenant-alert-changed.http.spec.ts` (new, real HTTP with the global filter) | 5 | EMG-01 |
| `apps/web/src/actions/__tests__/trigger-emergency.test.ts` | 17 | EMG-01 |
| `apps/web/src/app/panic/__tests__/panic-page.test.tsx` | 16 | EMG-01 |
| `apps/web/src/components/layout/__tests__/EmergencyOverlay.alert-identity.test.tsx` (new) | 17 | EMG-01 |
| `apps/web/src/lib/__tests__/emergency-target.test.ts` | 18 | EMG-01 |
| `apps/api/src/player-ota/ota-emergency-hold.spec.ts` (new) | 38 | FLT-04 |

Each author checked that the new tests fail on the unfixed code. Some examples:
- EMG-03: 13 of 15 reconnect tests fail on master.
- EMG-04: all 8 wiring tests fail on master's page, and so do e2e 8b, 8c and 8d.
- EMG-01: 16 of 47 fail with the identity check removed.
- FLT-04: 15 of the first 27 fail on the unfixed controller.

Real-service probes, all on throwaway local instances that were deleted afterwards:
- A redis-server driving the real `RedisService`: down at boot, late start, killed for 8 s, restart, SIGSTOP/SIGCONT, and a subscriber-only kill. Each envelope was delivered once throughout.
- A Postgres 16 with every migration applied, driving the live, drill and district compare-and-set batches.

### Gates on the integrated branch (2026-11-22, local)

| Gate | Command | Result |
|---|---|---|
| Lockfile drift | `pnpm install --frozen-lockfile && git diff --exit-code pnpm-lock.yaml` | pass |
| API build | `pnpm --filter api run build` | pass |
| Web typecheck | `cd apps/web && npx tsc --noEmit -p tsconfig.json` | pass (0 errors) |
| Schema ships a migration | `BASE_SHA=<origin/master> node scripts/check-schema-has-migration.cjs` | pass |
| Rulebook | `node scripts/check-rulebook.cjs` | pass |
| Tenant isolation | `node apps/api/tools/check-tenant-isolation.cjs` | pass (0 unscoped) |
| Env docs | `node apps/api/tools/generate-env-docs.cjs --check` | pass |
| Env declared | `node apps/api/tools/check-env-declared.cjs` | pass (279 declared, 0 errors) |
| i18n parity | `node apps/web/tools/check-i18n-parity.cjs` | pass (7664 keys in en, es, zh) |
| Taurus `inset` | `node apps/web/tools/check-inset-serialization.cjs` | pass (0 confirmed) |
| Request budget | `node apps/web/tools/check-request-budget.cjs` | pass |
| CI-wired gates | `node scripts/venueos.cjs verify` | 35 of 36 pass. `player-test-execution` fails here because it reads JUnit XML that only a Gradle `testDebugUnitTest` run writes. This branch changes nothing under `apps/player`, and that workflow is path-filtered to it. |
| API jest | `cd apps/api && npx jest src/emergency src/realtime src/health src/player-ota src/screens --ci` | pass (170 suites, 2790 tests) |
| Web jest | `cd apps/web && npx jest src/app/player src/app/panic src/components/layout src/actions --ci` | pass (151 suites, 2218 tests) |
| Web Next build, Docker boot smoke, Playwright `chromium · Emergency path` / `webkit · Emergency path` | CI | not run here; CI runs them |

Earlier in the workflow, the integrator and the combined reviewer ran the Chromium emergency-path Playwright suite against a local production build, using headless shell 1243 in place of the pinned 1217. Both runs passed, including the new 8b, 8c and 8d. WebKit could not run in this sandbox.

The full API suite has one failing suite, `src/assets/assets-accept-containers.controller.spec.ts`: 12 tests fail with `ffmpeg-failed`. The same 12 fail on `origin/master` in this sandbox, and no file under `src/assets` is touched. CI should be green there.

## Review history

Every review below was done by an Anthropic model. **None of them counts as the different-vendor review §5 requires.**

| Fix | Rounds | Outcome |
|---|---|---|
| EMG-03 | 1 (Opus 5.5) | Approved, no must-fix. Should-fix items are listed under follow-ups. |
| EMG-04 + FLT-09 | 1 (Opus 5.5) | Approved, no must-fix. The stale API comment was fixed in `8d0dd31ef`. |
| FLT-04 | 2 (Opus 5.5) | Round 1 had one must-fix: a double-sided unit was held only for its primary side. It was fixed in `41dae36fd`, and round 2 approved. |
| EMG-01 | 4 (rounds 1-3 Opus 5.5, round 4 Fable 5.2) | Each of rounds 1-3 found one or two must-fixes, all fixed: the 409 body survives the global filter; a district clear keeps a school's own newer alert; `/active` lists each alert once; the kept-alert toast counts alerts and is worded for the caller; the End Drill race is the 409; body reads are bounded. Round 4 approved, against `a4532163d`, with no must-fix. |
| Combined branch | 1 (Fable 5.2) | Approved with no must-fix. It reviewed the merged diff and each merge's resolution (`git show --remerge-diff`), with its own real redis-server and Postgres 16 probes and the Chromium emergency-path suite. It found no defect in how the fixes interact. It checked: local delivery against the player's id-keyed set and eventId dedupe; the alert id against the OTA hold's tenant and ancestor reads; refresh deferral against the OTA hold and id-based clears. |

## Deferred follow-ups, with reasons

**Before or soon after launch (owner attention):**
1. **EMG-01, degraded district path.** This is the highest item, raised by the round-3, round-4 and combined reviews. If the district pre-read misses its 1.5 s budget or fails, or a school raises its own alert between the read and the commit, the guarded write still keeps the school's alert on its row and its glass. But that school still gets the `CLEAR_EMERGENCY` audit row, the "cleared" email and ledger entry, an ALL_CLEAR push and an epoch of `active:false`, and the district admin gets no "kept" toast. The screens are glass-safe; the trail and the email claim more than happened.
   - The designed fix: after the commit and after dispatch, re-read the cleared descendants. Report any that still hold another identified alert in `keptTenantIds`, drop them from the email and the ledger, set their epoch back to active, and write a corrective audit row.
   - Deferred because it adds a read, a new audit row and changes to the email and ledger paths, which need their own CHANGE-class review.
2. **EMG-01, API-key integrations.** An integration that re-triggers a tenant-wide alert without sending `overrideId` mints a new id each time. Its all-clear naming the first id is then a 409 instead of a clear, and the alert stays up, which is the safe direction. Before launch, integrators should be told to send the latest `overrideId`, or none. `EMERGENCY_ALERT_IDENTITY_DISABLED` is the remedy if one cannot change.
3. **EMG-01, launch-week support note.** A service-worker-cached dashboard bundle from before this change, whose alert list cannot load, resends the id it triggered with. If another alert replaced that one, it gets "All clear failed: 409" on every retry until the list loads or the tab reloads. The alert stays visible meanwhile. The remedies are a reload, `/panic` or another device, or the kill switch. This is in `docs/BACKUP_AND_ROLLBACK.md`.
4. **EMG-01, owner decision.** A school admin whose all-clear leaves a child location's own alert in place cannot see or end that alert. Their list shows only their own tenant, and the toast now says so honestly. Either a school admin's list includes their child locations, or every tenant with child locations has a district admin.
5. **FLT-04, owner decision.** Messages of every severity hold installs, so a long-lived INFO or WARN banner holds every install in its tenant. It is documented as a deliberate superset. Narrowing it to WARN/CRITICAL, SOS and media alerts is the owner's call.
6. **EMG-04 / FLT-09, owner decision.** There is no kill switch, because the change is client-side and rollback is a web redeploy. FLT-09 defers an operator's Resync for as long as any message is on the glass, and the dashboard gives no feedback. `pendingRefreshAt` stays set meanwhile, and the media pipeline skips a rendition swap for a small screen while it is set. Record the kill-switch decision and any "held for an alert" dashboard copy (en, es, zh) as owner items.

**EMG-03:**
7. **A Redis that accepts connections but never answers.** For example, a paused container or a silent partition. Revocation and KV reads have no command timeout, so authenticated requests and device-credential checks can wait on the kernel's socket timeout. This is pre-existing and the same on master, but reconnect-forever makes it a state the API now sits in rather than abandons. Filed as its own finding. The suggested fix is a short (about 500 ms) bound on those reads that falls into the existing Postgres fallback. It changes behaviour for every caller of the raw publisher, so it needs its own review.
8. **Only the subscriber is down.** `publish()` delivers locally and sends nothing to Redis. That is correct for one replica. During a Railway deploy overlap, or with a second replica, the other container's screens get only the poll. Consider sending the PUBLISH as well; the (channel, eventId) memory drops the returning copy.
9. **The `REDIS_URL` row.** Its row in `docs/ENVIRONMENT.md` does not name its kill switch (`REDIS_DISABLED`) or its failure directions (toward local delivery; revocation toward Postgres). Add one sentence in `env-schema.ts` and regenerate.
10. **Other health surfaces.** `/api/v1/health` liveness and the public `/status` realtime tile still read only the publisher. Consider reading `checks.push`.
11. **Dedupe memory size.** `DELIVERED_MAX = 10_000`. A device-channel fan-out to more than about 10k screens within 120 s evicts the oldest entries. The player's own eventId dedupe still covers sensitive types. Size it to the fleet or note the bound.
12. **An integration test with a real redis-server** restarted mid-test, for example in the emergency-path workflow.

**EMG-04 / FLT-09:**
13. **Pushed refresh arms.** The pushed WS and SSE `REFRESH_WEB` arms in `page.tsx` still defer only on the manifest alert or the shown pushed message. So a pushed refresh can reload a poll-only SOS or broadcast off the glass. Reuse the broader on-glass test in both arms and drop their 30-minute give-up. This is the same class as FLT-09 but outside its brief.
14. **A clear for a poll-only message.** An `ALL_CLEAR_MESSAGE` for a message shown only by the overlay's own poll, with the held set empty, waits for two empty polls (10-20 s). The log line wrongly says nothing on the glass changes. Pass the cleared id to the overlay. This is pre-existing.
15. **Clock steps.** Entries added from a poll row compute their expiry from the device's corrected clock, with no freshness bound. Drop a hidden entry on the clock only after the server has also missed it once.
16. **The tenant emergency hint.** It is read only by the overlay's own poll. Call it from the page reconcile too; it uses the same response and adds no request.
17. **The rulebook.** Record the deferral in `apps/web/src/app/player/CLAUDE.md` rule 6. Governed text was not edited here.
18. **More e2e coverage.** Add SSE-transport e2e for 8b and 8c, and a reload-with-a-live-message e2e.

**FLT-04:**
19. **The device side (APK, needs hardware qualification).**
   - Skip `triggerInstall` and keep the verified APK while `DisplayEmergency` holds. Do the same for the panel re-commit and `ManagerBootstrap`.
   - Read `heldFor` and keep the stored attempt. Today a held answer takes the DROP branch and discards a staged APK.
   - This also closes the offer-before-alert race.
20. **A held push can wait up to 6 h after the all-clear** for the periodic check, and it may expire at 24 h on the Android 9 "Commercial" class, whose periodic worker cannot run. It ends visibly. A post-all-clear `CHECK_FOR_UPDATES` nudge, or a heartbeat key that moves when the hold ends, is a separate CHANGE-class item.
21. **Held time counts toward the 24 h push expiry.** Not counting it needs a persisted "held since" stamp, which is a migration.
22. **OTA status while held.** While held, the screen's OTA status reads UP_TO_DATE and the dashboard push shows pending with no reason. Ignore CHECKING/UP_TO_DATE on `ota-state` while held, or expose the reason (en, es, zh copy proposal).
23. **Forensics.** One screen event or audit row on the first hold per push identity, with an in-memory dedup.
24. **The legacy Manager lane** with an unmatched fingerprint is logged but not held. Verify on hardware whether the Manager's `android-<ANDROID_ID>` equals the Player's stored fingerprint.

**EMG-01, other:**
25. **Pre-existing, its own finding.** A tenant all-clear that names an alert that already ended still sweeps per-screen rows with a null `alertId`, from the GPIO panic button and screen-emergency triggers. So a stale clear can end a newer GPIO alert. This is the same on master.
26. **A single tenant-wide entry still reads "all screens"** even when it is a school's own alert shown to a district admin. Naming it is a copy change for the owner.
27. **The at-commit race.** On a lost race, the catch restores the epoch but not the raise descriptor. Screens recover through the manifest re-read, so expect a possible brief flicker. Confirm on glass if the drill can stage it.
28. **`CLEAR_EMERGENCY_REFUSED` in the customer Activity feed** is an owner proposal. The allowlist excludes `*_REFUSED` by design.
29. **EMG-02** (district vs school precedence) should build on `emergencyAlertId`.

## On-glass bench drill (after deploy)

**Each test needs the owner's approval first.** Use bench screens on an internal test tenant only, with drills only. Never trigger a live alert in production, and never use a customer tenant. Run on every required hardware class:
- a NovaStar Taurus / Chromium 83 LED;
- an APK WebView on 1.1.23 and on 1.1.67;
- a browser kiosk;
- the DH43 double-sided unit for FLT-04.

Throughout, every screen must show `PLAYER_EMERGENCY_PAINTED` with no `NO_PAINT_PROOF`, and every trigger, all-clear and drill must write its audit row.

0. **Confirm the deploy.** `/api/v1/health` `commit` equals the merge SHA. `tenants.emergency_alert_id` exists. `/api/v1/health/emergency-path` answers 200 with `checks.push`, `checks.db` and `checks.ws_signer` all `"ok"`.

**EMG-03** (needs a bench Redis or bench API, never production):
1. Stop or restart the bench Redis for about 60 s.
   - The API logs "Redis push channel lost".
   - `emergency-path` shows `status: "degraded"` and a plain `push_reason`, and still answers 200.
   - `/api/v1/health` stays 200.
2. While Redis is down, trigger a DRILL lockdown. Every bench screen paints its staged board within about 1 s, which is push latency, not the 5-12 s poll. Then send the all-clear while Redis is still down: the screens release and no stale alert remains.
3. Bring Redis back without restarting the API. The log says "restored after N s". A second drill arrives once, with no double flash and no double reload.
4. **Flap.** Trigger a drill and restart Redis within about 1 s. Clear the drill while Redis is down, then let Redis return. No alert may reappear after the all-clear.
5. **Pause.** Pause Redis (SIGSTOP or the equivalent) in the middle of a drill. Send the all-clear while it is paused, then resume it.
6. **Revocations.** During an outage, log out a bench session and remove `canTriggerPanic` from a bench user. After Redis returns, both old tokens are still refused.
7. **Email.** After about 5 min of sustained outage, the DEGRADED platform-health email arrives with the reason and "No API restart is needed". The recovered email follows.
8. **Redeploy during an outage.** Redeploy the bench API while Redis is down. The old process exits without hanging, and the new one boots after at most a 7 s Redis wait and reconnects by itself.

**EMG-04 + FLT-09:**
9. **INFO under an SOS.**
   - Send a CRITICAL SOS: it paints full-screen.
   - Send an INFO broadcast to the same screen: the SOS stays and no banner appears.
   - Clear the INFO: the SOS stays.
   - Clear the SOS: content returns with no residue.
10. **SOS over a banner.** Send a WARN banner, then an SOS: the SOS takes the glass. Clear the SOS: the banner returns. Clear the banner: content returns.
11. **District copy.** Send a district broadcast to a school screen that already shows the school's own SOS. Clear the district copy: the school's SOS stays.
12. **Reload during an SOS.** With an SOS up, Resync or reload the screen, or block its WebSocket. The SOS comes back from the poll within about 10 s of the first manifest. Then send an INFO: the SOS stays.
13. **FLT-09, Resync during an alert.** With a broadcast or SOS up, press Resync on a push-blocked screen.
    - No reload happens, and `pendingRefreshAt` stays set.
    - Clear the alert: exactly one reload follows within one manifest answer.
    - `edu_refresh_ack` equals the command's value, and the server flag clears.
14. **Expired banner.** Send a WARN broadcast with a 5-minute expiry under a longer SOS. Clear the SOS after the WARN has expired: the expired WARN must not appear.

**EMG-01** (steps 2 to 8 of `docs/handoffs/2026-11-21-emg-01-alert-identity.md`, summarised):
15. **A stale clear is refused.**
    - Browser A sends a Hold drill to all screens.
    - Browser B escalates the same tenant to a Lockdown drill.
    - A types CLEAR before its list refreshes.
    - Expect "Nothing was cleared: a newer alert is now active (Lockdown)…", the screens stay on Lockdown with no blink, and there is one `CLEAR_EMERGENCY_REFUSED` row.
    - A's next CLEAR ends the Lockdown.
    - Repeat with `/panic` as A.
16. **District.**
    - The district raises a Weather drill, and a school (with a child location) raises its own Lockdown drill.
    - The district admin's list names each alert by location, once each.
    - The district clears the Weather. The school stays on Lockdown, the others release, and the toast says **1** location keeps its own alert.
    - School-admin variant: the toast says the alert is not in their list.
17. **No 409 loop.**
    - Run step 15, but block `/emergency/active` and `GET /tenants` for A right after the 409. A's next CLEAR ends the Lockdown at the first try.
    - With an old cached bundle, if one is available, expect "All clear failed: 409" until the list loads or the tab reloads, while the alert stays on the glass.
18. **End Drill race.** Start a Hold drill, escalate to a Lockdown drill in another browser, then send the first browser's End Drill. Expect the 409, the Lockdown drill on every screen, and no `CLEAR_EMERGENCY_DRILL` row for the Hold.
19. **Release timing.** Time a district all-clear from CLEAR to release on the glass. It should be no slower than before.
20. **Kill switch** (bench API only). With `EMERGENCY_ALERT_IDENTITY_DISABLED=1`, step 15's stale CLEAR ends the Lockdown, as before. Unset it.
21. **Safari.** Run steps 15 to 17 once in Safari.

**FLT-04** (one bench screen per required class: goodview-t982-a11, rockchip-rk3328-a11, rockchip-rk3288-a7, novastar-taurus, and the DH43; run a Player build older than the current stable release, or a bench-armed field candidate):
22. **Baseline.** With no alert, push an update. It installs, and the API logs `decision=install-…`. Reset the screen to the old build.
23. **Tenant drill, then push and panel tap.**
    - Expect `decision=uptoDate-held-for-emergency … source=tenant`.
    - The drill board stays painted with no player process restart.
    - The push stays pending.
24. **Other sources.**
    - Repeat with a district drill: expect `source=ancestor`.
    - Repeat with a per-screen drill: expect `source=screen`.
    - Repeat with a pushed text broadcast and no tenant alert: expect `source=message`.
25. **DH43.**
    - Start a per-screen drill on side B only, then push: expect `source=screen unit-screen=<side B id>`, with side B's board painted throughout.
    - Repeat with a device-scoped broadcast to side B: expect `source=message`.
26. **All-clear, then install.** Clear the drill and trigger a check (reboot, re-send or periodic). The held push installs and the version moves.
27. **Kill switch** (bench API only). With `OTA_EMERGENCY_HOLD_DISABLED=1`, the install is offered during a drill as before. Unset it.
28. **Records.** Record each class's result, attach the API and Player log lines, and note that this server change ships no APK.

## Rollback

- **Revert the pull request, or redeploy the previous build.** The migration is additive (two nullable columns), so the previous build runs unchanged against the migrated database.
- **Rolling back across EMG-01 and then forward again** leaves old ids on tenants that raised an alert in between. Before rolling forward, set `EMERGENCY_ALERT_IDENTITY_DISABLED=1` until those alerts are cleared, or the owner nulls both columns. See `docs/BACKUP_AND_ROLLBACK.md`, section A.
- **Without a redeploy.** `EMERGENCY_ALERT_IDENTITY_DISABLED=1` restores the old all-clear. `OTA_EMERGENCY_HOLD_DISABLED=1` restores the old update offers. `REDIS_DISABLED=true` drops realtime to polling. EMG-04 and FLT-09 roll back only with a web redeploy, and cached bundles follow on their next update.
