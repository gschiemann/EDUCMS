/**
 * mediaFit — how full-screen playlist media meets a screen of another shape
 * (2026-10-11, owner decision).
 *
 * Until now every playlist picture and video was drawn `object-fit: fill`:
 * the file's corners pinned to the screen's corners. A file of the screen's
 * exact shape looked perfect; any other shape was STRETCHED — a 1080×1668
 * portrait clip on a 1080×1920 panel was pulled ~15 % taller, faces and logos
 * visibly distorted.
 *
 * Greg's rule: media that is not the screen's exact shape must FILL the screen
 * WITHOUT stretching. That is `object-fit: cover`, centred — the picture keeps
 * its proportions, covers the whole screen edge to edge, and the overhang on
 * the long axis is trimmed equally from both sides. A file of the screen's
 * exact shape is pixel-identical under `fill` and `cover`, so correctly-made
 * content does not change at all.
 *
 * SCOPE. Only the DEFAULT for full-screen playlist media changes. There is no
 * per-item fit setting on a playlist item today (PlaylistItem has no such
 * column); widgets inside templates keep their own fit config untouched.
 *
 * EMERGENCY PLAYLISTS ARE UNCHANGED (still `fill`). Cropping can cut words
 * off the edge of a lockdown / evacuation slide, and emergency rendering
 * changes need explicit sign-off (CLAUDE.md, Emergency System). The emergency
 * overlay's own inline media (EmergencyOverlay.tsx) was already `cover`.
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

/** The default for full-screen playlist media: crop to fill, centred, never stretch. */
export const DEFAULT_PLAYLIST_MEDIA_FIT: MediaFit = 'cover';

/** An emergency playlist keeps the historical `fill` (no crop) pending owner sign-off. */
// 2026-10-11 (owner decision): an alert is shown WHOLE — fitted with bars where
// the file's shape differs from the screen — never cropped (cropping can cut an
// instruction off the edge) and never stretched (the old `fill`).
export const EMERGENCY_PLAYLIST_MEDIA_FIT: MediaFit = 'contain';

export function playlistMediaFit(isEmergency: boolean): MediaFit {
  return isEmergency ? EMERGENCY_PLAYLIST_MEDIA_FIT : DEFAULT_PLAYLIST_MEDIA_FIT;
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
 * a boxW×boxH box. With `fill`, or with no usable box, it is the whole source.
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
