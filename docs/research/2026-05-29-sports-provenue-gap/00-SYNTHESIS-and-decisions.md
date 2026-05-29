# VenueOS Sports — Pro-Venue Gap Analysis: SYNTHESIS + Decisions
**2026-05-29 · 6-agent research (competitor matrix · per-sport rules · data ingestion · show-control/broadcast · reliability/hardware · codebase reality) · read-only**
**STATUS: sports fixes ON HOLD per Greg pending his review of this doc.**

## The one-paragraph truth
The sports module is **real and works** (slice 6: Sport Engine + live console + board/ribbon/scorebug + CTS + celebrations + sponsorship proof-of-play are all wired end-to-end, gaps honestly labeled COMING_SOON — not costume). We are **already competitive at the HS tier** and ahead in spots (AUTO-celebrate, offline-survivable celebrations, hardware-agnostic Stream Deck, everyday-signage+emergency on one platform). The gaps that matter are **(a) a few high-leverage features mis-prioritized or missing, (b) honest positioning fixes that cost nothing, and (c) pro-tier deep stack we should deliberately defer.** Nothing here blocks an HS launch.

## Strategic reframe (slice 1 — the most important non-obvious finding)
**"Hardware-agnostic" is NOT our unique wedge** — ScoreVision (our archetype) and ANC both claim it; ScoreVision runs on Apple TV / Samsung Smart Signage / commercial TVs + iPad + offline mode. **Our real moat = the gym/stadium board as everyday K-12 signage + native emergency/life-safety + game system on ONE platform.** No competitor unifies all three. Sell **"the board earns money 5 days/week, not just Friday night"** + **collapse 3 POs (scoreboard vendor + signage CMS + mass-notification) into one subscription.** And the actual HS close is the **managed ad-sales service** (Daktronics DSM raises ~$40K/yr for the school; ScoreVision DMS $50-130K/yr) — "it pays for itself," not "cheaper software" (Watchfire bundles game software FREE on its hardware, so don't race to the bottom).

## Ranked build order (leverage × distance ÷ cost) — for your greenlight
**TIER 1 — high-leverage, mostly off the existing stack:**
1. **Streaming browser-source scorebug overlay** (slices 4+6). Slice 4 flagged it mis-filed as "god-tier"; slice 6 confirms **the scorebug page ALREADY EXISTS and is real** — so this is even closer than thought. NFHS Network + Hudl are where most HS games' audience actually is; a transparent bug subscribing to the same game-state means board & stream never disagree, and sponsorship value doubles. **Highest delight-per-dollar.** Small: a `/overlay/[gameId]?surface=stream` route + "copy URL for OBS/vMix/Hudl" + brand-shim. (Build to Taurus-safe baseline.)
2. **Daktronics All Sport 5000 console parser** (slice 3). The MOST common HS console; our CTS bridge covers only aquatics. **MIT-licensed open-source decoder exists** (19200/8/N/1, all sports) → port the field-offset table into a TS parser sibling of `@cms/scoreboard-cts`; the whole ingest pipeline already exists. **Days-weeks, single highest-ROI data-in.** Then OES (public manual). Make `ScoreSource` a real parser registry while at it.
3. **Reliability Tier 1** (slice 5): **render-proof heartbeat + native watchdog above the WebView + Sentry crash reporting.** Today a frozen kiosk that answers TCP looks "online" — the worst live-game failure. Codebase is ~60% there (renderer-crash→reload exists; foreground-svc heartbeat + Sentry are UNCHECKED). Plus backup-content auto-cut (static board, not black). **Before any paid live game.**

**TIER 2 — completeness + game-day feel:**
4. **Engine completeness** (slices 2+6 reconciled): shot/play/penalty clocks are ALREADY built — remaining gaps are **teamState display arrays** (team fouls/bonus, cards, timeouts), **per-ruleset segment config** (NCAA-M halves vs W/HS quarters), **nested scoring beyond volleyball** (tennis 3-level, esports), **judge-panel mode** (boxing/MMA/gym/diving), **derived fields** (bonus tier, run-rate), and **verify current rule values** (wrestling takedown = 3 not 2 — shipping stale = a WRONG board).
5. **Real rundown / show-caller engine** (slice 4) — today it's a static list; add per-item durations + auto-recalc running clock + live "current cue" the crew tracks (reuse pub/sub) + multi-user edit.
6. **Game-day audio + horn** (slice 4): walk-up music per roster slot, cue-bound sting library (Cue.audio hook exists), **horn/lamp via EP6N GPIO-OUT relay** = the "we replace the $3K Daktronics console" wedge.

**TIER 3 — only where a contract needs it:** first-class hype-video + player-spotlight cue types; fan-engagement pack (QR vote-by-cheer + decibel meter — skip live-camera kiss-cam for now).

## Free positioning fixes (do regardless — cost nothing)
- **Scope the "~150ms sync" claim** to *independent* surfaces; hand pixel-continuous/genlock to the processor. Never imply one-canvas sync at 150ms.
- **Stop selling "player runs ON the Taurus" as flagship** — keep it as an integrator-installed budget option for small single-zone boards; **lead every quote with EP6N source-mode.**
- **Correct CLAUDE.md Chromium version** "83" → "83–87, assume the floor" (Android-11 Taurus = Chromium 87).
- **Dedicated WebKit/Chromium-83 parse check on the static celebration HTML** (`deck.html`, `v2/launcher.html`, 9 marquee files) — NOT in the prior grep scope, and it's the historical landmine class (2026-05-09 holiday-bridge regression).

## Deliberately DON'T build (poor effort-ratio for the K-12→college beachhead)
- Native SMPTE-2110/SDI I/O, broadcast-grade real-time 3D graphics, AR fan engagement → integrate via partners/source-mode.
- Instant replay-to-board (needs capture hardware) — real college expectation, heavy; defer.
- League stat feeds (Genius/Sportradar/Stats Perform) — **no HS coverage + enterprise pricing; structurally unavailable for the beachhead.** College-tier only, post-funding, stats-overlay-not-clock.
- Building Nevco-old (262KHz coax) reader ourselves → OCR fallback or "bring your Sportzcast feed" interop (flag: Sportzcast = Genius Sports, a competitor).
- LED-processor integration is **paper-only / 100% unverified** — run the matrix (EP6N HDMI-OUT at off-spec res into NovaStar/Brompton/Megapixel) before ANY "we support pro processors" claim.

## Decisions for Greg (sports fixes held until you weigh in)
1. **Greenlight Tier 1** (streaming overlay + Daktronics parser + reliability heartbeat/watchdog/Sentry)? My rec: yes — all three are high-leverage and mostly off the existing stack.
2. **Tier 2/3** — build now or after the first paid HS install proves Tier 1?
3. **The pricing/GTM reframe** (everyday-signage+emergency moat, collapse-3-POs, managed ad-sales as the close) — want me to spec the managed ad-sales offering + the bundled pricing page?
4. **Run the LED-processor hardware matrix** (order an EP6N + test into a NovaStar/Brompton)? Needed before any pro-processor claim.
5. The free positioning fixes (sync wording, Taurus-not-flagship, Chromium 83→87 doc, celebration-HTML WebKit check) — I can do these now without a "build" greenlight; confirm.

## Report index
01 competitor matrix · 02 per-sport completeness · 03 data ingestion · 04 show-control/broadcast · 05 reliability/hardware · 06 codebase reality (ground-truth that corrects 02 on auxClocks).
