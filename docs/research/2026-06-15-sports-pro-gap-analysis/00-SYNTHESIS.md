# Sports Pro Gap Analysis — beat HS/college competition (2026-06-15)

5-agent read-only analysis (inventory · competitive · streaming · visual · operator UX).
Goal: make VenueOS Sports genuinely pro-grade and win head-to-head vs Daktronics /
Nevco / ScoreVision / OES at the HS + college level. Raw structured findings:
`/private/tmp/.../tasks/wvmkis3fq.output` (emergency copy); ranked build plan below.

## Where we already WIN (defend + market these)
- **One platform**: everyday signage + native life-safety + full game presentation on cheap
  LED/LCD, run from a phone with zero console/IT. No incumbent matches this.
- **Free branded streaming scorebug** locked to the SAME game state as the in-venue board
  (`overlay/[gameId]` is real, single-source-of-truth).
- Console depth, server-backed undo rail, hold-to-confirm, multi-role views, ~50+ celebration
  cues across all 18 sports, sponsor proof-of-play, real CTS bridge. Grade **B+/A-**.

## Where we LOSE / look cheap (this sprint targets the cheap-to-fix, high-perception set)
Verdict: **bones are D1, wardrobe is HS varsity.**

### BUILD NOW (this sprint — high impact, high confidence, file-partitioned)
1. **[P0] CTS shot-clock data seam** — per-side `homeShotClock/awayShotClock` from the bridge
   never reaches the board's `stats.shotClock` projector, so the big-board shot clock is DARK
   during a live CTS water-polo/basketball game. Marquee game-night failure for the first
   customer. Fix: derive single-side `stats.shotClock` from the active per-side in `cts-merge.ts`;
   render it in the ribbon pinned anchor too. *(LEAD — shipped first.)*
2. **[P0/P1] Score-change + idle motion** — scores hard-swap with zero animation on board,
   ribbon, scorebug. The single most-noticed "cheap" tell vs Daktronics/ScoreVision. Add a
   Taurus-safe (`transform`/`opacity`) score pop/odometer + subtle live-board ambient motion.
3. **[P0] Streaming overlay = revenue package** — the stream bug ignores `sponsors[]`,
   `spotlight`, and the T2-5 live-text overlay it ALREADY receives. Render the sponsor bug
   (logo on every off-site view = doubled sponsor value, tag impressions `surfaceKind:'stream'`),
   spotlight/live-text as broadcast lower-thirds, score-pop, and a show/hide "clean feed" toggle.
4. **[P1] Pre-game + Final cinematics** — pre-game is a flat `LOGO VS LOGO / "TONIGHT"`
   (hardcoded, wrong for afternoon games); Final differentiates the winner only by gradient
   alpha. Real matchup card (date/time/records) + a `FINAL — WINNER` champion treatment reusing
   the confetti engine.
5. **[P1] Emoji → vector marks** — `def.emoji` sport marks + 🏈 possession + 🏓 serve render
   platform-dependently and read consumer-grade at 8 ft / on stream. Replace the high-traffic
   ones (possession, serve) with clean tintable vector glyphs; prefer team logos over sport
   emoji on the big surfaces. *(Shared `SportGlyph` component — LEAD scaffolds.)*
6. **[P0/P1] Operator effortlessness** — score/clock touch targets are 24–32px (below the 44px
   wet-fingered-volunteer floor) when scoring should be the BIGGEST control; two run-mode popups
   (custom Spotlight + cue launchpad) are wired-but-orphaned; create-game modal re-introduces
   the unfiltered 100+ template trap + no game date. Dead single-shot undo state still present.
7. **[P2] Athletic default palette** — uncustomized games render in the product's SaaS indigo
   (`#4f46e5`); swap to a neutral athletic default (deep navy/crimson) so a first game looks
   like a scoreboard, not "purple software."

### NEXT SPRINT (XL — its own effort, flagged not built here)
- **Player-stats / stat-leaders / player-of-the-game ENGINE** + **season/career persistence**
  + **records & milestone alerts** ("NEW SCHOOL RECORD"). The #1 thing the AD's coach asks for.
  Needs a Team entity + cross-game persistence + a leader/milestone computer feeding the board
  Spotlight AND the stream overlay. Biggest single competitive lever — and the biggest build.
- **Statbook imports** (GameChanger / MaxPreps / Hudl) — kill manual roster/schedule entry.
- **Managed ad-sales + revenue rollup** ("this board earned $X") — the decisive HS buying trigger.
- **Game rundown / show-caller timeline** (T3-2); **box-score export at FINAL**.
- **Instant replay / multi-camera** (XL, hardware) — correctly deferred.
- **Fan engagement** (QR poll, cheer meter) — cheap crowd-moment wins.
- **Per-sport broadcast bug layouts** (baseball bases/count, water-polo shot clock in the bug).
- **Curated per-school typography look-packs** wired to BrandKit (ScoreVision's pitch).
