/**
 * The account switcher must open INTO the viewport, not off the edge of it.
 *
 * 2026-09-03 (operator screenshot, iPhone): the panel was hard-coded
 * `right-0` at BOTH mount points, but the mobile toolbar puts the trigger at
 * the LEFT edge of the screen. Right-anchoring a 280px panel to a ~200px
 * trigger that starts 16px in puts its left edge near -64px, so every account
 * name was clipped ("…anta", "…stin", "…timore"). `max-w` cannot save it: the
 * panel fits the screen, it is simply positioned outside it.
 *
 * Asserted against the SOURCE, the same idiom the player-wiring tests use.
 * Rendering this component needs four hook mocks and a Zustand selector, and
 * a mock that drifts would fail for reasons that have nothing to do with
 * where the panel sits.
 */
import * as fs from 'fs';
import * as path from 'path';

const dir = path.join(__dirname, '..');
const switcher = fs.readFileSync(path.join(dir, 'SchoolSwitcher.tsx'), 'utf8');
const toolbar = fs.readFileSync(path.join(dir, 'TopToolbar.tsx'), 'utf8');

describe('SchoolSwitcher alignment', () => {
  it('takes an align prop and defaults to right — the desktop mount is in the right-hand group', () => {
    expect(switcher).toMatch(/align\s*=\s*'right'/);
  });

  it('maps left to left-0 right-auto, and right to right-0 left-auto', () => {
    expect(switcher).toContain("align === 'left' ? 'left-0 right-auto' : 'right-0 left-auto'");
  });

  it('keeps the panel inside the viewport width at either alignment', () => {
    expect(switcher).toContain('max-w-[calc(100vw-1rem)]');
  });

  it('no longer hard-codes right-0 on the panel', () => {
    expect(switcher).not.toMatch(/absolute right-0 left-auto top-11/);
  });

  it('the mobile toolbar mount opens rightward', () => {
    // The md:hidden mount is the phone one, at the left edge of the bar.
    const mobile = toolbar.slice(toolbar.indexOf('md:hidden min-w-0'));
    const mount = mobile.slice(0, mobile.indexOf('/>') + 2);
    expect(mount).toContain('<SchoolSwitcher align="left"');
  });

  it('the desktop toolbar mount keeps the default right alignment', () => {
    const desktop = toolbar.slice(toolbar.indexOf("'hidden md:block'"));
    expect(desktop.slice(0, desktop.indexOf('/>') + 2)).toMatch(/<SchoolSwitcher\s*\/>/);
  });
});
