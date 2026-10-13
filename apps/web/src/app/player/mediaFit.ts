/**
 * mediaFit — how full-screen playlist media meets a screen of another shape
 * (2026-10-13, owner decision).
 *
 * The former `cover` default cropped files whose shape differed from the
 * screen. Even the near-match 1080×1668 portrait clip on a 1080×1920 panel
 * loses part of its width, including edge logos and faces. Unknown dimensions
 * also cannot prove that cropping is safe.
 *
 * Default full-screen playlist media shows the whole file without stretching:
 * `object-fit: contain`, centred, with bars where the shapes differ. This is
 * safe for close, mismatched, and unknown aspect ratios. A narrowly scoped
 * manifest pilot may opt normal full-screen media into `fill`; invalid values
 * leave the default unchanged.
 *
 * SCOPE. Only the DEFAULT for full-screen playlist media changes. There is no
 * per-item fit setting on a playlist item today (PlaylistItem has no such
 * column); widgets inside templates keep their own fit config untouched.
 *
 * Emergency playlists remain `contain`; cropping can cut words off the edge
 * of a lockdown / evacuation slide. Emergency endpoints and safeguards are
 * untouched. The emergency overlay's own inline media is also unchanged.
 *
 * Every player media path takes its fit from here so they can never disagree:
 * the single-element video + image slides (page.tsx), the two-deck loop
 * (SeamlessLoopVideo), the continuous MSE loop and its held recovery frame
 * (ContinuousLoopVideo), the decoded-frame playlist hand-off
 * (PlaylistVideoDeck), the native shared-video hold canvas (NativeDualVideo)
 * and the off-hours update cover frame (updateCover.ts captures exactly the
 * region `cover` shows).
 *
 * Chromium 83 (Taurus) supports object-fit / object-position, so this needs no
 * fallback — and no `inset` shorthand is involved.
 */

export type MediaFit = 'cover' | 'contain' | 'fill';

/** The default for full-screen playlist media: show the whole file, centred. */
export const DEFAULT_PLAYLIST_MEDIA_FIT: MediaFit = 'contain';

/** Emergency media also shows the whole frame; alerts must not lose instructions to cropping. */
export const EMERGENCY_PLAYLIST_MEDIA_FIT: MediaFit = 'contain';

export function playlistMediaFit(isEmergency: boolean, override?: unknown): MediaFit {
  if (isEmergency) return EMERGENCY_PLAYLIST_MEDIA_FIT;
  return override === 'fill' ? 'fill' : DEFAULT_PLAYLIST_MEDIA_FIT;
}

/** Inline style half — inline wins over any utility class on old WebViews. */
export function mediaFitStyle(fit: MediaFit): { objectFit: MediaFit; objectPosition: string } {
  return { objectFit: fit, objectPosition: '50% 50%' };
}

/** Utility-class half, kept in agreement with the inline style. */
export function mediaFitClass(fit: MediaFit): 'object-cover' | 'object-contain' | 'object-fill' {
  return fit === 'cover' ? 'object-cover' : fit === 'contain' ? 'object-contain' : 'object-fill';
}

export interface CropRect { sx: number; sy: number; sw: number; sh: number }

/**
 * The region of a srcW×srcH source that `object-fit: cover` (centred) shows in
 * a boxW×boxH box. With `contain`/`fill`, or with no usable box, it is the whole source.
 * Pure: used by the update cover frame so its picture matches the glass.
 */
export function visibleSourceRect(fit: MediaFit, srcW: number, srcH: number, boxW: number, boxH: number): CropRect {
  const whole = { sx: 0, sy: 0, sw: srcW, sh: srcH };
  if (fit !== 'cover' || !(srcW > 0) || !(srcH > 0) || !(boxW > 0) || !(boxH > 0)) return whole;
  const srcAspect = srcW / srcH;
  const boxAspect = boxW / boxH;
  if (Math.abs(srcAspect - boxAspect) < 1e-6) return whole;
  if (srcAspect > boxAspect) {
    // Source is wider than the box: trim left and right.
    const sw = srcH * boxAspect;
    return { sx: (srcW - sw) / 2, sy: 0, sw, sh: srcH };
  }
  // Source is taller than the box: trim top and bottom.
  const sh = srcW / boxAspect;
  return { sx: 0, sy: (srcH - sh) / 2, sw: srcW, sh };
}

/**
 * Shape-aware fit for an explicit cover choice (owner 2026-10-12: a portrait 1080×1920 clip on a landscape
 * 1920×1080 screen was "crazy zoomed in" under `cover` — it trims ~70 % of the
 * picture). Fill the screen (cover) only when the file's shape is CLOSE to the
 * screen's; when the shapes are far apart (portrait file on a landscape screen
 * or the reverse) show the whole file (contain). Unknown size → the base fit.
 * Emergency is unchanged (always contain).
 */
export const COVER_MAX_ASPECT_MISMATCH = 1.35;

export function shapeAwareFit(
  base: MediaFit,
  mediaW: number | null | undefined,
  mediaH: number | null | undefined,
  screenW: number | null | undefined,
  screenH: number | null | undefined,
): MediaFit {
  if (base !== 'cover') return base;
  if (!mediaW || !mediaH || !screenW || !screenH || mediaW <= 0 || mediaH <= 0 || screenW <= 0 || screenH <= 0) return base;
  const a = mediaW / mediaH;
  const b = screenW / screenH;
  const mismatch = Math.max(a, b) / Math.min(a, b);
  return mismatch <= COVER_MAX_ASPECT_MISMATCH ? 'cover' : 'contain';
}

/** The player's logical canvas shape (body is rotated for portrait-on-landscape). */
export function playerCanvasSize(): { w: number; h: number } | null {
  try {
    const b = typeof document !== 'undefined' ? document.body : null;
    const w = b?.clientWidth || (typeof window !== 'undefined' ? window.innerWidth : 0);
    const h = b?.clientHeight || (typeof window !== 'undefined' ? window.innerHeight : 0);
    return w > 0 && h > 0 ? { w, h } : null;
  } catch {
    return null;
  }
}

/** Fit for one playlist item, using the manifest's media_w/media_h when present. */
export function playlistItemFit(isEmergency: boolean, item: { media_w?: number | null; media_h?: number | null } | null | undefined, override?: unknown): MediaFit {
  const base = playlistMediaFit(isEmergency, override);
  const c = playerCanvasSize();
  return shapeAwareFit(base, item?.media_w, item?.media_h, c?.w, c?.h);
}
