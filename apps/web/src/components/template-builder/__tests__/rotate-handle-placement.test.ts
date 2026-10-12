import { rotateHandlePlacement } from '../SelectionChrome';

describe('rotate knob is never clipped by the canvas (2026-10-12)', () => {
  it('normal zone with room below: below, outside', () => {
    expect(rotateHandlePlacement({ y: 10, height: 40 }, 0)).toEqual({ side: 'bottom', inside: false });
  });
  it('zone touching the bottom edge: goes above', () => {
    expect(rotateHandlePlacement({ y: 50, height: 50 }, 0)).toEqual({ side: 'top', inside: false });
  });
  it('rotated 180° with room below on screen: uses the local TOP (which now faces down)', () => {
    expect(rotateHandlePlacement({ y: 5, height: 80 }, 180)).toEqual({ side: 'top', inside: false });
  });
  it('full-height zone: knob sits inside the edge', () => {
    expect(rotateHandlePlacement({ y: 0, height: 100 }, 0)).toEqual({ side: 'bottom', inside: true });
    expect(rotateHandlePlacement({ y: 0, height: 100 }, 180).inside).toBe(true);
  });
});
