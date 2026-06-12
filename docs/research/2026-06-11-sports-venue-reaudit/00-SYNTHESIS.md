# Sports-venue re-audit — synthesis (2026-06-11, Fable 5)

5 domains. Domains 1-4 ran as agents (reports 01-04). Domain 5 (vertical
completeness + competitive) is below — the agent stalled on a hung tool call,
so the lead completed it from direct inventory + the 2026-06-09 competitive
report (which already covers ScoreVision/Daktronics for sports).

## HEADLINE — honest correction to my earlier claim

I previously told Greg "the manual operator path is the safe, solid path; only
the serial auto-decode is the gap." **The audit proved that too optimistic.**
The MANUAL path has game-night-breaking bugs — including the single most
water-polo-specific mechanic, exclusion (ejection) entry. The serial layer is
genuinely de-risked now (new decoder + reference parity); the **operator console
+ live-data reliability are where the real game-night risk lives.**

## CONFIRMED P0s (file:line-verified by the agents) — fix before the event

1. **Exclusion add WIPES the box** — `[gameId]/page.tsx:2289-2307` roster-tile
   `onPenalty` reads `(ctl as any)._game` which is never set, so each add
   rebuilds the penalty array from empty → a 2nd exclusion erases the 1st. THE
   water-polo mechanic is broken. (domain 02)
2. **Penalty-box manager unreachable** — `onShowCues/onHighlights/onPenalties`
   passed to RunMode (page.tsx:572-574) but never invoked inside it → no
   Release, no live box list, no Misconduct (4:00). (domain 02)
3. **CTS dropout → stale pre-game score in 5s** — `ingestCtsSnapshot` writes a
   CTS overlay but never the operator score columns; on a serial hiccup the
   5s freshness window expires and every board reverts to the never-touched
   operator columns (0-0 / pre-game). The crowd sees the wrong score. (domain 04)

## CONFIRMED P1s — fix this week

- **AUTO celebration fires only on goal #1 via CTS, then dead** — delta computed
  vs operator columns CTS never updates (sports.service.ts:3966,4078). (04)
- **Water polo shot clock never renders** on default board/ribbon/scorebug —
  render gated to `def.key==='basketball'` (board page.tsx:783). (03)
- **Web Serial unplug never auto-reconnects** mid-game (CtsBridge.tsx:1235). (04)
- **Custom-template surfaces lose CTS data after first poll** — GameStateContext
  setSnapshot raw, no applyCtsOverlay (GameStateContext.tsx:86). (03)
- **CTS_* widgets show fake SAMPLE scores off the player route** (8px grey dot
  the only tell). (03)
- **Manual +1 double-fires an unnamed GOAL cinematic** (sports.service.ts:1310). (02)
- **`cts-gen6/cts-gen7` say "stable" while only the disproven old decoder is
  wired** — ship a falsehood until the classic.ts cutover. (01)
- **WTTC RS-485 cable spec only in research docs** — order-ahead hardware not in
  the install checklist. (01)
- **SurfaceHealthPills: dead board stays green 5-7 min** (raw Screen.status, not
  render-proof). (04)
- **`/cts-cue-fired` accepts unauthenticated writes** → sponsor proof-of-play
  pollution via the public board-URL game id. (01 — P2, but revenue-integrity)

## What's genuinely SOLID (verified — don't re-spend)
- New decode layer: bit-for-bit reference parity (scrambler + framing), classic
  validated vs REAL console captures, 54/54. (01)
- Render surfaces: board/ribbon/scorebug/overlay all real, single source of
  truth (bug can't disagree with the big screen), Taurus rule-#10 sweep CLEAN
  (0 inset, 0 gap), 06-04 dynamic-name celebration fix intact end-to-end. (03)
- Console run-flow: timeout atomic+audited, score concurrency-safe, undo rail
  server-backed + deterministic, period auto-resets spec-covered, keyboard
  shortcuts, multi-role views, 109/109 service tests. (02)
- Sponsor frequency cap + per-impression log server-side rate-limited. (03)
- Feed-token security: constant-time HMAC, versioned revocation, rate-before-auth. (01)
- Daktronics honestly provisional (no costume). (01)

## Domain 5 — vertical completeness + competitive (lead-completed)
- **Per-sport widgets**: the sports widget family (MainScoreboardWidget,
  SportElementWidgets, CtsScoreboard, RibbonScorebugWidgets) is config-driven off
  GameStateContext — sports differ by sport-config (periods, shot clock, labels),
  not by duplicated widgets. Real, but the WATER POLO config has the shot-clock
  render gap above. ~97 sport-ish preset lines in system-presets.ts.
- **Competitive (from 2026-06-09 report, still current)**: **Sports parity A−.**
  Ahead of the field on per-sport consoles + CTS bridge + celebrations + scorebug
  + undo rail + sponsor impression logs (ScoreVision-class). Tail gaps: 2D/3D
  animated timeline graphics, named-vendor feeds (Sportzcast/Genius), score-change
  odometer animation, vector sport iconography (we use emoji), box-score export.
  None are deal-losers for a water-polo HS pilot; the score-change animation +
  vector icons are the cheapest "looks more pro in a side-by-side" wins.

## Build order from here (lead recommendation)
1. **The 3 P0s** — exclusion box (1+2), CTS-dropout adopt path (3). Game-night-critical.
2. **Decode cutover** — wire classic.ts + gen7 into CtsBridge/profiles; capture
   mode; fixes the "stable"-falsehood P1 and the AUTO-celebration-via-CTS P1.
3. **Water polo shot-clock render** + Web Serial reconnect + custom-template CTS
   overlay + SAMPLE-off-player guard (P1 cluster).
4. **RS-485 cable addendum + order parts** (operator-proof setup).
5. **Visual best-in-industry**: score odometer, vector icons, typography pass.
