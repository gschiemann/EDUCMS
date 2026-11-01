/**
 * An Info banner PUSHES the content down instead of covering it (2026-10-26).
 *
 * The owner, on site: "for info it would be great if it pushed the current
 * content below the banner so it doesnt cover the content playing at all."
 *
 * HOW IT WORKS. The Info banner (`EmergencyOverlay`, `isBanner`) measures its
 * own height and publishes it on <html>:
 *
 *     data-edu-banner-push="on"      the push is in force
 *     --edu-banner-h: 96px           how far down the content starts
 *     --edu-stage-h:  1080px         the height of the stage it is measured against
 *
 * and one rule in `player/layout.tsx` — the ONLY place the content roots are
 * touched — moves every `[data-edu-player-root]` (template, media, tiles) to
 * `top: var(--edu-banner-h)` with the height reduced by the same amount. The
 * roots' own ResizeObserver (the template scaler) then re-fits the content into
 * what is left, so it SHRINKS to the space under the banner rather than being
 * cropped. When the banner clears the variable returns to 0 first and the mark
 * is removed once the roots have glided back (`BANNER_PUSH_RELEASE_MS`).
 *
 * WHY NOT CHANGE THE ROOTS IN page.tsx. Three different roots build their own
 * geometry from the canvas (`--led-w/--led-h`), the face stage and the LED
 * override; a single stylesheet rule keyed on the mark composes with all of
 * them and leaves the 16 000-line page untouched. A page with no banner
 * carries neither the attribute nor the rule's effect — byte-for-byte today.
 *
 * TAURUS (CLAUDE.md rule #10): `top` + an explicit `height` (calc of two
 * pixel variables) — never the four-side shorthand (`in-set`), no flex `gap`. The value is
 * ALWAYS an integer ≥ 1 while pushing, so a root's style attribute can never
 * serialize to something that begins the zero four-side shorthand and collide with the
 * Chromium-83 polyfill's substring selector.
 *
 * PURE where it can be: the numbers are plain functions; the DOM writes take
 * the element they write to, so a unit test drives them on a detached node.
 */

export const BANNER_PUSH_ATTR = 'data-edu-banner-push';
export const BANNER_HEIGHT_VAR = '--edu-banner-h';
export const STAGE_HEIGHT_VAR = '--edu-stage-h';

/** How long the roots take to glide back after the banner clears (matches the CSS transition). */
export const BANNER_PUSH_RELEASE_MS = 260;

/** What the roots should be offset by for a measured banner: a whole pixel count, at least 1. */
export function bannerOffsetPx(measured: number | null | undefined): number {
  if (typeof measured !== 'number' || !Number.isFinite(measured) || measured <= 0) return 0;
  return Math.max(1, Math.ceil(measured));
}

/**
 * The stage height the roots are sized against — the same precedence the
 * banner's own width uses: the face stage, then the LED canvas override, then
 * the canonical canvas var the pin script publishes, then the viewport.
 */
export function stageHeightPx(sources: {
  faceStageHeight?: number | null;
  canvasHeight?: number | null;
  cssLedHeight?: string | number | null;
  viewportHeight: number;
}): number {
  const positive = (v: unknown): number | null => {
    const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  return (
    positive(sources.faceStageHeight) ??
    positive(sources.canvasHeight) ??
    positive(sources.cssLedHeight) ??
    Math.max(1, Math.round(sources.viewportHeight))
  );
}

let releaseTimer: ReturnType<typeof setTimeout> | null = null;

/** Put the push in force (or re-measure it). `bannerPx` ≤ 0 is treated as "no banner". */
export function applyBannerPush(root: HTMLElement, bannerPx: number, stagePx: number): void {
  const offset = bannerOffsetPx(bannerPx);
  if (offset <= 0) {
    clearBannerPush(root, false);
    return;
  }
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  root.style.setProperty(STAGE_HEIGHT_VAR, `${Math.max(offset + 1, Math.round(stagePx))}px`);
  root.style.setProperty(BANNER_HEIGHT_VAR, `${offset}px`);
  root.setAttribute(BANNER_PUSH_ATTR, 'on');
}

/**
 * Release the push. `glide` (default) sets the offset back to 0 FIRST so the
 * roots animate home, then drops the mark; without it the mark goes at once.
 */
export function clearBannerPush(root: HTMLElement, glide = true): void {
  if (releaseTimer) {
    clearTimeout(releaseTimer);
    releaseTimer = null;
  }
  if (!root.hasAttribute(BANNER_PUSH_ATTR)) return;
  const finish = () => {
    releaseTimer = null;
    root.removeAttribute(BANNER_PUSH_ATTR);
    root.style.removeProperty(BANNER_HEIGHT_VAR);
    root.style.removeProperty(STAGE_HEIGHT_VAR);
  };
  if (!glide) {
    finish();
    return;
  }
  root.style.setProperty(BANNER_HEIGHT_VAR, '0px');
  releaseTimer = setTimeout(finish, BANNER_PUSH_RELEASE_MS);
}
