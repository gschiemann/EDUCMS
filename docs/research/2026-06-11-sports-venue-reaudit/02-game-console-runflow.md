# Game-Night Console + Run Flow — Sports Venue Re-Audit (2026-06-11)

**Auditor scope:** the operator's 2-hour surface — `apps/web/src/app/[schoolId]/sports/page.tsx` (games list + create, 664 ln), `apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx` (console, 5,292 ln) + its 9 panels, and the server run-flow handlers in `apps/api/src/sports/sports.service.ts`.
**Method:** full code read of both pages + all panels; grep-traced every safeguard to real callers; ran `pnpm --filter api exec jest sports.service.spec` → **109/109 green** (score clamp, auto-celebrate, segment resets, undo, timeout guard verified against reality).
**Dedup:** verified against 2026-06-04 waterpolo-cues + 2026-06-11 wttc-gen7-buildout/00-VERIFIED-STATE. The 06-04 cue→pick-player→fire flow is **still wired** (no regression). The serial decode layer (commit 0f075bcf) is out of scope here per assignment.

## Coverage table (Standard Audit Surface slices)

| Area | Coverage | D | UX | F |
|---|---|---|---|---|
| §7 Sports — game create flow | covered | A- | A | A- |
| §7 Sports — pre-game setup (roster/sponsors/ribbon/lineup T2-4) | covered | A- | B+ | A- |
| §7 Sports — live controls (score/clock/shot/timeout/segment) | covered | A | B+ | A- |
| §7 Sports — **water polo exclusion entry** | covered | B | **F** | **D** |
| §7 Sports — cue firing + scorer picker (06-04) | covered | B+ | A- | B |
| §7 Sports — multi-role views T2-3 (?view=score/show/pa) | covered | A- | B+ | B |
| §7 Sports — keyboard shortcuts T2-2 | covered | A | A- | B+ |
| §7 Sports — undo rail T1-2 | covered | B+ | B- | A- |
| §7 Sports — period transitions + auto-resets T2-10 | covered | A | A | A |
| §7 Sports — post-game (FINAL/duplicate) | covered | B+ | B+ | A- |
| §6 Streaming — stream-overlay URL / scorebug copy (console slice) | covered (light) | B | B+ | B |
| §15 Taurus/cross-browser (console slice) | covered | — | — | A (dashboard-only surface; longhand rules followed anyway) |
| §19 Editability (layout pickers slice) | covered | B+ | B (create modal) / A- (setup) | B+ |
| §20 Lenses | applied to every row above | | | |

