# Sports and Live-Data Audit Checkpoint

**Audit baseline:** `3f274702`  
**Scope:** Standard Audit Surface §7 and all 19 sports in the engine. Grades are code-based; physical venue displays, provider sandboxes, and hardware consoles were not available.

**Handoff drift:** current `master` contains later targeted sports fixes and source-literal removal. Treat the grades/findings below as the snapshot backlog until each later change passes the stated runtime, migration, multi-replica, and hardware acceptance evidence; do not close items from commit messages alone.

## Blunt verdict

The 19-sport engine is real—not a façade. It has database-backed game state, operator controls, screen assignment, player bindings, sport definitions, live boards, stats sanitization, auto-celebrations, and substantial automated coverage.

It is not yet world-class in live sports operations:

- Only the generic signed JSON feed is genuinely end-to-end.
- Daktronics support is provisional, limited to three sports, and can silently use the wrong sport parser.
- CTS water-polo support is the strongest hardware path, but some profiles and swimming-timing integration remain partial.
- Sportzcast, Scorebird, Genius Sports, Sportradar, MaxPreps, and GameChanger are not implemented as native integrations.
- Console activation depends on hand-constructed URL parameters and feed credentials.
- Important state changes are not consistently atomic, idempotent, audited, or pushed in real time.
- Cross-country and golf can show the wrong winner treatment because final-result logic assumes the higher score wins.
- Several long-tail sports are generic skins over the common engine rather than sport-authentic operating products.

## 19-sport scorecard

| Sport | Design | Operator UX | Functional depth | Principal gap |
|---|---:|---:|---:|---|
| Football | B+ | B | B | Daktronics provisional; no certified down/distance/play-clock workflow |
| Basketball | B+ | B | B | Daktronics can default to football parsing; full fouls/bonus/stat-feed mapping incomplete |
| Baseball | B | B | B | No provider-certified line-score/count/base-state ingest |
| Softball | B | B | B | Shares generic baseball foundations; no certified console/provider adapter |
| Soccer | B+ | B | B | No native data provider; discipline/substitution depth is limited |
| Volleyball | B | B | B- | Per-set history is explicitly missing |
| Wrestling | B- | B- | B- | Needs bout history, weight-class workflow, and authoritative team-total reconciliation |
| Hockey | B+ | B | B | No certified clock/penalty hardware or cloud adapter |
| Lacrosse | B | B | B | Generic goal-sport depth; penalty/possession workflows need expansion |
| Field hockey | B- | B | B | Generic goal-sport presentation and feed coverage |
| Water polo | A- | B- | B | Deepest console path, but bridge setup remains manual and WTTC is provisional |
| Pickleball | B | B | B- | Needs complete game/set/match history and serving-side validation |
| Track & field | B | B- | B- | Needs event/heat/lane management and timing-system integration |
| Swimming | A- | B- | B- | Strong board/lane UI, but CTS timing parser is not wired end-to-end |
| Diving | B+ | B- | B- | Judge pad exists; no certified timing/scoring-system ingest |
| Cross-country | C+ | C | C | No finish-order/displacer board; low-score winner handling is incomplete |
| Gymnastics | C+ | C | C+ | No apparatus-specific board or rotation workflow |
| Golf | C+ | C | C | No hole/player scorecard; final winner logic can incorrectly favor the higher score |
| Competitive cheer | C+ | C | C+ | No judging rubric, deduction workflow, or routine-specific presentation |

Long-tail debt is explicitly recorded in `apps/web/src/app/board/[gameId]/__tests__/sport-board-parity.test.tsx:292-315`, which calls out missing cross-country finish order, golf scorecard, gymnastics apparatus, and cheer judging surfaces. Volleyball set history is marked absent in `apps/web/src/components/widgets/sports/SportElementWidgets.sports.tsx:285-317`.

## Integration truth table

| Integration | Honest status | Evidence |
|---|---|---|
| Generic HMAC JSON feed | Implemented | Token issuance/auth/rate limiting/ingest/UI credentials at `apps/api/src/sports/sports.controller.ts:477-543`, `sports-board.controller.ts:271-313`, `sports-feed-token.ts:104-190`, `sports.service.ts:3511-3647` |
| Daktronics All Sport | Experimental/provisional | Football, basketball, and baseball maps exist, but offsets are unfield-verified at `packages/scoreboard-cts/src/daktronics/offsets.ts:26-35`; profile is provisional at `console-profiles.ts:165-179` |
| CTS Gen6/System6 water polo | Implemented in code; limited certification evidence | Classic decoder and real-wire legacy fixtures exist |
| CTS Gen7 RS-232 water polo | Implemented in code; limited certification evidence | Uses the classic decoder |
| CTS WTTC Gen7/WA2 | Provisional | Venue capture is pending at `packages/scoreboard-cts/src/console-profiles.ts:150-163` |
| CTS swimming timing | Partial library/API only | Parser and server endpoint exist; no client/bridge producer wires them together |
| Sportzcast | N/A—not built | No native adapter/parser; product health data says coming soon |
| Scorebird | N/A—not built | No native adapter/parser; only possible through customer middleware/generic feed |
| Genius Sports | N/A—not built | No credentials, webhook, poller, mapper, or reconciliation module |
| Sportradar | N/A—not built | No provider adapter or data-mapping layer |
| MaxPreps | N/A—not built | Discovery/coming-soon references only; no schedule, roster, or result sync |
| GameChanger | N/A—not built | No import/sync adapter; future-facing comments only |

