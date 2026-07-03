/**
 * SPORTS vertical — system template presets.
 *
 * Kept in its own file (like bar / fitness / restaurant / retail) so
 * the seed loader can tag every row `vertical='SPORTS'` in one shot.
 * The templates list endpoint then surfaces these only to tenants on
 * the SPORTS vertical — they never bleed into a school or clinic.
 *
 * Contents:
 *  - 3 live scoreboard templates (HS / College / Pro) — each a
 *    full-canvas SCOREBOARD widget that binds to a game and renders
 *    off the sports engine.
 *  - 12 full-screen celebration scenes built from the EDU CMS-10/12
 *    celebration widgets (already designed + animated).
 *  - A game-day countdown.
 *
 * Ribbon-board templates still need the dedicated ribbon widget set
 * before they can be assembled — they land in a follow-up.
 */

import type { SystemPreset } from './system-presets';

/** A full-screen celebration scene — one CELEBRATION variant, no chrome. */
function celebration(
  id: string,
  name: string,
  description: string,
  variant: string,
): SystemPreset {
  return {
    id,
    name,
    description,
    category: 'CELEBRATION',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#05070d',
    zones: [
      {
        name: 'Celebration',
        widgetType: 'CELEBRATION',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 0,
        sortOrder: 0,
        defaultConfig: { variant },
      },
    ],
  };
}

/** A full-screen live scoreboard — one SCOREBOARD tier variant. */
function scoreboardPreset(
  id: string,
  name: string,
  description: string,
  variant: string,
  tier: string,
): SystemPreset {
  return {
    id,
    name,
    description,
    category: 'SCOREBOARD',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#05070d',
    zones: [
      {
        name: 'Scoreboard',
        widgetType: 'SCOREBOARD',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 0,
        sortOrder: 0,
        defaultConfig: { variant, tier },
      },
    ],
  };
}

/**
 * CTS Water Polo Ribbon — 4-zone perimeter ribbon preset.
 *
 * Built for the operator's live water-polo install (NovaStar VX400 Pro
 * driving a 1000mm × 40ft ribbon with `repeats: 4` tiling — see the
 * Screen.repeats column). Design canvas is 1920×192 (10:1 ratio); the
 * widgets all scale-to-fit so the layout still renders cleanly on any
 * actual ribbon dimensions the operator sets on the Screen.
 *
 * Zone layout (one tall strip; zones split horizontally):
 *
 *   ┌──────────────┬───────────────┬─────────────┬──────────┐
 *   │ CTS LIVE     │ SPONSOR REEL  │ ANNOUNCERS  │ CELEBRATE│
 *   │ scoreboard   │ rotator       │ ticker      │ pulse    │
 *   │ (clock+score │ (operator     │ (operator   │ (auto on │
 *   │  +period+    │  configures)  │  configures)│  goal /  │
 *   │  exclusion)  │               │             │  horn)   │
 *   └──────────────┴───────────────┴─────────────┴──────────┘
 *      x=0,w=30       x=30,w=30      x=60,w=25     x=85,w=15
 *
 * Every zone uses a SCOREBOARD widgetType with a `variant` set to the
 * matching CTS variant id from variants-register.ts. The variant
 * dispatcher renders the right component; nothing in this preset
 * imports the React widget code directly (this file lives in the API
 * package).
 *
 * Operators get a turn-key ribbon they can pick from the gallery, then
 * customize each zone via the Properties panel (sponsor slots,
 * announcement copy, team colors).
 */
function ctsRibbonZone(
  name: string,
  variant: string,
  x: number,
  width: number,
  extraConfig?: Record<string, any>,
): SystemPreset['zones'][number] {
  return {
    name,
    widgetType: 'SCOREBOARD',
    x,
    y: 0,
    width,
    height: 100,
    zIndex: 0,
    sortOrder: 0,
    defaultConfig: { variant, ...extraConfig },
  };
}

// ───────────────────────────────────────────────────────────────────
// P1-11 (2026-05-28) — flesh out the SPORTS gallery so the six Sprint-13
// category tabs (verticals.ts SPORTS_CATEGORIES: Scoreboards / Ribbon /
// Celebrations / Sponsors / Game day) all render real, attractive
// content instead of near-empty. Everything below is built from
// PRE-EXISTING, render-verified widget types only:
//   • SCOREBOARD element variants (sb-*, score-*) — registered in
//     variants-register.ts SPORT_ELEMENT_VARIANTS, all widgetType
//     'SCOREBOARD'. These are the per-sport situational pieces
//     (down/distance, base diamond, set scores, cards, leaderboard…).
//   • GAME_CLOCK / GAME_SEGMENT / SCORE_HOME / SCORE_AWAY — canonical
//     sport widgets (WidgetRenderer cases confirmed).
//   • CELEBRATION (cfg.variant → cel-*) — the EDU CMS-10/12 + More-Sports
//     celebration library (76 variants).
//   • IMAGE / IMAGE_CAROUSEL / TEXT / TICKER / COUNTDOWN — vertical-
//     agnostic base widgets.
// No new widgetType is invented. Coords are 0-100 canvas percentages.
// No `inset` shorthand anywhere (CLAUDE.md rule #10 — these run on the
// NovaStar Taurus Chromium-83 LED controller in source-mode installs).

/** One SCOREBOARD-element zone (e.g. a clock pod, a down/distance pill). */
function sbZone(
  name: string,
  variant: string,
  x: number, y: number, width: number, height: number,
  sortOrder: number,
  extraConfig: Record<string, any> = {},
  widgetType: string = 'SCOREBOARD',
): SystemPreset['zones'][number] {
  return {
    name,
    widgetType,
    x, y, width, height,
    zIndex: 2,
    sortOrder,
    defaultConfig: { variant, ...extraConfig },
  };
}

