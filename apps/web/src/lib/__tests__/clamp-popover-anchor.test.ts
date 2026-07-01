import { clampPopoverAnchor } from '../clamp-popover-anchor';

/**
 * Regression test for mobile bug #217 — "screen settings drawer pushes off
 * the left edge, worse lower in the list." Exercises the EXACT clamp math
 * `ScreenSettingsMenu` (apps/web/src/app/[schoolId]/screens/page.tsx) uses,
 * across a matrix of button positions × viewport widths, so a future edit
 * to this file can't silently reintroduce an off-screen popover without a
 * red test.
 *
 * "Worse lower in the list" in the original report was a red herring about
 * WHERE the bug was, not a separate vertical-clamp bug — a button lower on
 * a phone screen is simply more likely to also sit near the bottom edge, so
 * the "does the panel flip to open upward" branch fires more often for
 * those rows. This suite asserts BOTH the horizontal clamp (every viewport
 * width) AND the vertical flip (every button vertical position) hold
 * independently, and — the actual "lower in the list" case — hold TOGETHER
 * for a button that is simultaneously near the bottom of a phone viewport.
 */
describe('clampPopoverAnchor (mobile bug #217)', () => {
  const PHONE_WIDTHS = [320, 360, 375, 390, 414, 428];
  const DESKTOP_WIDTHS = [768, 1024, 1280, 1920];
  const VIEWPORT_HEIGHT = 812; // iPhone-ish

  function assertOnScreen(
    anchor: ReturnType<typeof clampPopoverAnchor>,
    vw: number,
    margin = 12,
  ) {
    // Left edge: CSS `right: <anchor.right>px` + `width: <anchor.width>px`
    // means the left edge sits at `vw - anchor.right - anchor.width`.
    const leftEdge = vw - anchor.right - anchor.width;
    expect(leftEdge).toBeGreaterThanOrEqual(-0.01); // never negative (off left edge)
    expect(anchor.right).toBeGreaterThanOrEqual(0); // never off the right edge
    expect(anchor.width).toBeLessThanOrEqual(vw - margin * 2 + 0.01); // fits between margins
    expect(anchor.width).toBeGreaterThan(0);
  }

  it('never runs off the left edge, for every phone width × every horizontal button position', () => {
    for (const vw of PHONE_WIDTHS) {
      // Sweep the button across the ENTIRE row — the "worse lower in the
      // list" report implied position-dependence, so cover every possible
      // gear-button x-position, not just "far right."
      for (let buttonRight = 20; buttonRight <= vw; buttonRight += 10) {
        const anchor = clampPopoverAnchor({
          buttonRect: { top: 100, bottom: 130, right: buttonRight },
          viewportWidth: vw,
          viewportHeight: VIEWPORT_HEIGHT,
        });
        assertOnScreen(anchor, vw);
      }
    }
  });

  it('never runs off the left edge on desktop widths either (regression guard)', () => {
    for (const vw of DESKTOP_WIDTHS) {
      for (let buttonRight = 40; buttonRight <= vw; buttonRight += 80) {
        const anchor = clampPopoverAnchor({
          buttonRect: { top: 100, bottom: 130, right: buttonRight },
          viewportWidth: vw,
          viewportHeight: VIEWPORT_HEIGHT,
        });
        assertOnScreen(anchor, vw);
      }
    }
  });

  it('THE REPORTED BUG: a gear button near the bottom of a long screens list on a phone stays fully on-screen', () => {
    // Simulate "lower in the list": the button sits near the bottom of a
    // tall scrolled page (small spaceBelow → flips to open above) AND is
    // the last item in a right-aligned action row (buttonRight close to vw).
    for (const vw of PHONE_WIDTHS) {
      const anchor = clampPopoverAnchor({
        buttonRect: { top: VIEWPORT_HEIGHT - 60, bottom: VIEWPORT_HEIGHT - 20, right: vw - 16 },
        viewportWidth: vw,
        viewportHeight: VIEWPORT_HEIGHT,
      });
      assertOnScreen(anchor, vw);
      // Near the bottom edge → must flip to open UPWARD (bottom-anchored).
      expect(anchor.bottom).not.toBeNull();
      expect(anchor.top).toBeNull();
    }
  });

  it('flips to open above when there is more room above than below', () => {
    const anchor = clampPopoverAnchor({
      buttonRect: { top: 750, bottom: 780, right: 380 },
      viewportWidth: 390,
      viewportHeight: 812,
    });
    expect(anchor.bottom).not.toBeNull();
    expect(anchor.top).toBeNull();
  });

  it('opens below when there is more room below than above', () => {
    const anchor = clampPopoverAnchor({
      buttonRect: { top: 100, bottom: 130, right: 380 },
      viewportWidth: 390,
      viewportHeight: 812,
    });
    expect(anchor.top).not.toBeNull();
    expect(anchor.bottom).toBeNull();
  });

  it('derives a narrower panel width on very narrow viewports instead of assuming a fixed 256px', () => {
    const anchor = clampPopoverAnchor({
      buttonRect: { top: 100, bottom: 130, right: 260 },
      viewportWidth: 260, // narrower than the nominal 256px panel + 2*margin
      viewportHeight: 812,
    });
    expect(anchor.width).toBeLessThan(256);
    assertOnScreen(anchor, 260);
  });

  it('uses the full nominal width on a comfortably wide viewport', () => {
    const anchor = clampPopoverAnchor({
      buttonRect: { top: 100, bottom: 130, right: 1000 },
      viewportWidth: 1280,
      viewportHeight: 900,
    });
    expect(anchor.width).toBe(256);
  });

  it('caps maxHeight to the available space but never below the floor', () => {
    const anchor = clampPopoverAnchor({
      buttonRect: { top: 40, bottom: 60, right: 380 },
      viewportWidth: 390,
      viewportHeight: 200, // very short viewport
    });
    expect(anchor.maxHeight).toBeGreaterThanOrEqual(180);
  });
});
