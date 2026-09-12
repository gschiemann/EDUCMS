/**
 * M0-7 (2026-09-12) — the Delete affordance must not LIE about the lock.
 *
 * The store now refuses to delete a locked zone. That alone would leave the
 * layers-panel trash icon fully enabled and doing nothing when clicked, which
 * is the "control that lies" class this wave exists to remove — the operator
 * clicks Delete, the zone stays, and nothing explains why.
 *
 * So the button is DISABLED for a locked zone (no new control was added; the
 * Lock toggle one slot to its left is still the way out). This test pins both
 * halves: the disabled state AND that unlocking restores a working Delete.
 */
import { render, screen, fireEvent, act } from '@testing-library/react';
import { LayersPanel } from '../LayersPanel';
import { useBuilderStore } from '../useBuilderStore';
import type { Zone } from '../types';

jest.mock('@/hooks/use-api', () => ({
  useTouchAggregate: () => ({ data: undefined }),
}));

function makeZone(over: Partial<Zone>): Zone {
  return {
    id: 'z', name: 'Zone', widgetType: 'TEXT',
    x: 10, y: 10, width: 20, height: 10,
    zIndex: 1, sortOrder: 0, defaultConfig: {},
    ...over,
  };
}

function initStore(zones: Zone[]) {
  useBuilderStore.getState().init({
    id: 't1',
    isSystem: false,
    zones,
    meta: { name: 'T', description: '', screenWidth: 1920, screenHeight: 1080, bgColor: '', bgGradient: '', bgImage: '' },
    isTouchEnabled: false,
    idleResetMs: 60000,
    scenes: [],
  });
}

describe('M0-7 — the layers-panel Delete button tells the truth about the lock', () => {
  it('is DISABLED on a locked zone, and says why', () => {
    initStore([makeZone({ id: 'pinned', name: 'Sponsor strip', locked: true })]);
    render(<LayersPanel />);

    const btn = screen.getByLabelText('Sponsor strip is locked — unlock it to delete');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Locked — unlock to delete');
  });

  it('is ENABLED on an unlocked zone and still deletes it (no regression)', () => {
    initStore([makeZone({ id: 'a', name: 'Headline' })]);
    render(<LayersPanel />);

    const btn = screen.getByLabelText('Delete Headline');
    expect(btn).not.toBeDisabled();

    act(() => { fireEvent.click(btn); });
    expect(useBuilderStore.getState().zones).toEqual([]);
  });

  it('unlocking through the panel re-enables Delete — the lock is reversible in one click', () => {
    initStore([makeZone({ id: 'pinned', name: 'Sponsor strip', locked: true })]);
    render(<LayersPanel />);

    expect(screen.getByLabelText('Sponsor strip is locked — unlock it to delete')).toBeDisabled();

    act(() => { fireEvent.click(screen.getByLabelText('Unlock Sponsor strip')); });

    const btn = screen.getByLabelText('Delete Sponsor strip');
    expect(btn).not.toBeDisabled();
    act(() => { fireEvent.click(btn); });
    expect(useBuilderStore.getState().zones).toEqual([]);
  });
});
