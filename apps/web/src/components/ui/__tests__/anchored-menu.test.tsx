import React, { useRef, useState } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AnchoredMenu, placeAnchoredMenu } from '../anchored-menu';

describe('placeAnchoredMenu — the rule that keeps a menu on screen', () => {
  const vp = { width: 1280, height: 800 };
  const panel = { width: 208, height: 140 };

  it('opens below, right-aligned to the trigger, when there is room', () => {
    expect(placeAnchoredMenu({ top: 100, bottom: 132, right: 900 }, panel, vp)).toEqual({ top: 136, left: 692 });
  });

  it('flips above when the panel would cross the bottom of the viewport', () => {
    // Trigger 40px from the bottom: below would end at 904 > 792.
    const p = placeAnchoredMenu({ top: 728, bottom: 760, right: 900 }, panel, vp);
    expect(p.top).toBe(728 - 4 - 140);
  });

  it('stays below when there is no room above either (tiny viewport)', () => {
    const p = placeAnchoredMenu({ top: 20, bottom: 52, right: 900 }, panel, { width: 1280, height: 150 });
    expect(p.top).toBe(56);
  });

  it('clamps inside the viewport horizontally', () => {
    expect(placeAnchoredMenu({ top: 100, bottom: 132, right: 100 }, panel, vp).left).toBe(8);
    expect(placeAnchoredMenu({ top: 100, bottom: 132, right: 1279 }, panel, vp).left).toBe(1280 - 208 - 8);
  });

  // align="left" — the shape TimeField/DateField need: a panel that drops
  // from a full-width field starts where the FIELD starts.
  it('lines up with the anchor’s left edge when asked', () => {
    expect(placeAnchoredMenu({ top: 100, bottom: 132, right: 900, left: 600 }, panel, vp, 'left')).toEqual({
      top: 136,
      left: 600,
    });
  });

  it('still clamps at the right viewport edge when left-aligned', () => {
    // A wide field near the right edge: its left is 1200, but a 208px panel
    // starting there would run 128px off screen.
    expect(
      placeAnchoredMenu({ top: 100, bottom: 132, right: 1270, left: 1200 }, panel, vp, 'left').left,
    ).toBe(1280 - 208 - 8);
  });

  it('still clamps at the left viewport edge when left-aligned', () => {
    expect(placeAnchoredMenu({ top: 100, bottom: 132, right: 200, left: -40 }, panel, vp, 'left').left).toBe(8);
  });

  it('defaults to right alignment, so the existing callers are byte-identical', () => {
    const anchor = { top: 100, bottom: 132, right: 900, left: 600 };
    expect(placeAnchoredMenu(anchor, panel, vp)).toEqual(placeAnchoredMenu(anchor, panel, vp, 'right'));
    expect(placeAnchoredMenu(anchor, panel, vp).left).toBe(692);
  });

  it('flips above the same way when left-aligned', () => {
    const p = placeAnchoredMenu({ top: 728, bottom: 760, right: 900, left: 600 }, panel, vp, 'left');
    expect(p).toEqual({ top: 728 - 4 - 140, left: 600 });
  });
});

function Harness() {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div style={{ overflow: 'hidden', height: 40 }} data-testid="clipper">
      <button ref={ref} data-popover-trigger onClick={() => setOpen((v) => !v)}>
        More
      </button>
      <AnchoredMenu anchorRef={ref} open={open} ariaLabel="Row actions">
        <button type="button">Open details</button>
        <button type="button">Settings</button>
      </AnchoredMenu>
    </div>
  );
}

