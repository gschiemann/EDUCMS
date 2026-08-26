/**
 * Deleting the plan you're standing on must leave the drawer showing
 * something real (2026-08-25).
 *
 * The emergency page mounts the floor-plan drawer inline, so the delete now
 * happens right there. The failure mode this guards is the pane going blank
 * — or worse, re-selecting the id that was just removed and rendering
 * "Floor plan not found" while the list refetches.
 */

import { selectionAfterPlans } from '../plan-selection';

const A = { id: 'plan-a' };
const B = { id: 'plan-b' };
const C = { id: 'plan-c' };

describe('selectionAfterPlans', () => {
  it('picks the first plan when nothing is selected yet', () => {
    expect(selectionAfterPlans([A, B], null)).toBe('plan-a');
  });

  it('leaves a valid selection alone', () => {
    expect(selectionAfterPlans([A, B, C], 'plan-b')).toBe('plan-b');
  });

  it('falls to the first remaining plan when the selected one is deleted', () => {
    // 'plan-b' was deleted and retired from the list by the host.
    expect(selectionAfterPlans([A, C], 'plan-b')).toBe('plan-a');
  });

  it('keeps the other plans selectable when the FIRST one is deleted', () => {
    expect(selectionAfterPlans([B, C], 'plan-a')).toBe('plan-b');
  });

  it('drops to the empty state when the last plan is deleted', () => {
    // null = render "add your first floor plan", never a blank pane.
    expect(selectionAfterPlans([], 'plan-a')).toBeNull();
  });

  it('stays on the empty state while there are no plans', () => {
    expect(selectionAfterPlans([], null)).toBeNull();
  });
});
