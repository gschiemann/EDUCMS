/**
 * Places from marks, with ties left as ties — K-12 launch audit F26
 * (2026-09-27).
 *
 * The console turns typed marks into places in two spots: the lane pad
 * (swim / track: fastest time = 1st) and the diving judge pad (highest
 * running total = 1st). Both numbered the sorted list 1, 2, 3 …, so two
 * swimmers on the same time got different places and the lower lane won —
 * a tie-break no official made, shown on a public board. Whether a tie
 * stands or is broken is the officials' decision under the governing
 * rules, never the order the lanes happen to sit in.
 *
 * Standard competition ranking ("1224"): equal marks share a place and the
 * next distinct mark skips the places they used. The operator can still
 * type a place over any of these once the officials separate a tie.
 *
 * Marks are compared at thousandths, the finest precision any mark in the
 * console accepts, so "47.02" and "0:47.020" are the same mark and floating
 * point noise from minutes-to-seconds arithmetic can never split a tie.
 */

/** Places for `values`, aligned to the input order. */
export function competitionPlaces(
  values: readonly number[],
  better: 'lower' | 'higher',
): number[] {
  const key = (v: number) => Math.round(v * 1000);
  const order = values
    .map((v, idx) => ({ idx, k: key(v) }))
    .sort((a, b) => (better === 'lower' ? a.k - b.k : b.k - a.k));
  const places = new Array<number>(values.length).fill(0);
  let place = 0;
  let prev: number | null = null;
  order.forEach(({ idx, k }, i) => {
    if (prev === null || k !== prev) place = i + 1;
    places[idx] = place;
    prev = k;
  });
  return places;
}
