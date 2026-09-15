/**
 * Which wheel gestures zoom the map — and by how much.
 *
 * 2026-09-14 (Greg): "when you open the map and your mouse is over top, it
 * starts zooming in and out when I'm just trying to scroll down … zoom is a
 * pinch, not just auto zoom in and out with scroll." The Overview map sits
 * mid-page, so Leaflet's default scroll-wheel zoom ate every wheel tick on
 * the way past it. Now a plain wheel scrolls the page, and the map zooms on
 * a PINCH: a trackpad pinch reaches the browser as a wheel event with
 * `ctrlKey` set (the cross-browser convention; ⌘ is accepted too), a touch
 * pinch is Leaflet's own touchZoom, and the +/− buttons and double-click are
 * unchanged.
 *
 * The step maths is Leaflet's ScrollWheelZoom, transcribed, so a pinch feels
 * exactly like the wheel used to: 60 px per zoom level, capped at four levels
 * per gesture, snapped up to the map's zoomSnap so a small pinch still moves.
 */
export const WHEEL_PX_PER_ZOOM_LEVEL = 60;
/** Leaflet's `wheelDebounceTime`: how long a gesture is allowed to accumulate. */
export const WHEEL_SETTLE_MS = 40;

export function isPinchWheel(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return e.ctrlKey || e.metaKey;
}

/** Zoom-level change for an accumulated wheel delta (positive = zoom in), never more than 4 levels. */
export function zoomStepFor(deltaPx: number, zoomSnap: number): number {
  if (!deltaPx || !Number.isFinite(deltaPx)) return 0;
  const d2 = deltaPx / (WHEEL_PX_PER_ZOOM_LEVEL * 4);
  const d3 = (4 * Math.log(2 / (1 + Math.exp(-Math.abs(d2))))) / Math.LN2;
  const d4 = zoomSnap ? Math.ceil(d3 / zoomSnap) * zoomSnap : d3;
  return deltaPx > 0 ? d4 : -d4;
}
