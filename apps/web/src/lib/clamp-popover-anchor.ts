/**
 * clampPopoverAnchor — pure viewport-clamping math for a gear-anchored
 * popover (e.g. ScreenSettingsMenu on the Screens page). Extracted out of
 * the page component (2026-07-01, mobile bug #217) so the clamp math is
 * independently unit-testable — the page component pulls in the full
 * dashboard hook/query graph, which makes it impractical to render in
 * isolation for a regression test.
 *
 * THE BUG THIS GUARDS (2026-06-27, `d84001e6`, "worse lower in the list")
 *   The popover is right-aligned to its trigger button, but on a phone the
 *   clamp math assumed the rendered menu was always exactly 256px wide —
 *   on sub-280px viewports (small Androids, browser zoom, iPhone landscape
 *   split-view) the derived left edge went negative and the panel ran off
 *   the left of the screen. Reports got WORSE the lower a screen sat in the
 *   list only because those buttons are more likely to also be close to the
 *   viewport's bottom edge, which flips the popover to open upward — a
 *   change that's independent of (and must not break) the horizontal clamp.
 *
 * `d84001e6` fixed this by deriving the panel width from the viewport
 * instead of assuming a fixed 256px, then clamping `right` so the
 * left edge can never go negative. This module is that exact fix,
 * extracted verbatim so a regression test can assert it holds for every
 * button position × every viewport width, not just the handful eyeballed
 * in a manual pass.
 */

export interface PopoverAnchor {
  top: number | null;
  bottom: number | null;
  right: number;
  width: number;
  maxHeight: number;
}

export interface ClampPopoverAnchorInput {
  /** Trigger button's viewport-relative rect (from getBoundingClientRect()). */
  buttonRect: { top: number; bottom: number; right: number };
  viewportWidth: number;
  viewportHeight: number;
  /** Nominal (desktop) panel width in px. Defaults to 256 (Tailwind w-64). */
  nominalWidth?: number;
  /** Gap between the trigger and the popover. Defaults to 8px. */
  gap?: number;
  /** Minimum distance the popover must keep from any viewport edge. Defaults to 12px. */
  margin?: number;
  /** Viewport width below which we switch to the "phone" horizontal
   *  anchoring strategy (center-ish instead of pure right-align). Defaults
   *  to 500px. */
  phoneBreakpoint?: number;
  /** Floor for maxHeight so the popover never collapses to an unusable
   *  sliver on a very short viewport. Defaults to 180px. */
  minHeight?: number;
}

export function clampPopoverAnchor({
  buttonRect,
  viewportWidth: vw,
  viewportHeight: vh,
  nominalWidth = 256,
  gap: GAP = 8,
  margin: MARGIN = 12,
  phoneBreakpoint = 500,
  minHeight = 180,
}: ClampPopoverAnchorInput): PopoverAnchor {
  const r = buttonRect;

  // The menu is nominally 256px (w-64) but on very narrow viewports a fixed
  // 256px panel can't fit between two MARGINs — so DERIVE the actual width
  // from the viewport and pin it explicitly.
  const MENU_WIDTH = Math.min(nominalWidth, vw - MARGIN * 2);

  // Right-align the menu with the gear button, but CLAMP so the panel is
  // ALWAYS fully on-screen — at any width, regardless of where the gear
  // sits in the row. `right` is measured from the viewport's RIGHT edge.
  let right = vw - r.right;
  if (vw < phoneBreakpoint) {
    // Phone width — gear-anchored right-alignment can leave the panel
    // partly off-screen even after edge-clamping. Center-ish anchor it so
    // it always reads fully on-screen no matter where the gear sits.
    right = Math.max(MARGIN, Math.min(vw / 2, vw - MENU_WIDTH - MARGIN));
  } else {
    // Clamp: ensure left edge = vw - right - MENU_WIDTH >= MARGIN
    const maxRight = vw - MENU_WIDTH - MARGIN;
    if (right > maxRight) right = maxRight;
    // Also keep the right edge at least MARGIN from the viewport right.
    if (right < MARGIN) right = MARGIN;
  }
  // Final defensive clamp — guarantees the LEFT edge is on-screen no matter
  // what (vw - right - MENU_WIDTH >= MARGIN). Belt-and-suspenders so a stale
  // measurement during a reflow can never park the panel off the edge.
  right = Math.min(right, Math.max(MARGIN, vw - MENU_WIDTH - MARGIN));

  const spaceBelow = vh - r.bottom - GAP - MARGIN;
  const spaceAbove = r.top - GAP - MARGIN;
  // Open on whichever side has more room, and cap the height to that space
  // so the menu ALWAYS fits on screen (it scrolls internally past the cap).
  if (spaceBelow >= spaceAbove) {
    return {
      top: r.bottom + GAP,
      bottom: null,
      right,
      width: MENU_WIDTH,
      maxHeight: Math.max(minHeight, spaceBelow),
    };
  }
  return {
    top: null,
    bottom: vh - r.top + GAP,
    right,
    width: MENU_WIDTH,
    maxHeight: Math.max(minHeight, spaceAbove),
  };
}