The integration-health UI at `apps/api/src/health/integrations-health.controller.ts:810-878` treats Daktronics and named providers as coming soon, while provisional Daktronics code exists. Add explicit `NOT_BUILT`, `Experimental`, `Beta`, `Hardware-certified`, and `Production-certified` states, supported models/transports/sports, last-certification date, and limitations.

## P0 — tracked sports feed-signing secret

At the audit snapshot, a tracked production-capable integration script exposed signing material. The literal is removed at the current handoff HEAD, but rotation, token revocation, shared-key blast-radius migration, exposure review, and scanner verification remain open. The value and precise historic locator are not reproduced; keep them in the restricted incident record until revocation is proven. The complete safe runbook is embedded as Part II.F.

## P1 — provider adapters require explicit build-or-decline decisions

Sportzcast, Scorebird, Genius Sports, Sportradar, MaxPreps, and GameChanger are named but not native integrations. For each, product/partnerships must either record `DECLINED/UNAVAILABLE` with truthful customer copy or build a supported adapter with licensed API access, a versioned credential vault, webhook signature verification or durable cursor polling, rate-limit/backoff handling, team/game identity mapping, source priority, idempotency/reconciliation, disconnect/revoke, canary health, and contract fixtures. Do not scrape a provider that offers no supported partner API.

**Acceptance:** the integration remains `NOT_BUILT` and cannot appear connected until sandbox/contract fixtures pass; a revoked connection stops ingest; replay/out-of-order provider events are safe; team/game mismatches enter a visible reconciliation queue; marketing/help status is generated from the same capability record.

## P1 — console setup is not operationally complete

The player mounts the console bridge only when its URL contains `?cts=1` at `apps/web/src/app/player/page.tsx:7887-7912`. Persistent ingest also requires manually supplied `game` and `feedToken` query parameters. The game setup page tells operators to construct this URL at `apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx:7510-7571`.

The screen UI stores only `Screen.config.consoleProfile` at `apps/web/src/app/[schoolId]/screens/page.tsx:601-721`. The manifest carries the profile but not a complete active-game/console binding at `apps/api/src/screens/screens.controller.ts:3230-3240`. Selecting a console in UI therefore does not activate it.

Daktronics adds a correctness failure: `CtsBridge` defaults to football unless a `dakSport` prop/query value exists at `apps/web/src/components/player/CtsBridge.tsx:364-375`, `:424-429`, but the player does not pass that sport. Basketball/baseball packets can be interpreted with football offsets.

### Required implementation

- Mount the bridge from manifest configuration, not URL flags.
- Add a secure device-authenticated score-snapshot endpoint resolving `Screen.activeBoardGameId` server-side.
- Never place feed credentials in URLs, history, or logs.
- Derive parser sport from the active `Game.sport`; reject unsupported combinations rather than defaulting.
- Build an operator pairing wizard: select console, grant serial permission, detect packets, preview decoded fields, bind game, verify ingest, show reconnect health.
- Persist `consoleProfile`, `transport`, `sportMode:auto`, active-game binding, and certification metadata.
- Capture real packets for every supported model/sport and create golden replay fixtures before certification.

**Acceptance:** configure a Daktronics basketball console without URL editing; the player selects the basketball map. Restart restores binding. Switching to an incompatible sport is blocked. No secret appears in URL/logs. Disconnect/reconnect status reaches the dashboard within five seconds.

## P1 — game publishing and screen binding

The underlying binding is real:

- `Screen.activeBoardGameId` and surface fields: `packages/database/prisma/schema.prisma:864-875`.
- Show/hide logic: `apps/api/src/sports/sports.service.ts:1152-1271`.
- Board/ribbon/scorebug manifest generation: `apps/api/src/screens/screens.controller.ts:2392-2467`, `:2930-2970`.
- Template-zone game binding: `apps/web/src/components/widgets/sports/GameStateContext.tsx:36-77`, `:115-195`, `:231-265`.

