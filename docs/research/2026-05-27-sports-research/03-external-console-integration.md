Confirmed: `CtsBridge.tsx` does not include `shotClock`, exclusions, or timeouts in the POST body (lines 774-782). The local `lastSnapshot` displays the exclusion data in a debug panel, but it's never persisted server-side. Time to write the report.

---

# VenueOS Sports Console Integration — Audit Report (2026-05-27)

## 1. Top 5 P0 integration gaps

**P0-1 — The CTS bridge persists ~40% of what the parser decodes.** The CTS parser emits a full `CtsFullSnapshot` with shot clocks (`homeShotClock`/`awayShotClock`), up to 3 exclusions per team (`homeExclusions`/`awayExclusions`), and timeouts remaining (`homeTimeoutsRemaining`/`awayTimeoutsRemaining`) — `packages/scoreboard-cts/src/parser.ts:292-340`. But the bridge's POST body to the API (`apps/web/src/components/player/CtsBridge.tsx:774-782`) only ships `clockMs, clockRunning, segment, homeScore, awayScore, horn`. Exclusions, per-team shot clocks, and timeouts decoded from CTS modules 0x06, 0x07, 0x08-0x0D, 0x10, 0x11 **never reach `Game.stats.cts`**. They exist only in the in-page WebSocket `GAME_STATE` broadcast (`apps/api/src/screens/screens.controller.ts:1637-1687`), so the `/board /ribbon /scorebug` public surfaces — which read from `applyCtsOverlay` (`apps/web/src/lib/cts-merge.ts:144`) — render zero exclusion / timeout data when fed by CTS. A scoreboard built on the persistent path is missing the penalty box, the per-team shot clocks, and the timeouts pip count.

**P0-2 — AUTO celebrations don't fire on the CTS path.** Server-side `maybeAutoCelebrate` (`apps/api/src/sports/sports.service.ts:2108-2182`) is the central rule for "score delta of 6 → fire touchdown cinematic." It is called from `adjustScore` (line 1220), `setScore` (line 1267), and `ingest({auto:true})` (line 2091) — i.e. the operator path, the typo-fix path, and the Sportzcast/Scorebird `/feed` path. **It is NOT called from `ingestCtsSnapshot`** (lines 2751-2862). CTS-driven celebrations rely on `CtsRibbonWidgets.tsx` line 1401-1419 watching the local WS snapshot delta and firing client-side. Consequences: (a) every viewer with a different network arrival time can briefly see a different celebration sequence; (b) any surface NOT mounting `CtsRibbonWidgets` (the operator-picked custom scoreboard template that just shows score + clock) gets zero celebrations; (c) Greg's "same rules apply" constraint is violated — the operator's +1 button fires a server-routed CUE GameEvent + AuditLog; the CTS console's score increment fires only a client-side visual with no GameEvent / no AuditLog of the auto-fire.

**P0-3 — Game clock running/paused is derived client-side from packet cadence, not from CTS itself.** CTS protocol has no explicit "clock running" bit; `CtsBridge.tsx:765-772` infers it by watching whether the displayed clock string has changed within `CLOCK_PAUSE_MS = 800` ms (`apps/web/src/components/player/CtsBridge.tsx:285`). A console between displayed seconds (1 update/sec at >1:00) takes longer than 800 ms to emit the next packet, so a legitimately-running clock can flip to `clockRunning: false` on the first tick when minutes are high. This propagates to the server, which propagates to `applyCtsOverlay`. The 800 ms threshold was tuned for the last-minute tenths-display (~100 ms cadence), not the whole-second cadence at >1:00. Fix needs a longer threshold at high clock values OR derivation from packet inter-arrival times rather than displayed-string changes.

