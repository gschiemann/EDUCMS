/**
 * Pure zone geometry helpers for the Properties panel's one-tap layout buttons.
 *
 * "Fit Height" (Codex T07, 2026-09-13): the old formula set the width to
 * `height × canvasAspect` — it ignored the zone's own width entirely, so a
 * narrow logo and a wide banner got the same result. Fit to the full canvas
 * height while keeping the zone's OWN aspect ratio (all values are canvas
 * percentages, so width% / height% is the aspect in canvas units); a zone
 * wider than the canvas at full height is clamped to 100% (cropped), never
 * pushed off-canvas.
 */
export function fitHeightGeometry(zone: { width: number; height: number }): { x: number; y: number; width: number; height: number } {
  const h = Math.max(zone.height, 0.01);
  const width = Math.max(3, Math.min(100, (zone.width / h) * 100));
  return { x: (100 - width) / 2, y: 0, width, height: 100 };
}

/** Resize in the selection's local axes, keeping the opposite rotated edge anchored. */
export function rotateResizeFrame(
  original: { x: number; y: number; width: number; height: number },
  resized: { x: number; y: number; width: number; height: number },
  degrees: number,
  canvas: { width: number; height: number },
) {
  const angle = degrees * Math.PI / 180;
  const dx = (resized.x + resized.width / 2 - original.x - original.width / 2) / 100 * canvas.width;
  const dy = (resized.y + resized.height / 2 - original.y - original.height / 2) / 100 * canvas.height;
  return {
    ...resized,
    x: original.x + original.width / 2 + (dx * Math.cos(angle) - dy * Math.sin(angle)) / canvas.width * 100 - resized.width / 2,
    y: original.y + original.height / 2 + (dx * Math.sin(angle) + dy * Math.cos(angle)) / canvas.height * 100 - resized.height / 2,
  };
}
