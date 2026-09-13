/**
 * "Zoom in" must actually enlarge the canvas (template-maker audit, 2026-09-13).
 * The frame kept `maxWidth/maxHeight: 100%` at every zoom, so 125 % / 150 % /
 * 200 % changed the label and nothing else. Mutation check: restore the
 * unconditional clamps and the zoom-in cases fail.
 */
import { canvasFrameStyle } from '../canvas-frame-style';

describe('canvasFrameStyle', () => {
  it('at the fit baseline the box fills the area and is clamped to it', () => {
    const s = canvasFrameStyle(16 / 9, 1);
    expect(s.width).toBe('100%');
    expect(s.maxWidth).toBe('100%');
    expect(s.maxHeight).toBe('100%');
    expect(s.aspectRatio).toBe(String(16 / 9));
  });

  it('zoomed OUT stays clamped (it always fits)', () => {
    const s = canvasFrameStyle(16 / 9, 0.5);
    expect(s.width).toBe('50%');
    expect(s.maxWidth).toBe('100%');
  });

  it('zoomed IN grows past the area — no clamps — and centres via auto margins so it scrolls', () => {
    const s = canvasFrameStyle(16 / 9, 1.5);
    expect(s.width).toBe('150%');
    expect(s.maxWidth).toBeUndefined();
    expect(s.maxHeight).toBeUndefined();
    expect(s.margin).toBe('auto');
    expect(s.flexShrink).toBe(0);   // a flex item with flex-shrink 1 would be squeezed back to 100%
  });

  it('portrait designs are height-driven', () => {
    const s = canvasFrameStyle(320 / 1080, 2);
    expect(s.height).toBe('200%');
    expect(s.width).toBeUndefined();
    expect(s.maxHeight).toBeUndefined();
  });
});
