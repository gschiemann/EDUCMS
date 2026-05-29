# Show Control, Cue/Celebration, Rundown & Broadcast/Streaming Overlay
**Slice 4 of 6 · operator's game-presentation toolset · vs Sprint 13 spec (all "VenueOS has X" = spec-claims, not verified shipped — slice 6 verifies shipped)**

## Bottom line
The **cue/celebration engine is the STRONG part of the spec** — CueDeck + multi-trigger (phone/tablet/Stream Deck/AUTO/keyboard) + per-surface signed fan-out + pre-cached brand-shimmed celebrations is competitive at HS and in spots (AUTO-trigger, offline-survivable celebrations, hardware-agnostic Stream Deck) AHEAD of ScoreVision/Daktronics for the price. **Two real holes:** (1) the rundown is a STUB not show-calling; (2) the **broadcast/streaming overlay is mis-filed as a "god-tier stretch" when it's TABLE-STAKES for the HS beachhead** (NFHS Network + Hudl are where most HS games actually live).

## Gap table (vs spec)
**Covered/strong:** cue launchpad, cross-surface fan-out, autoRevert, multi-trigger, branded auto-recolored celebrations (better than ScoreVision's manual wrapper), pre-cache (no competitor claims offline-survivable celebrations), game state machine, solo/2-operator modes, ~150ms content sync, signage-by-day→game-by-night (the core wedge).

**HIGH gaps:**
- **Rundown is a static list, not a show-calling tool** — no auto-timing engine, no show-caller tracking (crew follows caller cue-to-cue across tablets), no multi-user live editing, no teleprompter. Shoflo-grade is what separates "a cue grid" from "running a show." Reuse existing pub/sub for caller-position broadcast.
- **Transparent browser-source scorebug overlay** — only a stretch-goal line. **Build FIRST** (see deep-dive). Pairs with: scorebug auto-fed from the same game state (board & bug never disagree).

**MEDIUM gaps (the "real game day" reality):** hype/intro video as a first-class cue type (not generic asset); walk-up music per roster slot (baseball/basketball intros); cue-bound sting library (Cue.audio hook exists, no managed library/ducking); **horn/buzzer from the app via EP6N GPIO-OUT relay (the "we replace the $3K Daktronics console" proof point)**; instant replay-to-board (college expectation); live in-game stat graphics (player spotlight w/ headshot+stat, comparison cards); per-period brand-wrapper swap; kiss-cam/fan-cam (needs live-camera compositing); stream-side sponsor ad insertion; **NFHS Network/Hudl awareness/positioning (most HS already stream on one — ignoring them is an adoption risk)**.

**LOW/defer (pro):** teleprompter, DMX lighting (gated on GPIO/RS232 hw), PA/announcer ducking, decibel meter, vote-by-cheer, ESPN-compliant graphics, StatCrew/Presto stat cards, multi-cam switching.

## The streaming-overlay opportunity (the under-rated win — promote to Phase 1)
**Highest leverage-per-dollar in the slice, wrongly filed under "god-tier."**
- **Why huge for HS:** NFHS Network + Hudl are the center of gravity, not niche. Hudl Focus auto-records/streams every scheduled game; NFHS has a Producer w/ overlays. Most HS games' audience (grandparents, recruiters, away fans, alumni) is NOT in the gym — a scoreboard that ignores the stream is invisible to them. The whole category treats it as table-stakes (ScoreVision auto-embeds + SV Streaming Playbook; Daktronics Live Score Bug; Sportzcast PNG for vMix; free ecosystem: OBScoreboard/KeepTheScore/TrackScore). **Sponsorship doubles in value** (logo runs in-venue AND every stream view; proof-of-play extends to stream impressions nearly free).
- **Why VenueOS wins it cheap:** the stack ALREADY renders scoreboards as HTML bound to live game state — a transparent scorebug is the SAME widgets on a transparent bg at fixed broadcast res, no new engine. Game state is ALREADY a signed pub/sub stream → the overlay subscribes to the same channel as the board → **board & bug can never disagree** (the double-entry sin competitors hit). Output = one URL pasted into OBS/vMix/Hudl as a Browser Source (exact UX every free tool uses; Hudl explicitly supports it).
- **Build (small):** new player route `/overlay/[gameId]?surface=stream` (STREAM role exists), transparent bg, fixed 1920×1080, scorebug widgets + sponsor bug + lower-third slot → subscribe to existing game-state pub/sub → "Copy stream-overlay URL" button + 2-line OBS/vMix/Hudl helper → brand-shim themeable → (Phase 2) sponsor rotation + log stream impressions to AuditLog. Renders in OBS/vMix CEF (modern Chromium) so Taurus rules don't bite — but build to the Taurus-safe baseline anyway (no `inset`/flex-`gap`), costs nothing.
- **Honest limit:** won't match Hudl Focus auto-camera/AI-tracking or NFHS distribution — don't try. Position as "works with the stream you already run," not a streaming platform.

## Top 5 builds (credibility × leverage ÷ cost)
1. **Transparent browser-source scorebug overlay** — build first; nearly free off existing HTML-scoreboard + pub/sub; where the off-site audience + doubled sponsor value live.
2. **Real rundown / show-caller engine** — per-item durations + auto-recalc running clock + live "current cue" the crew tracks + multi-user editing. Reuse pub/sub for caller position. (HS = basic timed list; COL/PRO = full tracking.)
3. **Game-day audio: walk-up music + cue-bound sting library + horn relay (EP6N GPIO-OUT)** — three things a real game has that the spec lacks; the horn = "we replace the $3K console" wedge.
4. **First-class hype-video + player-spotlight cue types** — explicit video cue (audio-bed + auto-revert) + spotlight cue bound to roster + scoring event; hype videos are the #1 HS energy moment.
5. **Fan-engagement pack: QR vote-by-cheer/poll + decibel meter** — cheapest slice that doesn't need live-camera compositing; buildable on existing stack; demoable + sponsorable. (Defer kiss-cam/fan-cam — heavier live-input lift.)

**Deliberately deferred (pro/heavy):** instant replay-to-board (capture hw), live kiss-cam, ESPN graphics + StatCrew/Presto cards, DMX lighting.

## Sources
Daktronics Show Control/Plus/Live Channel/Live Clips/Live Book GFX/All Sport Live Score Bug + 5000 horn · ANC LiveSync (frame-accurate) · ScoreVision (hype/wrapper/spotlight + streaming playbook) · Shoflo (rundown/show-caller/teleprompter, NFL 214-element) · OBScoreboard/KeepTheScore/TrackScore (browser-source) · Sportzcast/Scorebird (PNG overlays) · NFHS Network overlays/console · Hudl Focus (overlay/Production Truck) · Ross XPression/Tessera · Uplause/Cue (fan engagement) · HARMAN stadium audio · WalkUp DJ · stadium DMX/UDP cue triggers.

**Caveats:** all "VenueOS has X" judged vs Sprint 13 spec text, NOT running code (slice 6 verifies shipped); verify proof-of-play renders real impressions not a log dump; Daktronics Plus granular cue syntax is marketing-level; ScoreVision "$50-130K/yr" figure is from a prior pass, not re-verified.