Show/hide updates the database without a corresponding audit event or signed `SYNC`; players discover the change by manifest reconciliation. The UI says “Going live starts the game on every screen” at `sports/[gameId]/page.tsx:7480-7504`, but the handler only updates status at `:493-503`; it does not assign/notify screens.

### Required implementation

Put screen assignment, game state, and AuditLog creation in one transaction. After commit, send signed tenant/device `SYNC`. Either make Go Live deploy to an explicitly reviewed screen set or change the copy. Show a preflight list of affected screens/surfaces and expose partial-failure retry.

**Acceptance:** assignment, takeover, surface change, and removal reach physical players at p95 <2 seconds, survive reconnect, and create immutable audit entries.

## P1 — state integrity and real-time architecture

Boards fetch public game state every 750 ms; the service uses a per-process one-second cache at `apps/api/src/sports/sports.service.ts:203-224`, `:493-525` and `apps/web/src/components/widgets/sports/GameStateContext.tsx:113-188`. This works at small scale but is not multi-replica real time. A controller comment claiming feed ingest broadcasts signed pub/sub does not match implementation.

Build a versioned event path:

- Add `Game.revision`.
- Hydrate once from a snapshot.
- Publish signed `GAME_STATE_CHANGED` events through Redis-backed WS/SSE with revision, event ID, source, server timestamp, and snapshot.
- Detect revision gaps and rehydrate.
- Retain polling only as degraded fallback.
- Invalidate caches across replicas.
- Ship additive schema migrations and backfill revision/source state before enforcement. Roll out behind compatibility cohorts with dual polling/WS operation, adoption/error telemetry, abort thresholds, and a rollback that preserves monotonic state.

**Acceptance:** correlated source/API receipt to rendered-player acknowledgement p95 <250 ms in WS mode; revisions strictly monotonic; duplicate/reordered/delayed events never roll back state; reconnect misses nothing; compatibility-cohort rollback loses no state; 100 viewers do not generate ~133 snapshot requests/second.

## P1 — feed transaction and idempotency model

The generic feed accepts coarse absolute score/clock/segment state but no provider event ID, sequence, originating timestamp, stat payload, or idempotency receipt. A delayed request can overwrite newer state.

Create a source authority model and shared envelope. `GameSourceBinding` must record authority (`MANUAL | CONSOLE | PROVIDER`), `sourceConnectionId`, priority, lease/heartbeat, failover behavior, operator override, and explicit resume policy.

```ts
{
  schema: 'venueos.score.v1',
  tenantId,
  gameId,
  source,
  sourceConnectionId,
  sourceEventId,
  sequence,
  occurredAt,
  receivedAt,
  expectedRevision,
  currentRevision,
  kid,
  signature,
  payloadHash,
  sport,
  state,
  events,
}
```

Add `Game.revision`, a unique receipt on `(gameId, sourceConnectionId, sourceEventId)`, per-source last sequence, and one atomic `applyScoreCommand()` used by manual scoring, generic feed, Daktronics, CTS, and future adapters. It must validate tenant/game/signature, source authority/lease, expected revision, monotonicity, and payload hash; then update snapshot, insert immutable `GameEvent`, write audit, register receipt, increment revision, and enqueue the outbound event as one logical operation.

Today several paths update state then insert `GameEvent`, including score adjustment at `apps/api/src/sports/sports.service.ts:1543-1619`; a crash can leave changed state without complete forensic history.

**Acceptance:** concurrent manual and feed commands obey the declared authority; a stale provider cannot overwrite a current console; lease expiry fails over exactly once; provider recovery does not seize control until policy permits; an explicit operator takeover/resume is audited and cannot oscillate; stale/reordered clocks and revisions never roll state backward.

## P1 — auto-celebration idempotency

Auto-celebration is real. Sport definitions contain point mappings and feed/console paths invoke them. Gaps:

- Enablement is cached per process, so replicas can disagree.
- The ten-second duplicate guard is team/time-based, not origin-event-based.
- A legitimate second score in ten seconds can be suppressed.
- Concurrent manual increments can compute the wrong delta and miss a cue.
- Cue behavior is not tied to a durable revision/event ID.

Persist the toggle. Correlate cue intent to the scoring event ID/revision. Enforce unique `(gameId, scoreEventId, cueType)`, generate score state and cue intent in the same transaction, deliver through an outbox, and track player acknowledgement/proof-of-play separately.

**Acceptance:** duplicate, reordered, concurrent, and replayed score commands produce exactly one correct celebration per event across two API replicas.

## P1 — sponsor proof-of-play is not trustworthy

