# Sports Module Ground-Truth Reality Check
**Slice 6 of 6 · what ACTUALLY ships today: real / costume / spec-only · read-only, file:line evidence**

## Headline verdict
The sports module is **overwhelmingly REAL and wired end-to-end** — far more than the "costume" pattern this codebase has been burned by elsewhere. Sport Engine, game-control console, live board/ribbon/scorebug, CTS live-data bridge, celebrations, and sponsorship proof-of-play all genuinely function. Gaps are HONEST spec-only items, correctly self-labeled `COMING_SOON` (not faked).

## Reality table (condensed — full evidence in agent transcript)
**REAL + wired:**
- **Sport Engine** — 18 sports fully defined (`api-types/src/sports.ts:139-747`): clock model, segments, score increments, per-sport stats, celebrations, segmentReset, penaltyBox, shotClock. Single source of truth.
- **Game CRUD + lifecycle, score (atomic+clamp+undo), clock (anchor model + 1s ClockAdvanceService + horn)** — all real, tenant-scoped, RBAC-guarded (`sports.service.ts`).
- **Shot clock + play clock SLAVED to game clock + clamped** (`:1438-1756`); **penalty box** hockey/lax/FH/WP (`:1758-1956`); **segment advance + per-sport resets** (`:1958-2077`); **baseball count engine** (3-strike/4-ball/3-out+flip); **volleyball set-and-match**; timeout/possession(typed col)/4 live-overlay kinds; **undo rail**.
- **Game-control console** (5,073-line page, run/show/pa views, hold-to-trigger, keyboard shortcuts) → `useGameControl` PATCHes /score /clock /segment /stats /status /cue /spotlight /ribbon — all wired to guarded endpoints.
- **Cue launchpad + custom cue deck (CRUD), pregame lineup choreography.**
- **Live board / ribbon / scorebug public pages** — poll `/sports/board/:id`, tick clock locally, fire celebrations. **Chromium-83 safe (grep clean).**
- **Custom-template surfaces** resolved server-side (fixes the old 401).
- **Celebrations**: 9 marquee HTML cinematics + deck.html (26 cues) + v2 water-polo pack on disk, iframed by board, team-color branded.
- **AUTO-celebrate on score-delta** (feed + manual, per-game toggle, audited).
- **CTS bridge** (Web Serial → CtsParser → POST), 2 real modes; **CTS snapshot + external `/feed` ingest** (HMAC token, rate-limited, clamped); feed credentials (token+URL+curl).
- **Roster CRUD + CSV import.**
- **Sponsor CRUD + flight windows + freq cap; impression write-path (persists, cross-tenant hardened); real measured game-report.**
- **Push game to screen** (board/ribbon/scorebug surface, conflict detection).

**SPEC-ONLY (honestly flagged, NOT costume):**
- **No `ScoreSource`/`Surface`/`CueDeck`/`Cue`/`SponsorPlacement` tables** — their FUNCTION is delivered by other shapes (feed-token+CTS / `Screen.activeBoardSurface` enum / `CustomCue`+engine celebrations / `SponsorImpression`).
- **Daktronics/Sportzcast/Genius/Sportradar/MaxPreps/GameChanger** — all `COMING_SOON` (`integrations-health.controller.ts:816-855`), no backend. **CTS is the ONE real console.**
- **Pub/sub for game-state = deliberately removed theater** — an earlier draft signed `game:<id>` messages that died on the bus (RedisService only psubscribes tenant/group/device). Real-time = 750ms poll + 1s cache + per-write invalidation. **De-theatered, not faked.**
- Stream Deck, ribbon pixel-map auto-slicing, streaming-overlay auto-integration, instant replay, fan-engagement-as-live-data, game rundown timeline — not built.

## ⚠️ KEY RECONCILIATION (this slice corrects slice 2)
Slice 2 listed **auxClocks (shot/play/penalty) as the #1 MISSING engine concept** — but that was judged vs the SPEC's stated dimensions. **The IMPLEMENTATION already has shot clock, play clock, AND penalty box, all real + wired + clamped.** So the REAL remaining engine gaps (reconciling slice 2 + 6) are narrower: **teamState arrays** (team fouls/bonus, cards, timeouts as DISPLAY fields), **per-ruleset segment config** (NCAA-M halves vs NCAA-W/HS quarters), **nested/multi-level scoring beyond volleyball** (tennis 3-level, esports round→map→series), **judge-panel mode** (boxing/MMA/gym/diving), **derived fields** (line-to-gain, bonus tier, run-rate), and **verifying current rule values** (wrestling TD=3 not 2). This is the value of ground-truthing the gap analysis.

## Can-demo-today vs costume
**✅ Demo TODAY:** create a game in 18 sports; run it live (score/clock/segment/shot+play clock/penalty box/timeouts/possession/baseball count/volleyball sets — atomic, audited, undoable); push to screen + open public board/ribbon/scorebug (tick within 750ms); fire celebrations (manual + AUTO, team-branded); CTS live console feed on a Chrome box; external feed token (curl); sponsors with caps → real measured proof-of-play; roster CSV → pregame intro; custom cue deck; drag a live scoreboard widget into any template.
**🎭 Do NOT demo as working:** Daktronics/Sportzcast/Genius/Sportradar/MaxPreps/GameChanger; league stat feeds; Stream Deck; ribbon pixel-map auto-slicing; streaming-overlay auto-integration/instant-replay/fan-engagement-as-live/district-ticker; game rundown timeline. **Also:** the ~70 beautiful `CEL_*` builder tiles are a SEPARATE system from the live board's static-HTML fire path — demoing a CEL_ tile implying "this fires during the game" is misleading.

## Bugs/risks spotted
1. **Static celebration HTML (`public/celebrations/*.html`) was NOT in the Chromium-83 grep scope** — and per the 2026-05-09 holiday-bridge regression, inline minified JS/regex in static HTML is exactly the historical landmine class. **Worth a dedicated WebKit/Chromium-83 parse check on deck.html + v2/launcher.html + the 9 marquee files.**
2. **CTS write-amplification** — `ingestCtsSnapshot` UPDATEs `Game.stats` every accepted snapshot at ~5Hz (~90k row-updates to one hot row over a multi-hour game); audit rows are sampled (good) but the stats UPDATE + cache-bust fires every snapshot. Functional, heavy write-amp at scale.
3. **Two parallel celebration systems** (live static-HTML vs builder CEL_ tiles) = drift risk; operator designs with tiles, board fires something different. Consolidation candidate.
4. **Client-reported impressions** — proof-of-play counts only what a live browser rendered; an unopened board logs zero. Inherent, sponsor-trust caveat.
5. `SportsService` keeps unused `redis`+`signer` DI (eslint-disabled) after pub/sub removal — harmless, confusing.

## Files for triage
sports.service.ts (4,227 lines — the whole engine), sports.controller.ts, sports-board.controller.ts, sponsors.service.ts, sports-feed-token.ts · api-types/src/sports.ts · schema.prisma:1779-1972 · board/ribbon/scorebug pages · sports/[gameId]/page.tsx + useGameControl · CtsBridge.tsx + cts-merge.ts · lib/celebration-assets.ts + public/celebrations/*.html (REAL live path) · widgets/v2/registry.ts + Celebrations*.tsx (builder tiles, separate) · integrations-health.controller.ts:816-855 (honest gap labels).