/**
 * A per-sport live scoreboard built element-by-element so every piece is
 * individually editable / draggable / brandable (same philosophy as
 * preset-sb-main). Takes a base 2-team block + the sport's situational
 * row. Category SCOREBOARD so it lands in the Scoreboards tab.
 */
function sportScoreboard(
  id: string,
  name: string,
  description: string,
  bgColor: string,
  clockColor: string,
  situational: SystemPreset['zones'][number][],
): SystemPreset {
  return {
    id,
    name,
    description,
    category: 'SCOREBOARD',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor,
    zones: [
      sbZone('Status', 'sb-status', 40, 4, 20, 6, 0, { fontSize: 34 }),
      sbZone('Home Logo', 'sb-team-logo-home', 9, 12, 13, 22, 1, { team: 'home' }),
      sbZone('Home Name', 'sb-team-name-home', 2, 35, 28, 8, 2, { team: 'home', fontSize: 54 }),
      sbZone('Home Score', 'score-home', 3, 45, 26, 36, 3, { color: '#ffffff', fontWeight: 900, fontSize: 320, align: 'center' }, 'SCORE_HOME'),
      sbZone('Game Clock', 'game-clock', 36, 14, 28, 24, 4, { color: clockColor, fontWeight: 900, fontSize: 180, align: 'center' }, 'GAME_CLOCK'),
      sbZone('Period', 'game-segment', 38, 38, 24, 8, 5, { color: '#ffffff', fontWeight: 700, fontSize: 60, align: 'center' }, 'GAME_SEGMENT'),
      sbZone('Away Logo', 'sb-team-logo-away', 78, 12, 13, 22, 6, { team: 'away' }),
      sbZone('Away Name', 'sb-team-name-away', 70, 35, 28, 8, 7, { team: 'away', fontSize: 54 }),
      sbZone('Away Score', 'score-away', 71, 45, 26, 36, 8, { color: '#ffffff', fontWeight: 900, fontSize: 320, align: 'center' }, 'SCORE_AWAY'),
      ...situational,
    ],
  };
}

/**
 * A sponsor surface. `mode: 'rotator'` rotates uploaded sponsor logos
 * (IMAGE_CAROUSEL); `mode: 'slot'` is a single presenting-sponsor slot
 * (SCOREBOARD sb-sponsor) with a co-brand line. Category SPONSOR so it
 * lands in the Sponsors tab.
 */
function sponsorBoard(
  id: string,
  name: string,
  description: string,
  bgColor: string,
  zones: SystemPreset['zones'][number][],
): SystemPreset {
  return {
    id, name, description,
    category: 'SPONSOR',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor,
    zones,
  };
}