describe('AnchoredMenu — escapes clipping ancestors', () => {
  it('renders into document.body with fixed positioning and the popover marker', () => {
    render(<Harness />);
    expect(screen.queryByRole('group')).toBeNull();
    fireEvent.click(screen.getByText('More'));
    const menu = screen.getByRole('group', { name: 'Row actions' });
    // Not inside the overflow-hidden wrapper — a direct child of body.
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByTestId('clipper').contains(menu)).toBe(false);
    expect(menu.style.position).toBe('fixed');
    expect(menu.getAttribute('data-popover-panel')).not.toBeNull();
    // Items are reachable and the outside-click rule can still see them as "inside".
    expect(screen.getByText('Settings').closest('[data-popover-panel]')).toBe(menu);
    fireEvent.click(screen.getByText('More'));
    expect(screen.queryByRole('group')).toBeNull();
  });
});

/**
 * `onPlaced` exists because the FIRST paint is `visibility: hidden` at 0,0
 * while the panel is measured, and focus cannot enter a visibility:hidden
 * subtree — so a caller that focuses panel content on `open` calls `.focus()`
 * into a silent no-op. These tests pin the two properties that makes it a
 * usable signal: it fires only once the panel is really visible, and exactly
 * once per open.
 */
function PlacedHarness({ onPlaced }: { onPlaced: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button ref={ref} data-popover-trigger onClick={() => setOpen((v) => !v)}>
        Toggle
      </button>
      <AnchoredMenu anchorRef={ref} open={open} onPlaced={onPlaced} ariaLabel="Panel">
        <button type="button">Item</button>
      </AnchoredMenu>
    </div>
  );
}

describe('AnchoredMenu — onPlaced', () => {
  let rect = { top: 100, bottom: 132, left: 600, right: 900, width: 300, height: 32 };
  let spy: jest.SpyInstance;

  beforeEach(() => {
    rect = { top: 100, bottom: 132, left: 600, right: 900, width: 300, height: 32 };
    spy = jest
      .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockImplementation(() => ({ ...rect, x: rect.left, y: rect.top, toJSON: () => ({}) }) as DOMRect);
  });
  afterEach(() => spy.mockRestore());

  it('fires once the panel is placed — and by then it is NOT visibility:hidden', () => {
    const seen: Array<string | undefined> = [];
    const onPlaced = jest.fn(() => {
      const panel = document.querySelector('[data-popover-panel]') as HTMLElement | null;
      seen.push(panel?.style.visibility);
    });
    render(<PlacedHarness onPlaced={onPlaced} />);
    expect(onPlaced).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Toggle'));
    expect(onPlaced).toHaveBeenCalledTimes(1);
    // The whole point: a caller may focus panel content from here.
    expect(seen).toEqual(['']);
  });

  it('does NOT fire again when a scroll re-places the panel', () => {
    const onPlaced = jest.fn();
    render(<PlacedHarness onPlaced={onPlaced} />);
    fireEvent.click(screen.getByText('Toggle'));
    expect(onPlaced).toHaveBeenCalledTimes(1);
    const panel = document.querySelector('[data-popover-panel]') as HTMLElement;
    const before = panel.style.top;

    // Move the anchor so the recompute genuinely produces a new placement —
    // a test where nothing moves would pass even if the guard were missing.
    act(() => {
      rect = { ...rect, top: 300, bottom: 332 };
      window.dispatchEvent(new Event('scroll', { bubbles: true }));
    });
    expect((document.querySelector('[data-popover-panel]') as HTMLElement).style.top).not.toBe(before);
    expect(onPlaced).toHaveBeenCalledTimes(1);
  });

  it('fires again on the NEXT open', () => {
    const onPlaced = jest.fn();
    render(<PlacedHarness onPlaced={onPlaced} />);
    fireEvent.click(screen.getByText('Toggle'));
    fireEvent.click(screen.getByText('Toggle')); // close
    fireEvent.click(screen.getByText('Toggle')); // open again
    expect(onPlaced).toHaveBeenCalledTimes(2);
  });

  it('is optional — the existing callers pass nothing', () => {
    expect(() => {
      render(<Harness />);
      fireEvent.click(screen.getByText('More'));
    }).not.toThrow();
    expect(screen.getByRole('group', { name: 'Row actions' })).toBeInTheDocument();
  });
});
