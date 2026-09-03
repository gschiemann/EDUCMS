import React, { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