The cue-fired receipt path at `apps/api/src/sports/sports-board.controller.ts:84-140` accepts a known cue ID without device authentication and can return `{ok:true}` even when the recording service drops/fails. The service uses read-before-insert time-window dedupe at `apps/api/src/sports/sports.service.ts:5065-5140`, which is raceable across replicas. A caller who learns a game/cue ID can inflate sponsor evidence.

Replace it with a signed device/player receipt containing `displaySessionId`, `playerId`, `screenId`, `gameId`, `scoreEventId`, `cueIntentId`, media/release hash, `renderedAt`, rendered duration, acknowledgement status, and an idempotency key. Enforce a database unique constraint on the policy-defined cue+screen/session identity. Authenticate/authorize the screen, validate active assignment and release hash, return an error if durable recording fails, and reconcile intended, dispatched, acknowledged, rendered, and failed counts. Preview/manual cues do not count as billable sponsor proof unless the commercial policy explicitly permits it.

**Acceptance:** unauthenticated, wrong-screen, stale-session, replayed, and concurrent receipts cannot increment proof; exactly one durable receipt exists per cue+screen policy key across two replicas; a failed insert is not reported as success; the sponsor report reconciles intended versus acknowledged/rendered playback and exposes missing receipts.

## P1 — incorrect low-score winner handling

Cross-country and golf require low-score semantics. The board has a local exception at `apps/web/src/app/board/[gameId]/page.tsx:247-264`, but API final-cue selection (`apps/api/src/sports/sports.service.ts:3840-3858`) and ribbon final treatment (`apps/web/src/app/ribbon/[gameId]/page.tsx:2655-2715`) still favor the higher score.

Add declarative semantics to `SportDefinition`:

```ts
resultMode: 'higher_wins' | 'lower_wins' | 'ranked_finish' | 'judged'
```

Use it consistently in API cue selection, board, ribbon, scorebug, leaderboards, accessibility text, and postgame summaries.

**Acceptance:** golf low score, cross-country scoring/ties, judged sports, ordinary high-score sports, and no-winner exhibitions all resolve correctly.

## Sport depth required for world-class status

- **Volleyball/pickleball:** durable set/game history, current server, side switching, match point, win-by-two validation.
- **Wrestling:** bout ledger, weight classes, periods/overtime, penalties, result-to-team-score reconciliation.
- **Baseball/softball:** inning line score, balls/strikes/outs, base occupancy, pitcher/batter, R/H/E.
- **Basketball:** team/player fouls, bonus/double bonus, possession, shot clock, timeout inventory.
- **Football:** down, distance, ball-on, possession, play clock, timeout inventory.
- **Hockey/lacrosse/field hockey/water polo:** penalties/ejections, power play, shot/possession clocks as applicable.
- **Track/swimming:** meet/event/heat/lane/entrant model, seed/final, timing import, DQ and record flags.
- **Diving:** judge-count variants, degree of difficulty, dropped scores, round totals, dive order.
- **Cross-country:** finish order, displacement scoring, team totals, tie-break, low-score semantics.
- **Golf:** player/team scorecards, hole/par/to-par, low-score semantics.
- **Gymnastics:** rotation/apparatus scores, team aggregate, start-value/deduction breakdown.
- **Cheer:** rubric categories, judge panels, deductions, routine order, final standings.

## Verification performed

Passing test evidence reported by the sports audit lane:

- Scoreboard CTS package: 5 suites / 88 tests.
- API sports engine/service/timing/stats: 4 suites / 260 tests.
- Web sport parity, LanePad, DivingJudgePad: 3 suites / 88 tests.
- Web no-fake-data and game-binding: 2 suites / 36 tests.

Important limitation: nearly all are synthetic or DOM tests. Legacy CTS uses captured open-repository fixtures, not a current VenueOS venue certification.

Not validated:

- Physical Daktronics/CTS consoles or actual kiosks/LED processors.
- WTTC, USB/RS-232/RS-485 adapters.
- Serial behavior across Safari, Firefox, Chromium, and Android WebView.
- Provider sandboxes/licensed production feeds.
- Multi-replica races/failover.
- Physical viewing-distance readability.

The desktop-browser path conditionally uses `navigator.serial`, so it remains limited to compatible browser/kiosk environments. `CtsBridge` also feature-detects a native `window.EduCmsNative.ctsSerial*` transport and auto-connects `/dev/tty*` devices for the Taurus/Android player at `apps/web/src/components/player/CtsBridge.tsx:102-147,575-903`; that native path exists in code but was not exercised on hardware in this audit. Production support therefore requires a certified Chromium Web Serial matrix and a certified Taurus/Android native-bridge matrix, or a separate local gateway/agent that owns serial communication and emits signed VenueOS envelopes.
