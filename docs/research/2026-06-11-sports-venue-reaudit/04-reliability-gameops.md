# Sports Venue Re-Audit 04 — RELIABILITY + GAME-NIGHT OPS (2026-06-11)

**Scope:** Standard Audit Surface §6/§7 reliability slices + §15/§19/§20 lenses, for the first live
customer (water polo, CTS WTTC-1 → Goodview EP6N/ECBox → LED ribbon). Question: *does this survive a
packed natatorium?*

**Dedup:** Verified against `2026-06-11-wttc-gen7-buildout/00-VERIFIED-STATE.md` and
`2026-06-04-waterpolo-cues/`. The Gen7/WA-2 decode gap, wrong legacy framing, and F872 channel map are
KNOWN + in-flight (commit `0f075bcf` adds `packages/scoreboard-cts/src/{grid,classic,gen7}.ts`, not yet
wired into CtsBridge — planned, NOT re-reported here). The findings below are NEW or newly-verified.

**Verification run:** `pnpm --filter @cms/scoreboard-cts test` → **54/54 pass** (4 suites, incl.
`__tests__/real-wire.test.ts` against the real captures) — the new decode layer is real, tested code.

---

## Coverage table (this report's areas)

| Area | Coverage | DESIGN | UX | FUNCTIONALITY |
|---|---|---|---|---|
| SurfaceHealthPills + heartbeat | covered | A- | B | **D** |
| Player offline mid-game (poll tier) | covered | B | B+ | B+ |
| Feed staleness on board/ribbon | covered | B | **D** | **D** |
| CtsBridge reconnect / serial unplug | covered | B | C+ | C+ (native B / Web Serial D) |
| Undo / GameEvent durability | covered | B+ | B+ | A- |
| Horn / cue dedup (#133) | covered | B | B | B- |
| Auto-celebration on score delta (#127) | covered | B | B | **F on CTS path** |
| API blip during a goal | covered | B | C | C+ |
| Dress-rehearsal / practice mode | covered | B | B | B- |

---

## 1. SurfaceHealthPills — what actually feeds them

`apps/web/src/app/[schoolId]/sports/[gameId]/SurfaceHealthPills.tsx` is a genuinely well-designed
component (color-blind-safe symbol+dot pairs, click → live `SurfacePreview` drawer, Esc dismiss).
But trace the data:

- Pills ← `useGameScreens()` (10 s poll) ← `GET /sports/games/:id/screens` ←
  `SportsService.listGameScreens` (`sports.service.ts:924-975`) which selects the **raw
  `Screen.status` column** plus `activeBoardGameId`/`activeBoardSurface`.
- `status` only flips to OFFLINE via the **offline-screen-scanner**
  (`apps/api/src/notifications/offline-screen-scanner.ts:13-14`): scan every **60 s**, threshold
  **silent > 5 min**. The screens controller derives a 2-min staleness at read time for *its own*
  endpoints (`screens.controller.ts:2486`) — `listGameScreens` does **not**.
- `showing` = `activeBoardGameId === gameId` — that is **intent** (what the console pushed), not
  proof of render. There is no per-surface render heartbeat: the board page's 750 ms
  `/sports/board/:id` poll is anonymous and memoized server-side, so the API cannot attribute it to
  a screen.

**Net:** a board that goes dark is GREEN in the console for **~5-7 minutes** (5-min threshold +
60 s scan + 10 s poll). A board whose webview wedges while the Android shell keeps pinging is GREEN
**forever**. "On air · Scoreboard" is a statement of intent wearing a health-pill costume.

**Fix (P1):** (a) derive freshness from `lastPingAt` in `listGameScreens` with a sports-tight window
(≤60 s), like the screens controller already does; (b) longer-term, count the board's own poll as the
heartbeat — add `?screenId=` to the board URL the manifest builds and track last-poll-at per screen
(the synthetic-manifest builder at `screens.controller.ts:2882+` already knows the screen id).

## 2. Player offline behavior mid-game — the real message tier

For the paired-kiosk path (the first customer's path) the data tier is: manifest
(`screens.controller.ts:2875-2905` — emergency-preceded synthetic scoreboard manifest) → public
`/board/[gameId]` / `/ribbon/[gameId]` page → **750 ms HTTP poll** (`board/[gameId]/page.tsx:149,2359`;
`GameStateContext.tsx:60` for template-driven boards). The 750 ms claim is real and **WS is not in
the loop at all** for game data on these surfaces — `GAME_STATE` WS messages
(`player/page.tsx:3981`) are only the legacy unbound-bridge fan-out. So a WS drop is a non-event:
the surfaces never depended on it. Good architecture for a gym.

On API blip: board renders the error screen **only before first data** (`if (error && !data)`,
board page:2451); mid-game failures keep the last snapshot and the clock keeps projecting locally
from the anchor. Poll keeps retrying at constant 750 ms (fast recovery). Two gaps, both acceptable
but worth knowing: (a) **no staleness badge** — a 10-minute API outage shows a confidently
ticking board with no "live data interrupted" hint; (b) if the operator *stopped* the clock during
the outage, surfaces keep ticking from the old running anchor until the API returns.

## 3. Feed staleness on board/ribbon — **the thing that breaks first**

The design (`apps/web/src/lib/cts-merge.ts`, `CTS_FRESH_MS = 5000`): CTS overlay wins while
`stats.cts.lastUpdateAt` is within 5 s of `serverTime`; stale → surfaces render the **operator-input
columns**. By design, `ingestCtsSnapshot` **never writes the operator columns**
(`sports.service.ts:4047-4050` writes `stats` only; the comment block at 3705-3726 calls this
load-bearing), and `CtsBridge` POSTs **only** `/cts-snapshot` (`CtsBridge.tsx:954,1106`) — never
`/feed` (which is the path that does write operator columns, `ingestByFeed`).

**Consequence (P0):** in a CTS-driven game the operator columns sit at pre-game values (0-0, 8:00).
Five seconds after the serial feed hiccups — cable wiggle, console power-cycle, bridge tab reload,
ECBox kernel burp — **every surface in the natatorium reverts from the true score (e.g. 8-5, Q3
2:14) to 0-0 / 8:00**. That is the falsehood case: the board lies to the crowd, automatically, and
stays lying until a human re-keys the whole game state. The console *does* show "CTS stale — using
operator inputs" (`computeCtsStatus`, console page:4467) — but there is **no one-tap "adopt last CTS
values"**; the operator must notice the pill, open Run mode, and re-enter score/segment/clock by
hand mid-crisis while the crowd watches 0-0. (Side wart, P3: the console pill calls
`computeCtsStatus(stats, Date.now())` with the *client* clock; cts-merge.ts:116 explicitly says to
pass serverTime to avoid skewed lies.)

**Fix options (either kills the P0):** on the fresh→stale transition (server-side, where
`lastUpdateAt` ages out), copy the last CTS values into the operator columns once; or make the
overlay sticky-last-known (stale CTS still beats *older* operator values, with an explicit operator
mutation clearing the stickiness). The second preserves "operator takeover wins" exactly.

## 4. CtsBridge reconnect / serial unplug mid-game

- **Native ECBox path (the customer's path): OK.** 5 s status tick; `open:false` → status
  `disconnected` → reconnect attempt after 2 s (`CtsBridge.tsx:799-834`). No exponential backoff /
  max attempts — fine for a venue appliance.
- **Web Serial path (laptop/Pi rehearsals, office dress runs): NO mid-game reconnect.** The
  `disconnect` listener only sets status (`CtsBridge.tsx:1235-1247`); auto-reconnect runs **only on
  mount** via `getPorts()` (`:1257-1293`). Unplug/replug mid-game = bridge dead until someone
  physically reaches the kiosk UI or reloads the page. Combined with §3, a 1-second USB wiggle turns
  into "board shows 0-0 until a human climbs to the kiosk." **P1:** while `status === 'disconnected'`,
  poll `getPorts()` every ~5 s and re-`openAndRun` (mirrors the native loop).
- POST failure handling: snapshots are full-state and fire-and-forget (`flushPost` catch →
  `postLastStatus`, `:967-969`); the next snapshot self-heals. Correct choice — no retry storm.
- **Rate-limit mismatch (P2):** bridge throttle is **200 ms → 5 Hz sustained**
  (`POST_THROTTLE_MS = 200`, `CtsBridge.tsx:204`) but the cts-snapshot pool allows **40/10 s = 4 Hz**
  (`sports-board.controller.ts:34-35`). With a running clock the bridge sends ~50/10 s, so the tail
  ~10 POSTs of every window get 429. Self-healing (full-state) so freshness never exceeds ~2 s, but
  it spams 429s into `postLastStatus` (operator-visible during bring-up — looks broken when it
  isn't) and into logs. Bump pool to 60/10 s or throttle to 300 ms.

## 5. Undo / event-log durability — solid

Server-backed `GameEvent` rows (`schema.prisma:2146-2157`, indexed `gameId, createdAt`), survive
console reloads/device swaps by construction. Rail order is deterministic (`createdAt desc, id desc`
tiebreak — `sports.service.ts:4137-4151`). Undo synthesizes the inverse **through the same PATCH
paths** (validation + board-cache invalidation + auditability preserved), guards
auto-advance/undo-of-undo/CUE, and 422s with `BUG_NOT_UNDOABLE` + a human reason when prev-state is
missing (`:4193-4301`). The undo itself is recorded (`UNDO_*` + `undoOf`). This is what the rest of
the reliability surface should look like.

**Wart (P2):** CTS-sourced SCORE events (`{team:'cts', homeScore, awayScore, source:'cts'}`,
written at `:4070-4075`) pass the `undoable` predicate (type SCORE, no `auto` flag, `:4152-4164`)
so the rail offers Undo on them — tapping it always 422s ("lacks prev-state"). Mark `source:'cts'`
non-undoable (or capture `prevScores`, which the ingest already has in hand).

## 6. Horn / cue dedup (#133)

- `POST /sports/board/:id/cts-cue-fired` → `recordCueFired` writes `CTS_CUE` GameEvents with **no
  server-side dedup** (`sports.service.ts:3674-3703`) — by design (forensic log), rate-limited
  16 Hz/game. Real dedup is client-side and verified: board dedupes by event id (`seenCues`) plus a
  **6 s key+team signature window** that specifically kills the auto+manual double of one scoring
  moment (`board/[gameId]/page.tsx:2330-2351`). First-poll cues are marked seen but not replayed —
  a power-cycled board never replays old cinematics (`:2333-2336`). Good.
- **Horn reality check:** horn flash/celebration on the *kiosk that runs the bridge* keys off the
  local feed's rising edge (`CtsRibbonWidgets.tsx:1066`, `lastHornRef`) — robust. But (a) the 200 ms
  POST throttle's last-writer-wins `pendingSnapshotRef` (`CtsBridge.tsx:996-1013`) can swallow the
  **150 ms horn pulse** before it ever POSTs (horn ON replaced by horn OFF inside the window — phase
  dependent), and (b) `applyCtsOverlay` **never maps `horn`** (cts-merge.ts:170-263), so a board or
  ribbon on a *different* device never renders the CTS horn at all. Server-side, `horn` only
  influences audit sampling (`:3938-3944`). **P2:** latch horn in the bridge until it has been
  POSTed once; decide whether remote surfaces should render horn (overlay field + board effect).

## 7. Auto-celebration on score delta (#127) — **dead after the first goal on the CTS path**

Trace: CTS snapshot `scoreChanged` (vs prior **CTS** values — correct guard against 5 Hz re-fires)
→ `maybeAutoCelebrate(prevScores, syntheticNext, …)` (`sports.service.ts:4060-4084`). But
`prevScores = { game.homeScore, game.awayScore }` — the **operator columns** (`:3966`), which the
CTS path never updates (§3). So the computed delta is `ctsScore − operatorScore`:

- Goal 1: CTS 1, operator 0 → delta 1 → water polo `goal.autoPoints=[1]`
  (`packages/api-types/src/sports.ts` WATER_POLO celebrations) → fires. ✓
- Goal 2: CTS 2, operator still 0 → delta 2 → no autoPoints match → **silent no-fire**. ✗
- Every later goal: delta 3, 4, 5… → **never fires again for the rest of the game.**

Manual console taps and the `/feed` path are correct (they mutate operator columns, so delta=1).
The 2026-06-04 cue audit reviewed this function for scorer attribution but not this delta source —
this is a new finding. Double-fire protection (operator taps +1 while CTS reports the same goal) is
handled by the board's 6 s key+team window (§6) — adequate.

**Fix:** inside `ingestCtsSnapshot`, compute the delta from `prevCts.homeScore/awayScore`
(fall back to operator columns only when prevCts has no score yet). One-line-class fix; also fixes
the analogous SCORE GameEvent semantics. Note this same fix becomes load-bearing for whichever path
the rebuilt decode layer (0f075bcf) gets wired into.

## 8. API blip during a goal — operator console

`ctl.score.mutate({ team, delta })` is fire-and-forget: `useGameControl`'s mutations have **no
`onError`, no optimistic update, no toast** (`use-api.ts:2636-2666`; call sites console
page:291-308, 1085-1096, 1629, 1740). On a venue-Wi-Fi blip the tap is **silently lost** — the
score chip simply doesn't move, with zero feedback; keyboard-shortcut taps (T2-2) are even easier
to miss. There's no false state (no optimistic write to roll back) and the ~refetch loop reflects
truth, so this is a C+, not an F — but a packed-gym operator will double-tap and over-score, or
under-score and not notice. **P2:** add a shared `onError` → red toast ("Score didn't save — check
connection") + a subtle pending state on the chips.

## 9. Dress-rehearsal readiness

There IS a real practice mode and it is operator-reachable: the **"▶ Play sample game"** button in
the CtsBridge panel (shows when no console is connected on a CTS profile, `CtsBridge.tsx:1585-1620`)
runs `REHEARSAL_SCRIPT` (`packages/scoreboard-cts/src/mock.ts:221-246` — compressed 30 s, 4 quarters,
goals both sides, 3 exclusions incl. double-slot, timeout, horns, sub-minute tenths clock) as **real
encoded bytes through the same parser → same POST → same API → same 750 ms board/ribbon poll →
same render**. That exercises the real pipeline end-to-end *except* the serial transport and the
real console framing. `super/cts-simulator` is SUPER_ADMIN-only — fine, the bridge button is the
operator path.

Honest caveats for the day-before run:
1. It validates the **show flow**, not the **console connection** — the script feeds our own
   `encodePacket`, i.e. the self-consistent legacy framing the VERIFIED-STATE doc already flagged.
   Until the 0f075bcf decode layer is wired + a live capture decoded, the only true console test is
   the console itself (the planned capture mode is the right answer — keep it in scope).
2. 30 s compressed = no soak. Nothing rehearses 90 minutes of running clock — which is exactly the
   regime that trips the 429 shave (§4) and the staleness fallback (§3). Add a `?loop` or a 15-min
   variant before game day.
3. The rehearsal should deliberately include **pulling the plug**: with §3 unfixed, the operator
   will watch the board snap to 0-0 five seconds after stopping the sample — better they learn the
   manual-takeover dance (and we fix it) in an empty pool.

## What breaks first on game night — ranked

1. **Serial/bridge hiccup → boards revert to 0-0 within 5 s** (§3). Highest probability × highest
   embarrassment; recovery is manual re-keying. P0.
2. **Auto-celebrations die after goal #1** (§7). The marquee show feature silently stops; nobody
   gets an error. P1 (P0 if the customer was sold "goals auto-celebrate").
3. **Web Serial unplug never reconnects** (§4) — only if game-day runs the Web Serial path; native
   ECBox path is covered. P1.
4. **Dead/wedged board stays green for 5-7 min (or forever)** in SurfaceHealthPills (§1) — the
   operator's single pane of glass over-promises. P1.
5. **Silent lost score taps on Wi-Fi blips** (§8). P2.
6. **5 Hz bridge vs 4 Hz rate limit → 429 bursts** during running clock (§4). P2.
7. **Horn pulse swallowed by POST throttle / never rendered on remote surfaces** (§6). P2.
8. Multi-replica: `feedHits`, `boardCache`, `autoCelebrateCache`, clock-advance + offline-scanner
   overlap guards are all per-process — fine on single-replica Railway today, revisit before
   scaling out. P3.

## What's genuinely solid (verified, not vibes)

- 750 ms HTTP poll as the sports data tier — no WS dependence on game surfaces; last-known render
  on failure; error screen only pre-first-data (`board page:2451`).
- Server-backed undo rail end-to-end (writes, deterministic order, inverse-via-PATCH, 422 honesty).
- Cue feed replay protection + auto/manual 6 s dedup on the board.
- CTS ingest hygiene: empty-snapshot drop (won't mask an outage by bumping `lastUpdateAt`,
  `sports.service.ts:3885-3906`), audit sampling on forensic transitions, board-cache invalidation.
- Feed-token revocation via `feedTokenVersion`, rate-limit-before-auth ordering on public ingest.
- Native ECBox serial auto-reconnect loop.
- `@cms/scoreboard-cts` 54/54 tests green incl. real-wire fixtures (the new decode layer is real;
  wiring it is the known next step).
- Operator-reachable one-button rehearsal that traverses the real parser→API→render pipeline.
