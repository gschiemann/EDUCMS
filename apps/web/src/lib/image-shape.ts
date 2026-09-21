/**
 * The shape of a picture, in a word — for thumbnails that must let an operator
 * tell a portrait slide from a landscape one at a glance.
 *
 * The Asset row stores no dimensions, so callers MEASURE a loaded <img>
 * (`naturalWidth` / `naturalHeight`) and ask here. A 5% band around 1:1 reads
 * as Square, so a 1080×1100 export is not called Portrait. Unknown (0 / NaN,
 * an image that has not loaded) is `null` — say nothing rather than guess.
 */
export type ImageShape = 'Landscape' | 'Portrait' | 'Square';

export function imageShape(width: number, height: number): ImageShape | null {
  if (!(width > 0) || !(height > 0)) return null;
  const r = width / height;
  if (r > 1.05) return 'Landscape';
  if (r < 0.95) return 'Portrait';
  return 'Square';
}
