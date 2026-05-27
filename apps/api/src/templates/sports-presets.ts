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