**Overall grades: DESIGN A- · UX C+ · FUNCTIONALITY B-.** The console *looks* like a $$$ product and the happy paths are genuinely fast — but the water polo exclusion lifecycle (the first customer's defining mechanic) is broken in two places, and every goal risks a double cinematic.

---

## Operator lifecycle walk (by code)

### 1. Create a game — PASSES the 30-second gate
`sports/page.tsx` → "New game" → modal (`CreateGameModal`):
- Sport tile grid (water polo present, `SPORTS[0]` default is football — one extra tap for WP).
- **Home team remembered** per tenant in localStorage (name + color + logo, `HOME_TEAM_KEY`, lines 231–245) with "✓ remembered · clear".
- Away team typed; **branding scraper** ("Team website — pull logo + colors", `useScrapeBranding`) or AssetPicker or URL paste; 8-color palette row.
- Optional per-surface layout pickers; "Create & control" lands the operator directly in the console (line 320).
- **Duplicate** (games list, line 78–89) clones a finished game's whole presentation into a fresh SCHEDULED game → console. The "build one, run a week off it" path works.

Repeat game = pick sport, type opponent, Create. ~4 interactions, well under 30s. Defaults are sensible for WP: 8:00 quarters, 30/20 shot clock, `createGame` seeds timeouts at max (sports.service.ts:649–652 — no NaN path; verified by spec).

Gaps: the modal's three template dropdowns are **unfiltered** (every template, no aspect filter, no suggestion) — see P2-1; **no date/time field**, and list cards show no date — six duplicated "Home vs Away" cards are indistinguishable (P3-3).

### 2. Pre-game (Setup mode) — solid
Six sections (page.tsx:622–895), all wired:
1. **Game basics** — status pills; FINAL is a `HoldChip` (hold-to-confirm, T1-3 verified at 4318–4429: 800 ms, pointer capture, SR live region, keyboard hold).
2. **Teams & roster** — `RosterPanel`: add/edit/photo (hardened upload chain), **CSV template download + import** with count feedback.
3. **Pregame intro (T2-4)** — `PregameIntroPanel` → `ctl.firePregameIntro` per team + optional audio URL + `?intro=home|away` mount trigger. Wired. (Edge: the `?intro=` param re-fires on every re-entry into Setup while the param is in the URL — P3-4.)
4. **Displays** — `ScreenPushPanel` (per-screen Scoreboard/Ribbon/Off, **take-over confirm** when another game owns the screen — two-operator safety, 4683–4697), `LayoutsPanel` (aspect/category-filtered dropdowns, **one-click "Use CTS Water Polo Ribbon"** suggestion, amber "your Ribbon is on Default" call-out — the 2026-05-26 trap is fixed HERE), `SurfacePreview` live iframes.
5. **Ribbon** — presets switchboard (auto-save), custom messages (30-line cap), full-bleed image slides (auto-save, 20 cap).
6. **Show settings** — celebration pack (v2 default), sound + sponsor co-brand, shot-clock length (0/20/30 with hints), `CtsConsoleStatus` pill (1 Hz, same `computeCtsStatus` as public surfaces — pill and board can't disagree), external feed credentials copy.

### 3. Live game (Run mode)
- **Interactive scoreboard** (1587–1931): per-team tile (logo, name, big score, `+1`/`−1` chips), clock tile (segment ± as HoldChips, big MM:SS, Start/Stop, reset HoldChip, ±1s nudge), `RunShotClockMini` (30/20 resets, start/stop, independent 200 ms ticker — bug 97f54357 fix intact), per-team stat rows (Shots / **Exclusions count** / Timeouts with T.O. chip disabled at 0).
- **Timeout (T1-4)** — `callTimeout` verified atomic server-side (3229–3310): guard at 0 (`BUG_NO_TIMEOUTS_LEFT`), pause clock (syncs shot clock + penalty anchors), decrement, TIMEOUT GameEvent + "TIMEOUT — X (n left)" CUE + AuditLog.
- **Undo (T1-2)** — `RecentEventsBar` polls 2 s, per-row Undo; server restore verified for SCORE (inverse delta or prev snapshot), CLOCK, SEGMENT, STAT (oldValues) at 4193–4300. CUE/PENALTY/TIMEOUT intentionally not undoable.
- **Cues + scorer picker (06-04)** — `RunInlineCuesBar` (2440–2615): name-cues pop `CueScorerPicker` (big tiles, spotlit player pre-highlighted, "⚡ Fire now — no player" escape), fires with `scorerName/Number/PhotoUrl/Id`; Send-to chip All/Board/Ribbon with 2.5 s ribbon-strip hint (T2-6). **Verified intact.** `PlayerActionMenu` (roster-tile tap) also fires attributed cues.
- **Keyboard (T2-2)** — Space/h/a/Shift/u/r/t/T/1-9/? with editable-element + Cmd/Ctrl guards, cheat-sheet modal with dynamic cue rows. Run-mode-gated.
- **Multi-role (T2-3)** — view pills + `?view=` synced via `router.replace`; `score` hides cues/roster/ribbon; `show` = surface thumbnails + always-on `CueLaunchpad` + spotlight bar, no score/clock controls; `pa` = read-only score/clock + one-tap spotlight only. Structure verified (1101–1226).
- **Surface health (T1-6)** — `SurfaceHealthPills`: 5 states, color-blind-safe symbol+dot, click → drawer with live preview. Verified.
- **Period transitions (T2-10)** — `setSegment` (2027–2110) resets clock to segment start + **stops it**, applies `segmentReset` rules (WP: shot clock re-anchored to full, clamped to game clock; timeouts preserved), football play-clock 40 s; all spec-covered.

### 4. Post-game
FINAL via hold-to-confirm only (Setup) → `setStatus` stops clock, sets `endedAt`, fires `status:final-home/away/tie` cinematic (T1-5 verified, 2815–2900). Duplicate from the list starts the next week. No score-sheet export (P3).

---

## Findings

### P0-1 — PlayerActionMenu "Exclusion :20" WIPES every penalty already in the box
`page.tsx:2288–2308`: `onPenalty` reads `(ctl as any)._game?.stats` — **`_game` is never set anywhere** (`grep -n "_game" apps/web/src/hooks/use-api.ts` → zero matches; `useGameControl` at use-api.ts:2636 returns only mutations). So `current` is always `[]` and `ctl.stats.mutate({ stats: { penalties: [onlyTheNewOne] } })` **replaces the whole array**. Water polo routinely has two players excluded at once; recording the second exclusion erases the first from the board and console. The correct server path already exists and is verified (`setPenalties action:'add'` re-anchors + prunes — sports.service.ts:1940+, used by `PenaltyBoxControl`).
**Fix (small):** replace the body of `onPenalty` with `ctl.penalties.mutate({ action: 'add', team, lenSec: pb.presets[0].sec, label: pb.presets[0].label, player: player.number ? String(player.number) : playerName })`.

### P0-2 — The penalty-box manager (and 2 other popups) is UNREACHABLE: no Release, no box list, no Misconduct
`onShowCues` / `onHighlights` / `onPenalties` are passed into `RunMode` (page.tsx:572–574) but **never invoked anywhere inside it** (grep: only the prop pass at 572–574 + destructuring at 1056–1071). The three Run-mode popups they open are orphaned:
- `PenaltyBoxControl` (2810–2983) — the ONLY surface with the **live box list, countdowns, Release (early-out on power-play goal), Clear-all, Misconduct 4:00 preset, team picker + cap-number entry**. In water polo an early release happens several times per game; today there is **no working UI for it at all**.
- `SpotlightControl` popup (custom promo spotlight — "$2 Hot Dog Night", photo + 4 stat lines) — unreachable; only roster-player spotlights work.
- The full `CueLaunchpad` popup in Full view (custom cue decks ARE reachable in `?view=show`, so this one is lower-impact).
**The assignment's question — "how does an operator record a water polo exclusion manually and does it reach the board?"** — answer: today it takes **three disconnected actions** (① +1 the Exclusions *count* stat in the team tile → board stat widget; ② fire the ✋ Exclusion *cue* with player → cinematic; ③ add the timed *box entry* via PlayerActionMenu → board countdown — but ③ wipes other entries per P0-1, and there is no way to see or release it afterward). A flustered volunteer fails this; even an expert can't release early.
**Fix:** add a "⏱ Box (n)" button to the Run bottom tray (the computed-but-unused `penaltyCount` at 1077 was clearly meant for exactly this badge) wired to `onPenalties()`, and a "★ Spotlight" / "⊞ All cues" affordance for the other two — or delete the dead popups deliberately.

### P1-1 — Every manual +1 fires an UNNAMED auto GOAL cinematic → double cinematic per goal, no console off-switch
`adjustScore` calls `maybeAutoCelebrate(..., { source: 'manual' })` (sports.service.ts:1310–1325); water polo `goal` has `autoPoints:[1]`; the per-game toggle **defaults ON** and **no console UI writes it** (`grep -rln autoCelebrate apps/web/src` → only board/ribbon/RecentEventsBar *read* it). The trained game-night flow is: tap GOAL → pick #7 → named cinematic fires (cue does NOT score) → tap +1 → **a second, generic, unnamed GOAL cinematic fires on every surface**, cutting off or stacking on the named one. Same double-fire when the CTS feed scores while the operator fires the named cue.
**Fix before the event:** (a) suppress auto-celebrate when a manual CUE with the same key fired within ~10 s (server-side, one query on the GameEvent rail), and/or (b) expose the Auto-celebrate toggle in Show settings, and/or (c) make `CueScorerPicker` optionally apply `autoPoints` so cue+score is ONE tap (industry-standard scorekeeper behavior).

### P2-1 — Create-game modal re-creates the documented "unfiltered 100+ template dropdown" trap
`sports/page.tsx:439–488`: all three layout dropdowns list **every** template (no `aspectMatches` filter, no "★ CTS Water Polo Ribbon" suggestion) — the exact failure mode written up on 2026-05-26 ("operator never picked the new ribbon out of the 100+ entries") and fixed in `LayoutsPanel`. Mitigated post-create by the Setup amber call-out, but the create-time path is where the operator IS. **Fix:** reuse `aspectMatches` + the suggestion button in the modal (or drop the pickers from create entirely and rely on the Setup defaults flow).

### P2-2 — Show Caller view fires cues WITHOUT the scorer picker
`CueLaunchpad.fireBuiltin` (CueLaunchpad.tsx:164–168) sends `{ key, target }` — no scorer fields, no `CueScorerPicker`. The dedicated cue-firing role (`?view=show`, the second tablet) gets placeholder-free but **nameless** cinematics, while the Full-view inline bar got the 06-04 flow. Fix: lift `cueWantsScorer` + `CueScorerPicker` into CueLaunchpad (they live in page.tsx; export or duplicate).

### P2-3 — Phone/touch ergonomics below par for a wet-fingered volunteer at 390 px
- Stat steppers and segment ± chips are `h-6 w-6` (24 px); score chips `h-8` (~32 px); shot-clock buttons `h-7` — all under the 44 px touch minimum. The +1 **goal** button for water polo deserves to be the biggest control on the screen; it's a 32 px chip.
- The scoreboard stacks `grid-cols-1` on mobile (~3 × 280 px tiles) inside the scrollable area — the AWAY tile and its Exclusions/Timeouts rows need scrolling mid-play (roster/cue bars stay pinned, which is good).
- `RecentEventsBar` Undo is hover-revealed (`opacity-0 group-hover:opacity-100`, RecentEventsBar.tsx:250) — on the tablets the multi-role views are designed for, hover doesn't exist (iOS first-tap-as-hover makes it a flaky two-tap; keyboard `u` is desktop-only). Make the Undo button always visible on undoable rows on coarse pointers (`@media (pointer: coarse)` / always-on at `sm:` down).
- Good: every popup is a bottom sheet (`items-end sm:items-center`) with `useOverlayLock`; `100dvh` height math; PA view is explicitly phone-shaped.

### P3-1 — ~250 lines of dead code in the console page, and it already caused P0-2
Verified-dead by grep: `StateBar` (999–1042, no render site), the one-tap score-undo rail (`scoreHome`/`scoreAway`/`undoScore`/`lastAction`/`lastScore`, 1081–1099 — ScoreTiles call `ctl.score.mutate` directly), `penaltyCount` (1077), `_StatField` (self-acknowledged), `CtsCuePanel.tsx` (deliberate, documented). Dead-looking-but-alive wiring is exactly how the popup orphaning shipped unnoticed. Sweep with the CLAUDE.md §9 render-tree rule.

### P3-2 — Keyboard cue keys 1-9 ignore the Send-to target and skip scorer attribution
page.tsx:344–354 always fires `target:'ALL'` with no scorer, even when the operator has the chip on "Ribbon". Cheat sheet doesn't mention either. Minor desktop-only inconsistency.

### P3-3 — No game date anywhere
No date/time on create; list cards show no created/scheduled date. Duplicated weekly games are indistinguishable. Add `scheduledAt` (optional) + a date chip on the card.

### P3-4 — `?intro=home` re-fires the lineup intro on every re-entry into Setup mode
`PregameIntroPanel` fires on mount (3745–3753) and mounts every time the operator switches to the Setup tab while the param is in the URL; `setView` preserves query params. Strip the param after firing.

---

## Solid (traced to real callers / tests — do not re-litigate)
- `sports.service.spec` **109/109 green** locally (this audit's run).
- T2-10 segment auto-resets; T1-4 atomic timeout; T1-3 HoldChips with SR live regions; T1-2 server undo with prev-state for SCORE/CLOCK/SEGMENT/STAT; T1-5 status cinematics (HALFTIME/FINAL win-aware); T1-6 health pills (color-blind-safe).
- 06-04 cue→pick-player→fire intact in the Full-view fast path; "no player" escape; spotlit pre-highlight.
- Score writes are concurrency-safe (atomic increment + conditional below-zero clamp).
- Screen push take-over confirm; LayoutsPanel filtering + one-click WP ribbon suggestion + amber default warning (the 05-26 trap is closed in Setup).
- Create flow ≤30 s with remembered home team + branding scraper; duplicate-game weekly path.
- `createGame` seeds timeouts at max (no NaN timeout path).
- Console is RoleGated (RESTRICTED_VIEWER locked out per 06-09 directive).

## Missing vs industry (console slice)
- One-tap "goal = score + named cue + horn" macro (Daktronics/ScoreVision standard) — today goal = 2–3 taps across 2 systems (and currently double-fires, P1-1).
- Game date/scheduling + multi-game day view (every competitor has a schedule rail).
- Score-sheet / box-score export at FINAL (refs sign it in water polo).
- Auto-celebrate visibility: an "AUTO fired ✨" toast on the console when the score-delta path fires, so the operator isn't surprised by the board.
