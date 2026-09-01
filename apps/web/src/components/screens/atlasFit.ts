/**
 * Network Atlas fit math — pure, so it can be graded without mounting Leaflet.
 *
 * Both rules here exist because of a live operator report (2026-08-31):
 * *"it was super zoomed out when i opened the map, it should auto zoom to show
 * all areas in one view but not be zoomed way out"* — an eight-school district
 * whose campuses sit inside five kilometres opened showing half of Northern
 * California with the pins in one unreadable clump.
 */

/**
 * City scale. The ceiling for a fit whose pins carry NO scale of their own —
 * one located pin, or several stacked on the same address. `fitBounds` on a
 * degenerate box divides by zero, rides to the tile ceiling, and parks the
 * operator on a single rooftop ("why is the gym zoomed in on just sacramento",
 * 2026-08-31), so that case keeps the surrounding region on screen.
 */
export const ATLAS_LONE_PIN_MAX_ZOOM = 10;

/**
 * How far apart (in degrees, on the wider axis) pins must sit before their
 * own box is trusted to set the scale. ~0.005° is roughly 500 m — below that
 * the pins are one campus and the box is effectively degenerate.
 */
export const ATLAS_SPREAD_FLOOR_DEG = 0.005;

/**
 * The most of each axis fit padding may claim. High enough that the Atlas's
 * real desktop padding (830 px of cards across a ~1380 px map) is never
 * touched, low enough that a quarter of the container always survives as a
 * usable fit box. See `clampFitPadding`.
 */
export const MAX_FIT_PAD_SHARE = 0.75;

/**
 * The zoom CEILING for an Atlas fit, chosen from the pins' SPREAD rather than
 * their count — N pins stacked on one address make the bounds box just as
 * degenerate as one pin does.
 *
 * `undefined` means "no ceiling": a set of pins with real spread already
 * encodes the scale the operator asked for, and Leaflet's own fit is the
 * tightest zoom that frames them. Capping THAT is what produced the bug —
 * a 10 ceiling is ~120 m/px, so a 5 km district was drawn into a 160 km
 * viewport no matter how tight its bounds were.
 */
export function atlasFitMaxZoom(points: Array<[number, number]>): number | undefined {
  if (points.length < 2) return ATLAS_LONE_PIN_MAX_ZOOM;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  const spread = Math.max(maxLat - minLat, maxLng - minLng);
  return spread < ATLAS_SPREAD_FLOOR_DEG ? ATLAS_LONE_PIN_MAX_ZOOM : undefined;
}

/**
 * Fit padding, clamped to what the container can actually spare.
 *
 * The Atlas floats an exception inbox over the map's top-left and a details
 * panel over its top-right, so the fit is padded to keep pins out from under
 * them. Leaflet subtracts that padding from the container size and takes
 * `log(scale)` of the ratio (`getBoundsZoom`, leaflet-src.js:3978) — and a
 * padding WIDER than the map makes that box NEGATIVE. The log is then NaN,
 * which `getScaleZoom` (:4085) converts to `Infinity`, which clamps to the
 * map's MAX zoom: the fit slams to street level on the bounds' centre and
 * throws every pin off-screen. 830 px of padding is comfortable at 1440 px
 * and catastrophic on a phone.
 *
 * The old flat ceiling of 10 was accidentally hiding that — `min(10, 19)` is
 * 10 either way — so removing the ceiling is exactly what makes this clamp
 * load-bearing. Each axis keeps at most `MAX_FIT_PAD_SHARE` of the container,
 * and the two sides shrink in proportion so the inbox and the panel keep
 * their relative claim on the frame.
 */
export function clampFitPadding(
  topLeft: [number, number],
  bottomRight: [number, number],
  size: { x: number; y: number },
): { topLeft: [number, number]; bottomRight: [number, number] } {
  const axis = (near: number, far: number, extent: number): [number, number] => {
    const budget = Math.max(0, extent) * MAX_FIT_PAD_SHARE;
    const total = Math.max(0, near) + Math.max(0, far);
    if (total <= 0) return [0, 0];
    if (total <= budget) return [Math.max(0, near), Math.max(0, far)];
    const k = budget / total;
    return [Math.round(Math.max(0, near) * k), Math.round(Math.max(0, far) * k)];
  };
  const [left, right] = axis(topLeft[0], bottomRight[0], size.x);
  const [top, bottom] = axis(topLeft[1], bottomRight[1], size.y);
  return { topLeft: [left, top], bottomRight: [right, bottom] };
}

/**
 * A stable identity for a pin SET — the coordinates, sorted.
 *
 * The Atlas rebuilds its points array on every render and re-polls the fleet
 * every 30 s, so array identity says nothing. Keying the auto-fit off this
 * means a filter change or a newly-geocoded location re-frames the map, while
 * health churn and selection (which change neither pin's position) do not.
 */
export function pinSetKey(points: Array<[number, number]>): string {
  return points
    .map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`)
    .sort()
    .join('|');
}
