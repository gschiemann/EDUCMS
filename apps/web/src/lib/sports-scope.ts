/**
 * Results display vs game controller — K-12 launch audit F26 (2026-09-27).
 *
 * VenueOS RUNS a head-to-head game: the console owns the score, the clock
 * and the period. It does not run a MEET. For the leaderboard sports —
 * track & field, cross-country, swimming, diving, gymnastics, golf and
 * competitive cheer — the official times, places, ties, disqualifications
 * and team scores belong to the meet's timing system, judges' panel or
 * scorecards. VenueOS SHOWS the results it is given (typed on the console,
 * or received from a connected timing console); it does not score, judge
 * or rule.
 *
 * The audit's finding was that the product never said so: a meet sport sat
 * in the New-game picker beside football with nothing to tell them apart,
 * the console offered "Meet results" with auto-placing, and a relay board
 * turned any negative exchange time into "DQ" on its own. This module is
 * the one definition of that scope, so every surface that has to say it
 * (the New-game picker, the console's results area) says the same thing.
 *
 * Pure: no React, no i18n, no network.
 */
import { findSport, type SportDefinition } from '@cms/api-types';

/** `game` = VenueOS runs it · `results` = VenueOS displays its results. */
export type SportScope = 'game' | 'results';

/** Which "what stays with the officials" sentence a results sport gets. */
export type ResultsKind = 'timed' | 'dive' | 'judged' | 'golf' | 'other';

const KIND_BY_SPORT: Readonly<Record<string, ResultsKind>> = {
  track_and_field: 'timed',
  cross_country: 'timed',
  swimming: 'timed',
  // Legacy combined key (split 2026-07-01); existing games keep working.
  swimming_diving: 'timed',
  diving: 'dive',
  gymnastics: 'judged',
  competitive_cheer: 'judged',
  golf: 'golf',
};

type SportRef = SportDefinition | string | null | undefined;

function resolve(sport: SportRef): SportDefinition | undefined {
  return typeof sport === 'string' ? findSport(sport) : (sport ?? undefined);
}

/**
 * `results` for every leaderboard sport (the catalog's own `mode`), `game`
 * for everything else — including an unknown key, which the console treats
 * as a game too.
 */
export function sportScope(sport: SportRef): SportScope {
  return resolve(sport)?.mode === 'LEADERBOARD' ? 'results' : 'game';
}

/**
 * The results kind for a leaderboard sport; `null` for a game sport. A
 * leaderboard sport added to the catalog later gets the generic sentence
 * (`other`) instead of silently inheriting a wrong one.
 */
export function resultsKind(sport: SportRef): ResultsKind | null {
  const def = resolve(sport);
  if (!def || def.mode !== 'LEADERBOARD') return null;
  return KIND_BY_SPORT[def.key] ?? 'other';
}