**P0-4 — Shot clock comes from `Game.stats.cts.shotClock` but the parser doesn't emit it as a structured object.** The board's `applyCtsOverlay` reads `cts.shotClock` (object with `ms/running/len/at` — `cts-merge.ts:167-179`); the API's `cleanCtsSnapshot` accepts it (line 2725-2738); but the bridge's POST body has **no `shotClock` field at all** (`CtsBridge.tsx:774-782`). The parser surfaces `homeShotClock`/`awayShotClock` as raw display strings (e.g. `"24"`), single-team, no per-team mapping in the merge layer. Result: the persistent path's shot-clock branch is **dead code** for CTS. Operator-set shot clock (`POST /games/:id/shot-clock`) works, but the moment CTS goes fresh and overrides via `applyCtsOverlay`, the shot clock disappears from the public surfaces because the overlay path is unreachable.

**P0-5 — No support for any sport beyond water polo on the protocol layer.** `CTS_MODULE` (`packages/scoreboard-cts/src/types.ts:133-149`) hardcodes water-polo module addresses. Basketball CTS consoles, hockey, soccer, swimming meet timers — all use the same physical protocol but different module address tables. Comment line 8: *"Other sports re-use the same physical protocol but expose different module addresses; the Sport Engine (Sprint 13) will eventually carry per-sport CtsGameState variants behind a tagged-union, but for the live install we only need water polo right now."* Per the lead's "every sport in the Sport Engine spec" Standard Audit Surface requirement, this is a P0 not a "later" — a sales call with a basketball-only customer that owns CTS will fail today.

## 2. CTS Gen 6 message matrix