export const SPORTS_TEMPLATE_PRESETS: SystemPreset[] = [
  // ── CTS Water Polo Ribbon — 4-zone perimeter ribbon ─────────────
  {
    id: 'sports-cts-water-polo-ribbon',
    name: 'CTS Water Polo Ribbon (cinematic celebrations)',
    description:
      'Turn-key 4-zone perimeter-ribbon layout for water-polo installs driven by a Colorado Time Systems (CTS) Gen 6 console. Left: live CTS scoreboard (clock + score + period + active exclusion). Middle: sponsor rotator (configure your reel in the Properties panel). Right: player announcements (lineups, next match, anything you want to ticker). Cinematic celebration overlay fires soccer GOOOOAL / hockey red-lamp / lacrosse stick-up scenes on every goal or horn (vs the simple sport-celebration animations on the Default ribbon). Pair with a screen on `repeats: 4` so the same content tiles every 10ft of ribbon.',
    // Category=RIBBON so the LayoutsPanel ribbon dropdown filter
    // surfaces this in the right slot instead of burying it among 100+
    // SCOREBOARD-category templates. Operator finds it immediately.
    category: 'RIBBON',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 192,
    bgColor: '#05070d',
    zones: [
      ctsRibbonZone(
        'Live CTS Scoreboard (clock + score + period + exclusion)',
        'scoreboard-cts-ribbon',
        0, 30,
        { homeAbbrev: 'H', awayAbbrev: 'A', bgColor: '#0f172a', accentColor: '#f59e0b' },
      ),
      ctsRibbonZone(
        'Sponsor Reel — Properties panel: type slots or switch to Auto',
        'scoreboard-cts-sponsor',
        30, 30,
        {
          zoneLabel: 'OUR SPONSORS',
          defaultDurationMs: 6000,
          bgColor: '#1e293b',
          // Auto-pull sponsors from the Sponsor table by default — operator
          // adds sponsors at /[schoolId]/sports/sponsors and they appear
          // here without ever editing this widget. Operator can flip back
          // to manual mode in the Properties panel + paste slots if they
          // want this ribbon to show different sponsors than the rest of
          // the fleet.
          dataSource: 'auto',
          // Sample slots used when the Auto fetch returns empty (e.g.
          // builder preview with no Game bound). Keep generic so they
          // read as obviously editable to the operator.
          slots: [
            { text: 'YOUR SPONSOR HERE', durationMs: 4500, bgColor: '#1e293b' },
            { text: 'PROUD PARTNER · POOL SUPPLY CO', durationMs: 4500, bgColor: '#0c4a6e' },
            { text: 'GO TEAM · BOOK FUTURE GAMES AT YOUR-CLUB.COM', durationMs: 4500, bgColor: '#312e81' },
          ],
        },
      ),
      ctsRibbonZone(
        'Player Announcements — Auto-pulls from this game’s roster',
        'scoreboard-cts-announcement',
        60, 25,
        {
          zoneLabel: 'ANNOUNCEMENTS',
          defaultDurationMs: 5000,
          bgColor: '#0c1322',
          accentColor: '#fbbf24',
          // Auto-generate intros from the live game's roster — operator
          // adds players at /[schoolId]/sports/<gameId> → Roster panel
          // and this widget rolls "NOW IN · #7 J. RIVERA" through every
          // starter, plus a lineup overview + closing cheer.
          dataSource: 'auto',
          autoTemplates: {
            homeLineup: 'HOME LINEUP — {team} · {numbers}',
            awayLineup: 'AWAY LINEUP — {team} · {numbers}',
            perPlayer: 'NOW IN · #{number} {name}',
            closer: "LET'S GO {team}!",
          },
          autoDurationMs: 4000,
          // Sample entries used when no roster is bound (builder preview
          // before a Game exists). Keep generic + on-brand for water polo.
          entries: [
            { text: 'STARTING LINEUP — H 1, 7, 11, 12, 4, 8, 9', durationMs: 6000 },
            { text: 'NEXT HOME MATCH — FRI 7:00 PM · AQUATIC CENTER', durationMs: 6000 },
            { text: 'PLAYER OF THE WEEK — #7 J. RIVERA · 4 GOALS', durationMs: 6000 },
          ],
        },
      ),
      ctsRibbonZone(
        'Goal Pulse (lightweight "GOAL!" text on score/horn)',
        'scoreboard-cts-celebration',
        85, 15,
        {
          text: 'GOAL!',
          idleText: 'GO TEAM',
          activeMs: 6000,
          hornAlsoTriggers: true,
          homeColor: '#3b82f6',
          awayColor: '#ef4444',
          bgColor: '#0a0a14',
        },
      ),
      // FULL-BLEED celebration overlay — invisible until a goal-delta /
      // horn / period change fires, then takes over the entire ribbon
      // with a cinematic celebration scene from the v2/Celebrations*
      // library. z-index 50 so it draws above every other ribbon zone;
      // auto-reverts after `durationMs` so the live scoreboard returns
      // the moment the scene ends. This is the bridge between the
      // already-built CEL_* widget library and the live CTS feed.
      {
        name: 'Cinematic Celebration Overlay (auto-fires on goal / horn / period change)',
        widgetType: 'SCOREBOARD',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 50,
        sortOrder: 1,
        defaultConfig: {
          variant: 'scoreboard-cts-celebration-orchestrator',
          durationMs: 6000,
          homeTeamName: 'HOME',
          awayTeamName: 'AWAY',
          homeColor: '#3b82f6',
          awayColor: '#ef4444',
          cues: {
            homeGoal: ['CEL_SOCCER_GOAL', 'CEL_HOCKEY_GOAL', 'CEL_LX_GOAL', 'CEL_SC_GOAL_NEON'],
            awayGoal: ['CEL_HOCKEY_GOAL', 'CEL_SOCCER_GOAL', 'CEL_HK_GOAL_RETRO', 'CEL_LX_GOAL'],
            periodEnd: ['CEL_FOOTBALL_TOUCHDOWN', 'CEL_BASKETBALL_BUZZER'],
            horn: ['CEL_FOOTBALL_TOUCHDOWN', 'CEL_BASKETBALL_BUZZER'],
          },
        },
      },
    ],
  },
  // ── Scoreboards — live, engine-driven (bind a game in the editor) ──
  scoreboardPreset(
    'sports-scoreboard-hs',
    'High School Scoreboard',
    'Live game scoreboard, high-school tier. Bind it to a game and it auto-adapts to that sport — clock, periods, and the stat row all come from the sports engine.',
    'scoreboard-hs',
    'hs',
  ),
  scoreboardPreset(
    'sports-scoreboard-college',
    'College Scoreboard',
    'Live game scoreboard, college tier — broadcast polish. Same engine: bind a game and the board reflects its sport automatically.',
    'scoreboard-college',
    'college',
  ),
  scoreboardPreset(
    'sports-scoreboard-pro',
    'Pro Scoreboard',
    'Live game scoreboard, professional tier — sleek broadcast look. Drives off the live game feed and the sports engine.',
    'scoreboard-pro',
    'pro',
  ),
  // ── Football ──────────────────────────────────────────────────
  celebration(
    'sports-cel-touchdown',
    'Touchdown',
    'Full-screen TOUCHDOWN celebration — stadium-light shake, rising sparks, and team-color callout with the scoring player. Drop it on the video board the moment the ref signals six.',
    'cel-football-touchdown',
  ),
  celebration(
    'sports-cel-field-goal',
    'Field Goal',
    'Twin-uprights field-goal celebration with an arcing ball and a +3 callout. Game-day ready for the kicking unit.',
    'cel-football-fieldgoal',
  ),
  // ── Basketball ────────────────────────────────────────────────
  celebration(
    'sports-cel-slam-dunk',
    'Slam Dunk',
    'Net-shredding slam-dunk scene with the dunker’s name in lights. Built for the arena video board.',
    'cel-basketball-dunk',
  ),
  celebration(
    'sports-cel-buzzer-beater',
    'Buzzer Beater',
    'Clock-to-zero buzzer-beater takeover with a team-color flood — the game-winner moment.',
    'cel-basketball-buzzer',
  ),
  celebration(
    'sports-cel-three-pointer',
    'Three-Pointer',
    'Arcing-trail three-point celebration with a spinning ball and the shooter’s tonight count.',
    'cel-basketball-three',
  ),
  // ── Baseball / Softball ───────────────────────────────────────
  celebration(
    'sports-cel-home-run',
    'Home Run',
    'Home-run celebration — arcing ball trail with the batter, distance, and exit velocity.',
    'cel-baseball-homerun',
  ),
  celebration(
    'sports-cel-grand-slam',
    'Grand Slam',
    'Four-base diamond lights up for the GRAND SLAM — the biggest swing in the book.',
    'cel-baseball-grandslam',
  ),
  celebration(
    'sports-cel-strikeout',
    'Strikeout',
    'Three flashing Ks with a rotating baseball — fire it every time the pitcher rings one up.',
    'cel-baseball-strikeout',
  ),
  // ── Hockey ────────────────────────────────────────────────────
  celebration(
    'sports-cel-hockey-goal',
    'Hockey Goal',
    'Red-lamp goal celebration with the GOAL banner and the assists chain.',
    'cel-hockey-goal',
  ),
  celebration(
    'sports-cel-hat-trick',
    'Hat Trick',
    'Hat-trick takeover — three goals in a game, flying-hats sparkle and all.',
    'cel-hockey-hattrick',
  ),
  // ── Soccer ────────────────────────────────────────────────────
  celebration(
    'sports-cel-soccer-goal',
    'Soccer GOOOOAL',
    'The classic GOOOOAL celebration with a flag-wave backdrop, scorer, and match minute.',
    'cel-soccer-goal',
  ),
  celebration(
    'sports-cel-golazo',
    'Golazo',
    'Highlight-reel golazo scene for a wonder-strike — italic GOLAZO and the goal type.',
    'cel-soccer-golazo',
  ),
  // ── More celebrations — round out the sports the 12 above miss ────
  // Volleyball has no dedicated cel-* variant; tennis / wrestling /
  // swimming / track / golf do — pull the marquee moment for each so
  // the Celebrations tab covers the full HS-athletics slate.
  celebration(
    'sports-cel-wrestling-pin',
    'Wrestling Pin',
    'Whistle-to-mat PIN takeover — the match-ending fall with the wrestler’s name and weight class. Fire it the instant the ref slaps the mat.',
    'cel-wr-pin',
  ),
  celebration(
    'sports-cel-tennis-matchpoint',
    'Match Point',
    'Match-point conversion celebration — the closing winner with the final set line. Built for the show court video board.',
    'cel-tn-matchpoint',
  ),
  celebration(
    'sports-cel-swim-record',
    'Swim Record',
    'Pool-record celebration — splashing water trail with the swimmer, event, and new record time. Drop it the moment the touch-pad lights.',
    'cel-sw-record',
  ),
  celebration(
    'sports-cel-track-record',
    'Track Record',
    'Finish-line record scene — lane lights and a sweeping time callout for a meet, school, or world record.',
    'cel-tr-worldrecord',
  ),
  // ── Per-sport live scoreboards — element-based, fully editable ────
  // Each adds the sport's situational row on top of the shared 2-team
  // block. Drag / resize / restyle / brand every piece; bind a game and
  // the live feed fills it. Resize for any LED.
  sportScoreboard(
    'sports-scoreboard-football',
    '🏈 Football Scoreboard',
    'Friday-night football board — big team blocks + amber clock, plus the football situational row (down & distance, ball-on, play clock, possession). Every element editable; bind a game; resize for any LED.',
    '#0a1628', '#fbbf24',
    [
      sbZone('Down & Distance', 'sb-down-distance', 38, 46, 24, 8, 9, { fontSize: 60, color: '#fbbf24' }),
      sbZone('Ball On', 'sb-ball-on', 40, 55, 20, 6, 10, { fontSize: 34 }),
      sbZone('Play Clock', 'sb-play-clock', 65, 14, 9, 14, 11, { fontSize: 84, color: '#ef4444' }),
      sbZone('Home Possession', 'sb-possession-ball-home', 30, 33, 5, 8, 12, { team: 'home', fontSize: 40 }),
      sbZone('Away Possession', 'sb-possession-ball-away', 65, 33, 5, 8, 13, { team: 'away', fontSize: 40 }),
      sbZone('Home Timeouts', 'sb-timeouts-home', 4, 88, 18, 7, 14, { team: 'home', fontSize: 38 }),
      sbZone('Away Timeouts', 'sb-timeouts-away', 78, 88, 18, 7, 15, { team: 'away', fontSize: 38 }),
    ],
  ),
  sportScoreboard(
    'sports-scoreboard-baseball',
    '⚾ Baseball / Softball Scoreboard',
    'Diamond board — team blocks + the baseball situational row (lit base diamond, balls-strikes-outs count, inning + half arrow, pitch speed). Every element editable; bind a game; resize for any LED.',
    '#06210f', '#fde68a',
    [
      sbZone('Base Diamond', 'sb-bases', 44, 13, 12, 18, 9, {}),
      sbZone('Count (B-S-O)', 'sb-count', 38, 46, 24, 10, 10, { fontSize: 60 }),
      sbZone('Inning + Half', 'sb-inning-half', 40, 31, 20, 8, 11, { fontSize: 46 }),
      sbZone('Pitch Speed', 'sb-pitch-speed', 65, 16, 14, 9, 12, { fontSize: 56 }),
      sbZone('Home Pitch Count', 'sb-pitch-count-home', 4, 88, 18, 7, 13, { team: 'home', fontSize: 40 }),
      sbZone('Away Pitch Count', 'sb-pitch-count-away', 78, 88, 18, 7, 14, { team: 'away', fontSize: 40 }),
    ],
  ),
  sportScoreboard(
    'sports-scoreboard-volleyball',
    '🏐 Volleyball Scoreboard',
    'Set/rally board — team blocks + per-set scores and the serve indicator (no game clock for a rally sport, so the center pod carries the set line). Every element editable; bind a match; resize for any LED.',
    '#1a0e2e', '#a78bfa',
    [
      sbZone('Set Scores', 'sb-set-scores', 36, 52, 28, 12, 9, { fontSize: 48 }),
      sbZone('Serve Indicator', 'sb-serve', 42, 66, 16, 8, 10, { team: 'home', fontSize: 40 }),
      sbZone('Home Timeouts', 'sb-timeouts-home', 4, 88, 18, 7, 11, { team: 'home', fontSize: 38 }),
      sbZone('Away Timeouts', 'sb-timeouts-away', 78, 88, 18, 7, 12, { team: 'away', fontSize: 38 }),
    ],
  ),
  sportScoreboard(
    'sports-scoreboard-soccer',
    '⚽ Soccer Scoreboard',
    'Pitch board — team blocks + match clock, added time, and per-side card counts (yellow + red). Every element editable; bind a match; resize for any LED.',
    '#06210f', '#86efac',
    [
      sbZone('Added Time', 'sb-added-time', 42, 46, 16, 7, 9, { fontSize: 40 }),
      sbZone('Home Cards', 'sb-cards-home', 30, 33, 10, 8, 10, { team: 'home', fontSize: 38 }),
      sbZone('Away Cards', 'sb-cards-away', 60, 33, 10, 8, 11, { team: 'away', fontSize: 38 }),
      sbZone('Shots (stat)', 'sb-stat-pair', 38, 87, 24, 9, 12, { statKey: 'shots', label: 'SHOTS', fontSize: 40 }),
    ],
  ),
  sportScoreboard(
    'sports-scoreboard-hockey',
    '🏒 Hockey / Lacrosse Scoreboard',
    'Rink board — team blocks + game clock, shot clock, and stacked penalty-box timers with the power-play / penalty-kill badge. Every element editable; bind a game; resize for any LED.',
    '#06121f', '#67e8f9',
    [
      sbZone('Shot Clock', 'sb-shot-clock', 65, 16, 9, 13, 9, { fontSize: 80, color: '#67e8f9' }),
      sbZone('Power Play / PK', 'sb-power-play', 40, 46, 20, 7, 10, { fontSize: 36 }),
      sbZone('Home Penalty Box', 'sb-penalty-home', 4, 84, 20, 12, 11, { team: 'home', fontSize: 36 }),
      sbZone('Away Penalty Box', 'sb-penalty-away', 76, 84, 20, 12, 12, { team: 'away', fontSize: 36 }),
    ],
  ),
  sportScoreboard(
    'sports-scoreboard-wrestling',
    '🤼 Wrestling Scoreboard',
    'Mat board — bout clock + the wrestling situational row (weight class, riding-time clock) and the running dual-meet team scores. Every element editable; bind a dual; resize for any LED.',
    '#1c0a0a', '#fca5a5',
    [
      sbZone('Weight Class', 'sb-weight-class', 40, 46, 20, 7, 9, { fontSize: 36 }),
      sbZone('Riding Time', 'sb-riding-time', 42, 55, 16, 8, 10, { fontSize: 52 }),
      sbZone('Home Dual Score', 'sb-team-score-home', 6, 84, 18, 11, 11, { team: 'home', fontSize: 60 }),
      sbZone('Away Dual Score', 'sb-team-score-away', 76, 84, 18, 11, 12, { team: 'away', fontSize: 60 }),
    ],
  ),
  // ── Meet leaderboard board (track / swim / XC) ────────────────────
  {
    id: 'sports-leaderboard-meet',
    name: '🏅 Meet Leaderboard',
    description:
      'Leaderboard board for meet sports (track, swim, cross country, gymnastics) — a place / lane / name / time table with an event title and an announcements ticker. Bind a meet; resize for any LED.',
    category: 'SCOREBOARD',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0a1020',
    zones: [
      { name: 'Event Title', widgetType: 'TEXT', x: 6, y: 5, width: 88, height: 12, zIndex: 2, sortOrder: 0, defaultConfig: { content: 'EVENT — 100M FINAL', fontSize: 64, alignment: 'center', color: '#fbbf24' } },
      sbZone('Leaderboard', 'sb-leaderboard', 12, 19, 76, 66, 1, { fontSize: 40 }),
      { name: 'Announcements', widgetType: 'TICKER', x: 0, y: 88, width: 100, height: 10, zIndex: 2, sortOrder: 2, defaultConfig: { theme: 'track-day', messages: ['NEXT EVENT — 200M PRELIMS', 'FIELD EVENTS UNDERWAY — LONG JUMP PIT 2', 'GO TEAM!'], speed: 'normal' } },
    ],
  },
  // ── Swimming lane board + Diving leaderboard (2026-07-01 split) ─────
  // Operator: "find out what scoreboards do for swimming competitions...
  // lanes and shit that we need to show where each swimmer is. And you
  // grouped diving into the same sport but wouldn't that be totally
  // different? SEPARATE it." Swimming gets the flagship SWIM_LANE_GRID
  // (one row per lane); diving gets DIVE_LEADERBOARD (judged running
  // total, no lanes/clock/splits — a different data model). Full-canvas
  // scene widgets (own transform:scale fit), not sbZone element pieces.
  {
    id: 'sports-swim-lane-board',
    name: '🏊 Swimming Lane Board',
    description:
      'Live heat board — one row per lane (lane #, swimmer/team, time, place), with a LANE⇄PLACE order toggle in Properties. Bind a meet; resize for any LED.',
    category: 'SCOREBOARD',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#050b16',
    zones: [
      { name: 'Lane Grid', widgetType: 'SWIM_LANE_GRID', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { orderMode: 'lane', laneCount: 8 } },
    ],
  },
  // #270a (2026-07-01) — track & field reuses the swim lane grid widget:
  // the research (Part C) generalizes lanes × athlete/time/place to any
  // running event "for free." Same SWIM_LANE_GRID widget; the board page's
  // default-render path sets athleteLabel/iconEmoji for track automatically,
  // but a template built from THIS preset sets them explicitly so it also
  // reads right when picked as a custom scoreboard template.
  {
    id: 'sports-track-lane-board',
    name: '🏃 Track Lane Board',
    description:
      'Live heat board for track & field running events — one row per lane (lane #, athlete/team, time, place), with a LANE⇄PLACE order toggle in Properties. Bind a meet; resize for any LED.',
    category: 'SCOREBOARD',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0a1020',
    zones: [
      {
        name: 'Lane Grid',
        widgetType: 'SWIM_LANE_GRID',
        x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0,
        defaultConfig: {
          orderMode: 'lane',
          laneCount: 8,
          athleteLabel: 'ATHLETE / TEAM',
          iconEmoji: '🏃',
        },
      },
    ],
  },
  {
    id: 'sports-dive-leaderboard',
    name: '🤿 Diving Leaderboard',
    description:
      'Judged running-total leaderboard for diving — place, diver/team, total score. No lanes/clock/splits (diving is judged, not timed — a different sport from swimming). Bind a meet; resize for any LED.',
    category: 'SCOREBOARD',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0a0714',
    zones: [
      { name: 'Dive Leaderboard', widgetType: 'DIVE_LEADERBOARD', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} },
    ],
  },
  // ── Swim/dive DEPTH boards (2026-07-01 — docs/research/2026-06-30-
  // swim-dive-scoreboards/00-REPORT.md parts A3/A4/A8/B4/B5). Two more
  // full-canvas scenes stacking the depth widgets: a relay board with a
  // record reference bar pinned above it, and a diving "current dive"
  // board pairing the judges panel with the running leaderboard.
  {
    id: 'sports-swim-relay-board',
    name: '🏊 Swim Relay Exchange Board',
    description:
      'One relay lane\'s 4 legs — split, cumulative time, and exchange/takeoff time (illegal takeoffs auto-flag DQ) — with a record/pace reference bar pinned above. Bind a meet; resize for any LED.',
    category: 'SCOREBOARD',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#050b16',
    zones: [
      { name: 'Record Line', widgetType: 'SWIM_RECORD_LINE', x: 0, y: 0, width: 100, height: 14, zIndex: 2, sortOrder: 0, defaultConfig: { recordType: 'POOL RECORD' } },
      { name: 'Relay Exchange', widgetType: 'SWIM_RELAY_EXCHANGE', x: 0, y: 14, width: 100, height: 86, zIndex: 1, sortOrder: 1, defaultConfig: { laneNumber: 3 } },
    ],
  },
  {
    id: 'sports-dive-judges-board',
    name: '🤿 Diving Judges + Leaderboard Board',
    description:
      'Current dive\'s judge panel (dropped high/low greyed out, DD, computed dive score) on the left, running field leaderboard on the right. Bind a meet; resize for any LED.',
    category: 'SCOREBOARD',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0a0714',
    zones: [
      { name: 'Judges Panel', widgetType: 'DIVE_JUDGES_PANEL', x: 0, y: 0, width: 58, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: {} },
      { name: 'Dive Leaderboard', widgetType: 'DIVE_LEADERBOARD', x: 58, y: 0, width: 42, height: 100, zIndex: 1, sortOrder: 1, defaultConfig: { divesInList: 6 } },
    ],
  },
  // ── Stadium Lane flagship broadcast board (S6 #288, 2026-07-03) ────
  // Greg picked all 3 stadium designs 2026-07-03 as sports-scoreboard
  // template options (docs/design/proposals/2026-07-02-stadium-lane/
  // README.md); v1 "Broadcast" and v2 "Dual-Meet Duel" are both built. A
  // full-canvas single-zone scene, same pattern as sports-swim-lane-board
  // above — reads the SAME stats.results contract, presented with the
  // Stadium Lane visual language (angled header, gold leader glow,
  // team-color lane washes, pool-record + sponsor footer) instead of the
  // dense operator-configurable grid.
  {
    id: 'sports-stadium-broadcast-board',
    name: '🏊 Broadcast Meet Board',
    description:
      'Flagship stadium broadcast board — angled blue header, huge Anton event title, gold leader glow, team-color lane washes, pool-record + sponsor footer. Bind a meet; resize for any LED.',
    category: 'SCOREBOARD',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#060a14',
    zones: [
      { name: 'Broadcast Board', widgetType: 'STADIUM_MEET_BOARD', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { boardStyle: 'broadcast', laneCount: 8 } },
    ],
  },
  // ── Stadium Lane v2 "Dual-Meet Duel" (S6 #288, 2026-07-03) ─────────
  // Same widget (STADIUM_MEET_BOARD), same stats.results contract, a
  // different `boardStyle` — the dual-meet team-score header with
  // color-flood diagonal collision, per-swimmer delta-vs-leader, and a
  // live-only bottom ticker (see StadiumMeetBoardWidget.tsx's
  // StadiumDuelScene header comment for the full live-data mapping).
  {
    id: 'sports-stadium-duel-board',
    name: '🏊 Dual-Meet Duel Board',
    description:
      'Dual-meet duel board — home/away team-color floods collide on a diagonal, huge team scores up top, per-swimmer time deltas vs the leader, medal chips, live ticker. Bind a meet; resize for any LED.',
    category: 'SCOREBOARD',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#07090f',
    zones: [
      { name: 'Duel Board', widgetType: 'STADIUM_MEET_BOARD', x: 0, y: 0, width: 100, height: 100, zIndex: 1, sortOrder: 0, defaultConfig: { boardStyle: 'duel', laneCount: 8 } },
    ],
  },
  // ── Sponsors — first-class revenue surfaces (Sprint 13 §7) ────────
  sponsorBoard(
    'sports-sponsor-rotator',
    '🤝 Sponsor Rotator',
    'Full-board sponsor rotation — upload your partner logos in Properties and they cycle on a timer. Drop it on the video board between plays or run it as a concourse loop. THANK-YOU header + co-brand line included.',
    '#0b1020',
    [
      { name: 'Header', widgetType: 'TEXT', x: 8, y: 6, width: 84, height: 14, zIndex: 2, sortOrder: 0, defaultConfig: { content: 'TONIGHT’S GAME BROUGHT TO YOU BY', fontSize: 52, alignment: 'center', color: '#fbbf24' } },
      { name: 'Sponsor Logos', widgetType: 'IMAGE_CAROUSEL', x: 14, y: 22, width: 72, height: 58, zIndex: 2, sortOrder: 1, defaultConfig: { urls: [], intervalSec: 6, fitMode: 'contain' } },
      sbZone('Presenting Slot', 'sb-sponsor', 30, 82, 40, 12, 2, { label: 'YOUR SPONSOR HERE', fontSize: 40 }),
    ],
  ),
  sponsorBoard(
    'sports-sponsor-scorebar',
    '🏷️ Co-Branded Scorebar',
    'A live mini-scoreboard with a persistent presenting-sponsor bar pinned across the bottom — keep the partner visible all game without giving up the score. Bind a game; resize for any LED.',
    '#05070d',
    [
      sbZone('Home Logo', 'sb-team-logo-home', 8, 14, 12, 26, 0, { team: 'home' }),
      sbZone('Home Score', 'score-home', 22, 14, 18, 30, 1, { color: '#ffffff', fontWeight: 900, fontSize: 240, align: 'center' }, 'SCORE_HOME'),
      sbZone('Clock', 'game-clock', 41, 18, 18, 18, 2, { color: '#fbbf24', fontWeight: 900, fontSize: 130, align: 'center' }, 'GAME_CLOCK'),
      sbZone('Period', 'game-segment', 41, 36, 18, 7, 3, { color: '#ffffff', fontWeight: 700, fontSize: 48, align: 'center' }, 'GAME_SEGMENT'),
      sbZone('Away Score', 'score-away', 60, 14, 18, 30, 4, { color: '#ffffff', fontWeight: 900, fontSize: 240, align: 'center' }, 'SCORE_AWAY'),
      sbZone('Away Logo', 'sb-team-logo-away', 80, 14, 12, 26, 5, { team: 'away' }),
      sbZone('Sponsor Bar', 'sb-sponsor', 10, 78, 80, 16, 6, { label: 'PRESENTED BY YOUR SPONSOR', fontSize: 30, bgColor: 'rgba(255,255,255,0.06)' }),
    ],
  ),
  sponsorBoard(
    'sports-sponsor-concourse',
    '🛍️ Concourse Sponsor Loop',
    'Portrait-friendly concourse loop — a single big sponsor slot with a rotating partner gallery beneath and a deal-of-the-game ticker. Park it on lobby / concourse screens between events.',
    '#0c0f1a',
    [
      sbZone('Featured Sponsor', 'sb-sponsor', 12, 6, 76, 34, 0, { label: 'OUR PROUD PARTNER', fontSize: 34 }),
      { name: 'Partner Gallery', widgetType: 'IMAGE_CAROUSEL', x: 12, y: 42, width: 76, height: 40, zIndex: 2, sortOrder: 1, defaultConfig: { urls: [], intervalSec: 5, fitMode: 'contain' } },
      { name: 'Deal Ticker', widgetType: 'TICKER', x: 0, y: 88, width: 100, height: 10, zIndex: 2, sortOrder: 2, defaultConfig: { theme: 'jumbotron-pro', messages: ['DEAL OF THE GAME — 2-FOR-1 AT THE CONCESSION STAND', 'SHOW YOUR TICKET FOR 10% OFF AT OUR-SPONSOR.COM', 'THANK YOU TO TONIGHT’S SPONSORS'], speed: 'normal' } },
    ],
  ),
  sponsorBoard(
    'sports-sponsor-presenting',
    '⭐ Presenting Sponsor',
    'A single, bold presenting-sponsor takeover — one logo slot, a “proudly presented by” line, and your event name. The clean full-board read for the headline partner. Upload the logo in Properties.',
    '#070b16',
    [
      { name: 'Pre-line', widgetType: 'TEXT', x: 10, y: 12, width: 80, height: 12, zIndex: 2, sortOrder: 0, defaultConfig: { content: 'PROUDLY PRESENTED BY', fontSize: 44, alignment: 'center', color: '#94a3b8' } },
      sbZone('Sponsor Logo', 'sb-sponsor', 22, 26, 56, 44, 1, { label: 'YOUR SPONSOR', fontSize: 40 }),
      { name: 'Event Name', widgetType: 'TEXT', x: 10, y: 74, width: 80, height: 14, zIndex: 2, sortOrder: 2, defaultConfig: { content: 'VARSITY GAME NIGHT', fontSize: 60, alignment: 'center', color: '#fbbf24' } },
    ],
  ),
  // ── Game day — pre-game / lineup / schedule / halftime ────────────
  {
    id: 'sports-gameday-lineup',
    name: '📋 Starting Lineup',
    description:
      'Pre-game starting-lineup board — a HOME vs AWAY heading with a lineup ticker (edit the names in Properties) over a clean two-tone backdrop. Put it on the video board during warmups.',
    category: 'GAMEDAY',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0a0e1c',
    zones: [
      { name: 'Title', widgetType: 'TEXT', x: 6, y: 8, width: 88, height: 16, zIndex: 2, sortOrder: 0, defaultConfig: { content: 'STARTING LINEUP', fontSize: 88, alignment: 'center', color: '#fbbf24' } },
      sbZone('Home', 'sb-team-name-home', 4, 30, 44, 12, 1, { team: 'home', fontSize: 64 }),
      sbZone('Away', 'sb-team-name-away', 52, 30, 44, 12, 2, { team: 'away', fontSize: 64 }),
      { name: 'Lineup', widgetType: 'TICKER', x: 0, y: 70, width: 100, height: 16, zIndex: 2, sortOrder: 3, defaultConfig: { theme: 'varsity-athletic', messages: ['#7 J. RIVERA — G', '#11 A. CHEN — F', '#23 M. OKAFOR — C', '#4 L. PARK — G', '#1 D. SILVA — F'], speed: 'normal' } },
    ],
  },
  {
    id: 'sports-gameday-tonight',
    name: '📣 Tonight’s Game',
    description:
      'Pre-game hype board — “TONIGHT” headline, the matchup, and a kickoff/first-pitch countdown with a get-loud ticker. The concourse / lobby pre-game read. Set the target time in Properties.',
    category: 'GAMEDAY',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#10061f',
    zones: [
      { name: 'Tonight', widgetType: 'TEXT', x: 6, y: 6, width: 88, height: 14, zIndex: 2, sortOrder: 0, defaultConfig: { content: 'TONIGHT', fontSize: 96, alignment: 'center', color: '#f472b6' } },
      sbZone('Home', 'sb-team-name-home', 4, 24, 38, 12, 1, { team: 'home', fontSize: 56 }),
      { name: 'VS', widgetType: 'TEXT', x: 42, y: 24, width: 16, height: 12, zIndex: 2, sortOrder: 2, defaultConfig: { content: 'VS', fontSize: 64, alignment: 'center', color: '#94a3b8' } },
      sbZone('Away', 'sb-team-name-away', 58, 24, 38, 12, 3, { team: 'away', fontSize: 56 }),
      { name: 'Countdown', widgetType: 'COUNTDOWN', x: 20, y: 40, width: 60, height: 38, zIndex: 2, sortOrder: 4, defaultConfig: { variant: 'cd-neon' } },
      { name: 'Hype Ticker', widgetType: 'TICKER', x: 0, y: 88, width: 100, height: 10, zIndex: 2, sortOrder: 5, defaultConfig: { theme: 'spirit-rally', messages: ['GET LOUD — DOORS OPEN AT 6:00', 'WEAR YOUR COLORS', 'LET’S GO!'], speed: 'fast' } },
    ],
  },
  {
    id: 'sports-gameday-schedule',
    name: '🗓️ This Week’s Games',
    description:
      'A week-of schedule board — title plus a rolling games ticker (date · opponent · time · home/away). Edit the slate in Properties; run it on hallway and concourse screens all week.',
    category: 'GAMEDAY',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0b1224',
    zones: [
      { name: 'Title', widgetType: 'TEXT', x: 6, y: 8, width: 88, height: 16, zIndex: 2, sortOrder: 0, defaultConfig: { content: 'THIS WEEK IN ATHLETICS', fontSize: 76, alignment: 'center', color: '#fbbf24' } },
      { name: 'Schedule', widgetType: 'TICKER', x: 0, y: 38, width: 100, height: 24, zIndex: 2, sortOrder: 1, defaultConfig: { theme: 'jumbotron-pro', messages: ['TUE — VOLLEYBALL vs CENTRAL · 5:30 · HOME', 'WED — SOCCER @ NORTH · 4:00 · AWAY', 'FRI — FOOTBALL vs RIVAL · 7:00 · HOME', 'SAT — XC INVITATIONAL · 9:00 · AWAY'], speed: 'slow' } },
    ],
  },
  {
    id: 'sports-gameday-halftime',
    name: '⏸️ Halftime Board',
    description:
      'Halftime / intermission board — a big “HALFTIME” callout with a rotating sponsor reel below and a be-right-back ticker. Bridges the break without dead air on the video board. Upload your own partner logos in Properties — the three tiles below start as generic placeholders so the board is never empty out of the box.',
    category: 'GAMEDAY',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0a0f1d',
    zones: [
      { name: 'Halftime', widgetType: 'TEXT', x: 8, y: 8, width: 84, height: 18, zIndex: 2, sortOrder: 0, defaultConfig: { content: 'HALFTIME', fontSize: 104, alignment: 'center', color: '#67e8f9' } },
      // Halftime sponsor "reel" (P1-10/S5-3, 2026-07-02) — this is a static
      // system preset (no tenant/game context at seed time), and there's no
      // live-data-pull mechanism for IMAGE_CAROUSEL (it's a plain `urls[]`
      // array — see WidgetRenderer.tsx ImageCarouselWidget), so a per-tenant
      // pull from the Sponsors library isn't feasible here without a new
      // widget type (out of scope for this preset-only fix). Previously this
      // zone was a single IMAGE_CAROUSEL with `urls: []`, which rendered a
      // literal "Add Photos" placeholder box — dead air during the one
      // moment a video board most needs to look alive. Replaced with three
      // sb-sponsor text-slot tiles (same SponsorSlotWidget every other
      // sponsor preset in this file uses for its "no real art yet" state —
      // see sports-sponsor-rotator/-scorebar/-concourse/-presenting above),
      // seeded with generic tier labels so the board is NEVER empty. Each
      // tile is independently editable in Properties (label text or an
      // uploaded logo via imageUrl) — this is the SAME upgrade path the
      // other sponsor presets already offer, not a new pattern.
      sbZone('Presenting Sponsor', 'sb-sponsor', 14, 30, 22, 40, 1, { label: 'PRESENTING SPONSOR', fontSize: 30, bgColor: 'rgba(255,255,255,0.05)' }),
      sbZone('Gold Sponsor', 'sb-sponsor', 39, 30, 22, 40, 2, { label: 'GOLD SPONSOR', fontSize: 30, bgColor: 'rgba(255,255,255,0.05)' }),
      sbZone('Community Partner', 'sb-sponsor', 64, 30, 22, 40, 3, { label: 'COMMUNITY PARTNER', fontSize: 26, bgColor: 'rgba(255,255,255,0.05)' }),
      { name: 'Back Soon', widgetType: 'TICKER', x: 0, y: 88, width: 100, height: 10, zIndex: 2, sortOrder: 4, defaultConfig: { theme: 'scorebug', messages: ['BACK FOR THE SECOND HALF SHORTLY', 'VISIT THE CONCESSION STAND', 'THANK YOU TO OUR SPONSORS'], speed: 'normal' } },
    ],
  },
  // ── Game day ──────────────────────────────────────────────────
  {
    id: 'sports-gameday-countdown',
    name: 'Game Day Countdown',
    description:
      'A full-screen neon countdown to kickoff / first pitch / puck drop. Set the target time and put it on the concourse screens pre-game.',
    category: 'GAMEDAY',
    orientation: 'LANDSCAPE',
    screenWidth: 1920,
    screenHeight: 1080,
    bgColor: '#0a0014',
    zones: [
      {
        name: 'Countdown',
        widgetType: 'COUNTDOWN',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        zIndex: 0,
        sortOrder: 0,
        defaultConfig: { variant: 'cd-neon' },
      },
    ],
  },
];
