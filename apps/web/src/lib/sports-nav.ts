/**
 * Who gets the Sports (game day) entry in the navigation.
 *
 * Until the K-12 sports launch it was SPORTS venues only ("the sports menu
 * should only show when you pick the sports venue type", 2026-05-19). A school
 * runs its own games — scoreboard, ribbon, scorebug, the scorer's-table console
 * — so from 2026-09-27 (Greg: "make it visible for k-12 as well") a K-12 school
 * gets the entry too. Every other vertical is unchanged.
 *
 * The K-12 half requires the vertical to be KNOWN, not inferred:
 * `normalizeVertical()` falls back to K12 for a missing value, and an inferred
 * vertical must never paint industry chrome (see `TenantCopy.verticalKnown`).
 */
export function showsSportsNav(copy: { vertical: string; verticalKnown?: boolean }): boolean {
  if (copy.vertical === 'SPORTS') return true;
  return copy.vertical === 'K12' && copy.verticalKnown !== false;
}