| CTS module addr | Name (water polo) | Parser handles? | API ingest persists? | Public surface renders? | Notes |
|---|---|---|---|---|---|
| 0x01 | GAME_CLOCK | YES `parser.ts:260` | YES `sports.service.ts:2704` | YES `cts-merge.ts:153` | display-string → ms via `parseCtsClockToMs` |
| 0x02 | HOME_SCORE | YES `parser.ts:276` | YES `:2715` | YES `cts-merge.ts:150` | clamped non-neg int |
| 0x03 | AWAY_SCORE | YES `parser.ts:284` | YES `:2719` | YES `cts-merge.ts:151` | clamped non-neg int |
| 0x04 | PERIOD | YES `parser.ts:268` | YES `:2711` (as `segment`) | YES `cts-merge.ts:152` | clamped ≥ 1 |
| 0x06 | HOME_SHOT_CLOCK | YES `parser.ts:292` | **NO** (bridge doesn't ship it) | **NO** | parser yields display string; bridge omits from POST body |
| 0x07 | AWAY_SHOT_CLOCK | YES `parser.ts:300` | **NO** | **NO** | same as above |
| 0x08-0x0A | HOME_EXCL_1/2/3 | YES `parser.ts:308-315` | **NO** | **NO** | bridge omits from POST body |
| 0x0B-0x0D | AWAY_EXCL_1/2/3 | YES `parser.ts:317-325` | **NO** | **NO** | same |
| 0x10 | HOME_TIMEOUTS | YES `parser.ts:326` | **NO** | **NO** | parser updates state but never POSTed |
| 0x11 | AWAY_TIMEOUTS | YES `parser.ts:334` | **NO** | **NO** | same |
| 0x1F | HORN | YES `parser.ts:342` | YES `:2723` | YES (drives celebrations) | one-shot rising-edge |
| 0x1E / time-of-day | aux packets | DROPPED `parser.ts:354` | N/A | N/A | intentional — water polo doesn't use them |
| Period-end / horn-type (long vs short) | — | DROPPED | N/A | N/A | CTS emits horn as a single non-zero byte; we don't distinguish horn type (period-end vs goal vs timeout-end) |
| Possession arrow | — | DROPPED | N/A | N/A | not in CTS_MODULE table; some CTS profiles ship this on 0x12 |
| Sub-timeout / 30 / 60-second timeouts | — | DROPPED | N/A | N/A | water polo TV / sub timeout module not implemented |
| Game-over latch | — | DROPPED | N/A | N/A | CTS has no explicit final-buzzer flag; we infer from `period > def.segment.count` server-side |
| Penalty / foul events (basketball) | — | DROPPED | N/A | N/A | basketball CTS module table not implemented (P0-5) |

**Net: 6 / 15 module addresses fully integrated end-to-end. 4 decoded but dropped before the persistent store. 5 not decoded at all.**

## 3. Same-rules-apply violations

Lead constraint: *"all the same rules apply if we are doing it or the integration is doing it."* The pattern we want is service-layer enforcement so REST + integration both hit the same code. Violations:

- **AUTO celebrations** (P0-2). `maybeAutoCelebrate` lives in the service (good) but is wired into `adjustScore`/`setScore`/`ingest({auto:true})` only. `ingestCtsSnapshot` writes directly to `stats.cts` and never calls it (`sports.service.ts:2826-2829`). Greg's score-delta-fires-celebration rule applies on +1 buttons and on Sportzcast `/feed` but NOT on the CTS bridge path. Severity: high — visible to every customer.

- **`SCORE` GameEvent + AuditLog row.** `adjustScore` writes `SCORE` GameEvent (`:1205`) + AuditLog via `record()`. `ingest({auto:true})` writes `INGEST` GameEvent (`:2083`). `ingestCtsSnapshot` writes neither a `SCORE` event nor an `INGEST` event — only a sampled `CTS_SNAPSHOT_INGEST` AuditLog (`:2837-2854`). Forensic gap: a customer asking "show me every score change during this game" will see all operator changes + Sportzcast pushes but ZERO CTS-driven scores. (The audit log sampling cap is also looser — `wantsAudit` only fires on transitions, lines 2818-2820, so even there the score-event trail is sparse.)

- **Game-clock auto-advance.** `autoAdvanceExpiredClocks` (line 1771) reads `Game.clockRunning` + `Game.clockMs` — i.e. the OPERATOR INPUT columns. CTS-driven clock state lives in `Game.stats.cts.clockMs` and is NEVER written back to those columns (deliberate design — see comment at line 2670-2675). Consequence: when CTS is the source of truth, the segment auto-roller is reading a stale operator anchor. If the operator had paused the clock manually before CTS came online, then CTS reaches 0:00 in Q1, the segment never auto-advances to Q2. This is partly intentional (operator can take over when CTS fails) but partly broken (the "auto" rollover is silently dead during CTS-fresh windows).

- **Penalty-box clock sync.** `clockAction` calls `syncPenaltiesToClock` (`:1339`) so an operator pausing the game clock freezes every penalty timer. CTS-driven clock state changes don't trigger this — there's no `syncPenaltiesToClock` invocation in `ingestCtsSnapshot`. A hockey/lacrosse install with CTS-driven clock + operator-set penalties would see penalties continue counting while CTS pauses the game clock.

- **Shot-clock-to-game-clock sync.** `syncShotClockToGameClock` (`:1565`) just landed today (commit `bf7cf2d` per the prompt) and is the example Greg used. Like penalties, it's invoked only from `clockAction`, never from `ingestCtsSnapshot`. CTS pausing the game clock does not pause an operator-configured shot clock.

- **Cue dedup / cooldown.** Client-side celebration firing has a 2 s `CUE_COOLDOWN_MS` (`CtsRibbonWidgets.tsx:1355`). Server-side `maybeAutoCelebrate` has no cooldown. A bounce on Sportzcast pushing the same delta twice fires two server-side celebrations; the equivalent CTS flap on the client de-dupes. Same input, different output.

- **`fireCue` cross-tenant guard.** `ctsManualCue` (`screens.controller.ts:1721-1770`) does its own ownership check against `Screen`. `fireCue` (`sports.service.ts:2343`) does it via `this.owned()` against `Game`. The two paths are not symmetric: a manual cue fired via the screen-path doesn't write a `CUE` GameEvent, so it doesn't appear in the game's cue feed or replay timeline.

- **Score floor at 0.** `adjustScore` re-reads + clamps a `< 0` race result (`:1191-1204`). `ingestCtsSnapshot` clamps inputs at parse time (`nonNegInt`) but does NOT verify post-write consistency or guard against concurrent-update interference with operator inputs. (Operator inputs are in different columns, so it's safe — but the asymmetry exists.)

## 4. Other systems readiness scorecard

| System | State | Notes |
|---|---|---|
| **CTS Gen 6 (water polo)** | **PARTIAL** | Bridge + parser + persistent ingest path + render-time overlay all wired (above caveats). Stream Deck text-line path landed today (`CtsBridge.tsx:228-249`). Five module types decoded but not persisted (P0-1). EP6N dual-RS232 wiring landed today (`CtsBridge.tsx:154-157, 583-603`). Real install spec at `docs/EP6N_CTS_CABLE.md` and `docs/ECBOX3576_CTS_SETUP.md`. |
| **CTS Gen 6 (basketball / hockey / soccer / swim meet)** | **NOT-STARTED** | Module-address tables hardcoded to water polo (`types.ts:133-149`). Sport Engine's per-sport `SportDefinition` exists in `@cms/api-types` but no per-sport CTS profile binding. |
| **Daktronics All Sport** | **NOT-STARTED** | UI placeholder only — Wiring Panel ships `rs485: 'daktronics'` dropdown (`WiringPanel.tsx:72`); `RS485_OPTIONS` exists. Health controller marks COMING_SOON (`integrations-health.controller.ts:806-813`). NO parser, NO module table, NO ingest endpoint. Daktronics RTD (Real-Time Data) is 19200 8-N-1 ASCII over RS485 (or RS232) with start-byte `0x16` framing and Vladimir Karpov's published reverse-engineering — distinct from CTS bit-oriented protocol. SerialPortBridge.kt acknowledges the gap at line 201. **Customer-facing risk: every K-12 / HS-NCAA scoring customer probably already owns one of these.** |
| **Sportzcast / Scorebird** | **PARTIAL** | The generic `/feed` endpoint (`sports-board.controller.ts:163`) accepts the 5 fields Sportzcast/Scorebird boxes can push (`homeScore, awayScore, clockMs, clockRunning, segment`). NO vendor-specific adapter; the operator has to know to PUT JSON in our schema. No turnkey "paste your Scorebird device id and connect" UI. |
| **ScoreVision** | **NOT-STARTED** | Sprint 13 doc references it as a competitor only. No integration. ScoreVision is a closed system (their software + their hardware); there's no public API to pull from. Realistic strategy is converting customers OFF ScoreVision, not feeding from it. |
| **Genius Sports / Sportradar** | **NOT-STARTED** | Health marks COMING_SOON (`integrations-health.controller.ts:824`). Both are commercial league push feeds (token + REST/SSE). No client, no schema, no ingest endpoint. CLAUDE.md correctly flags 20-30 s lag — would need a 2-clock policy enforced at ingest (clock from CTS, stats from feed). |
| **NCAA live stats** | **NOT-STARTED** | Referenced in copy only (`sports/[gameId]/page.tsx:2478` for lacrosse shot-clock reset doc). No ingest. |
| **NFHS Network broadcast overlay** | **PARTIAL** | Hardware spec calls out the EP6N's HDMI IN for NFHS broadcast capture (`packages/api-types/src/hardware.ts:232`). No software path. The broadcast overlay rendering itself (scorebug as transparent overlay) is doc-only in Sprint 13 "God-tier" section. |
| **Nevco** | **NOT-STARTED** | Wiring Panel has the dropdown (`WiringPanel.tsx:73`). Nothing behind it. |
| **Daktronics All Sport 5000 console (over RS232)** | **NOT-STARTED** | Same protocol as RS485 variant minus the differential pair; could share an adapter. |

## 5. Recommended next 10 commits

1. **Add `shotClock` + `exclusions` + `timeouts` to bridge POST body** (small). `CtsBridge.tsx:774` extend the `body` literal with `shotClock: { ms, running, len }` derived from `snap.homeShotClock` (parser issue: today's parser yields a string per side; promote to per-side `{ms,running}` first OR push a chosen-side string + len). Lights up the persistent path's existing overlay branch.
2. **Wire `maybeAutoCelebrate` into `ingestCtsSnapshot`** (small). `sports.service.ts:2826`, mirror the `ingest({auto:true})` block: snapshot `prev = { homeScore, awayScore }` from `prevCts`, after write call `maybeAutoCelebrate(gameId, prev, derivedNext, { homeScore, awayScore }, { source: 'feed' })`. Removes the client/server celebration divergence and gives CTS-driven cues the AuditLog + GameEvent paper trail.
3. **Promote shot-clock parser output to per-side `{ms, running, at}` objects** (medium). `packages/scoreboard-cts/src/parser.ts:292-307`. Today it yields a display string `"24"`; promote to `{ ms: 24000, running: derived-from-changed-this-emit }`. Updates `CtsFullSnapshot` shape (breaking — bump the package version), bridge body, and overlay shape simultaneously.
4. **Use packet cadence not display-string mutation for `clockRunning`** (small). `CtsBridge.tsx:765-772`. Track `lastPacketAt` for module 0x01 and treat any sustained gap > inter-tick * 1.5 as paused; tighter at sub-minute, looser at whole-second. Fixes P0-3 false-pauses.
5. **Add Daktronics RTD parser + ingest endpoint** (large). New package `packages/scoreboard-daktronics`. Karpov's spec is published; protocol is ASCII start-byte-framed; add `rs485 === 'daktronics'` routing in `CtsBridge.tsx`'s `routeBytes`. Reuse `SportsService.ingestCtsSnapshot` (rename to `ingestExternalSnapshot`?) since the shape is identical. Single-handedly opens the K-12 + college market.
6. **Per-sport CTS module-address tables** (medium). `packages/scoreboard-cts/src/types.ts` swap `CTS_MODULE` constant for a `function sportModuleTable(sportKey: SportKey): CtsModuleTable`. Add basketball table (game clock 0x01, shot clock 0x06/0x07 single-side, fouls modules, possession arrow). Wire `Game.sport` → bridge → parser instance.
7. **Bidirectional sync: post operator scores back to writable consoles** (medium). Daktronics All Sport accepts inputs; CTS Gen 6 does not. Add a `consoleWritable: bool` flag on the wiring config; when true and `adjustScore` fires, fan out a `Send Score` packet over RS485 OUT (`apps/api/src/sports/console-writer.service.ts` new). Without this, operator + console fight each other.
8. **Wire `syncShotClockToGameClock` + `syncPenaltiesToClock` into CTS clock-state changes** (medium). `sports.service.ts:2826`: when `cleaned.clockRunning !== prevCts.clockRunning`, replay both syncs against the new `running` value. Brings the "same rules apply" constraint to the CTS path.
9. **Idempotency keys on integration-sourced events** (small). Today multiple bridges or a retry burst can produce duplicate INGEST/SCORE events. Add `idempotencyKey: string` on the POST body (bridge derives from `snap.receivedAt + score + clock`) and dedupe at the service layer for 60 s.
10. **Cue dedup at the server layer** (small). Move the client-side `CUE_COOLDOWN_MS` window into `maybeAutoCelebrate` so all paths share the rule. Per-gameId, per-cueKey in-memory map gated to 2 s, same shape as the existing `autoCelebrateCache`.

---

Key file paths for follow-up:
- `/Users/gschiemann/Desktop/EDU CMS/packages/scoreboard-cts/src/types.ts`
- `/Users/gschiemann/Desktop/EDU CMS/packages/scoreboard-cts/src/parser.ts`
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/components/player/CtsBridge.tsx` (1404 lines)
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/sports/sports.service.ts` (2864 lines — esp. `ingestCtsSnapshot` at 2751, `maybeAutoCelebrate` at 2108, `adjustScore` at 1161)
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/sports/sports-board.controller.ts`
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/screens/screens.controller.ts` (CTS endpoints at 1637 + 1713)
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/lib/cts-merge.ts`
- `/Users/gschiemann/Desktop/EDU CMS/apps/player/app/src/main/java/com/educms/player/serial/SerialPortBridge.kt`
- `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/screens/[screenId]/WiringPanel.tsx`
- `/Users/gschiemann/Desktop/EDU CMS/apps/api/src/health/integrations-health.controller.ts` (line 781 — sports probe with COMING_SOON markers for Daktronics/Sportzcast/Genius/MaxPreps/GameChanger)
