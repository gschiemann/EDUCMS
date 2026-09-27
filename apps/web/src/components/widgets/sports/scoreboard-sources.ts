/**
 * Where each value on the Main Scoreboard (`scoreboard-main`) comes from —
 * shared by the widget and the Properties panel so both agree on which keys
 * are GAME FACTS and which are presentation (K-12 launch audit F29,
 * 2026-09-27).
 *
 * The bug: `MainScoreboardWidget` layers `config.*` over the live game with
 * the config winning, and the panel rendered a "Home score" number box that
 * showed 0 when unset and wrote the moment it was touched. A sample score an
 * operator typed while laying the board out — or one click on the field —
 * silently masked the real score for the rest of the season, with nothing in
 * the builder saying so.
 *
 * Now:
 *   • `dataMode: 'manual'` is its own explicit mode — a hand-typed board that
 *     never reads a game and never claims to be live.
 *   • In the default live mode, each GAME FACT below is either "from the
 *     game" or an explicit OVERRIDE the panel badges (with "Use live value"),
 *     and binding a game clears every fact override so the live score shows.
 */

/** Game facts: a live board reads these from the game unless overridden. */
export const MAIN_SCOREBOARD_FACT_KEYS = [
  'homeScore',
  'awayScore',
  'clock',
  'period',
  'status',
  'shotClock',
  'possession',
  'homeFouls',
  'awayFouls',
  'homeTimeouts',
  'awayTimeouts',
] as const;

/** Team identity: from the game unless the operator brands it. */
export const MAIN_SCOREBOARD_IDENTITY_KEYS = [
  'homeName',
  'awayName',
  'homeColor',
  'awayColor',
  'homeLogoUrl',
  'awayLogoUrl',
] as const;

export type MainScoreboardFactKey = (typeof MAIN_SCOREBOARD_FACT_KEYS)[number];

/** A key counts as set when it holds anything but undefined / null / ''. */
export function isSetValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== '';
}

/** The fact keys a config currently overrides (live mode only). */
export function overriddenFacts(cfg: Record<string, unknown> | null | undefined): MainScoreboardFactKey[] {
  if (!cfg || cfg.dataMode === 'manual') return [];
  return MAIN_SCOREBOARD_FACT_KEYS.filter((k) => isSetValue(cfg[k]));
}

/** The config patch that returns every game fact to the live source. */
export function clearFactOverridesPatch(): Record<MainScoreboardFactKey, undefined> {
  const out = {} as Record<MainScoreboardFactKey, undefined>;
  for (const k of MAIN_SCOREBOARD_FACT_KEYS) out[k] = undefined;
  return out;
}
