/**
 * SPORTS vertical — system template presets.
 *
 * Kept in its own file (like bar / fitness / restaurant / retail) so
 * the seed loader can tag every row `vertical='SPORTS'` in one shot.
 * The templates list endpoint then surfaces these only to tenants on
 * the SPORTS vertical — they never bleed into a school or clinic.
 *
 * This is the STARTER set — full-screen celebration scenes built from
 * the EDU CMS-10/12 celebration widgets (which are already designed +
 * animated) plus a game-day countdown. Each celebration preset is a
 * single full-canvas zone holding one CELEBRATION variant.
 *
 * Scoreboard + ribbon templates are intentionally NOT here yet — they
 * need the dedicated scoreboard / ribbon widget set (Claude Design's
 * SportsVenue batch) before they can be assembled. They land in a
 * follow-up once those widgets exist.
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

export const SPORTS_TEMPLATE_PRESETS: SystemPreset[] = [
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
