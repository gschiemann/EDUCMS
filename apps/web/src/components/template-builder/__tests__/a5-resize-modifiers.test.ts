/**
 * A5 regression spec (Wave A — "Crush Canva", 2026-07-02).
 *
 * Pre-fix, the resize branch of the drag effect applied raw dx/dy per
 * handle with no e.shiftKey / e.altKey handling — a corner drag on a
 * logo or image zone freely distorted the box, and there was no way to
 * resize symmetrically around center. Post-fix, resizeWithModifiers()
 * implements:
 *   - corner handles on IMAGE/LOGO/VIDEO keep aspect by DEFAULT
 *   - shift toggles the lock (media: releases; other types: engages)
 *   - alt mirrors the delta around the zone center (any handle/type)
 */
import { resizeWithModifiers } from '../BuilderCanvas';

const noMods = { shiftKey: false, altKey: false };
const shift = { shiftKey: true, altKey: false };
const alt = { shiftKey: false, altKey: true };

describe('A5 — resize modifiers', () => {
  const img = { x: 10, y: 10, width: 40, height: 20 }; // 2:1 aspect

  it('IMAGE corner drag keeps aspect ratio by default (no modifier held)', () => {
    // Drag se corner +10% horizontally, +1% vertically → width is the
    // dominant axis, height must follow the 2:1 ratio.
    const r = resizeWithModifiers(img, 'IMAGE', 'se', 10, 1, noMods);
    expect(r).not.toBeNull();
    expect(r!.width).toBeCloseTo(50, 5);
    expect(r!.height).toBeCloseTo(25, 5); // 2:1 preserved
    // se anchor: top-left corner fixed.
    expect(r!.x).toBe(10);
    expect(r!.y).toBe(10);
  });

  it('shift on an IMAGE corner RELEASES the lock (falls through to the plain path)', () => {
    const r = resizeWithModifiers(img, 'IMAGE', 'se', 10, 1, shift);
    expect(r).toBeNull(); // null → caller runs the unconstrained resize + snap
  });

  it('TEXT corner drag is unconstrained by default, shift ENGAGES the lock', () => {
    expect(resizeWithModifiers(img, 'TEXT', 'se', 10, 1, noMods)).toBeNull();

    const locked = resizeWithModifiers(img, 'TEXT', 'se', 10, 1, shift);
    expect(locked).not.toBeNull();
    expect(locked!.width).toBeCloseTo(50, 5);
    expect(locked!.height).toBeCloseTo(25, 5);
  });

  it('side handles never aspect-lock (media default applies to corners only)', () => {
    expect(resizeWithModifiers(img, 'IMAGE', 'e', 10, 0, noMods)).toBeNull();
    expect(resizeWithModifiers(img, 'IMAGE', 's', 0, 5, noMods)).toBeNull();
  });

  it('nw corner drag anchors the OPPOSITE (bottom-right) corner', () => {
    // Drag nw corner by (-10, x) → grow left/up; bottom-right must stay
    // at (50, 30).
    const r = resizeWithModifiers(img, 'IMAGE', 'nw', -10, -1, noMods);
    expect(r).not.toBeNull();
    expect(r!.width).toBeCloseTo(50, 5);
    expect(r!.height).toBeCloseTo(25, 5);
    expect(r!.x + r!.width).toBeCloseTo(50, 5);   // right edge fixed
    expect(r!.y + r!.height).toBeCloseTo(30, 5);  // bottom edge fixed
  });

  it('alt resizes from center — the zone center stays fixed and the delta mirrors', () => {
    // TEXT east-side drag +5 with alt: width grows by 2*5, center fixed.
    const r = resizeWithModifiers(img, 'TEXT', 'e', 5, 0, alt);
    expect(r).not.toBeNull();
    expect(r!.width).toBeCloseTo(50, 5); // 40 + 2*5
    expect(r!.height).toBeCloseTo(20, 5);
    const origCx = img.x + img.width / 2;
    const origCy = img.y + img.height / 2;
    expect(r!.x + r!.width / 2).toBeCloseTo(origCx, 5);
    expect(r!.y + r!.height / 2).toBeCloseTo(origCy, 5);
  });

  it('alt + default aspect lock combine: media corner drag scales proportionally around center', () => {
    const r = resizeWithModifiers(img, 'VIDEO', 'se', 10, 0, alt);
    expect(r).not.toBeNull();
    // width dominant: 40 + 2*10 = 60 → scale 1.5 → height 30.
    expect(r!.width).toBeCloseTo(60, 5);
    expect(r!.height).toBeCloseTo(30, 5);
    expect(r!.x + r!.width / 2).toBeCloseTo(30, 5); // center preserved
    expect(r!.y + r!.height / 2).toBeCloseTo(20, 5);
  });

  it('aspect-locked shrink floors at the 3% minimum without breaking the ratio', () => {
    // Massive inward drag would take width negative; the scale floors so
    // BOTH dims stay >= 3 and the ratio holds.
    const r = resizeWithModifiers(img, 'IMAGE', 'se', -100, -100, noMods);
    expect(r).not.toBeNull();
    expect(r!.width).toBeGreaterThanOrEqual(3);
    expect(r!.height).toBeGreaterThanOrEqual(3);
    expect(r!.width / r!.height).toBeCloseTo(2, 5);
  });

  it('returns null for a plain unmodified drag on a non-media zone (pre-A5 path untouched)', () => {
    expect(resizeWithModifiers(img, 'CLOCK', 'se', 4, 4, noMods)).toBeNull();
    expect(resizeWithModifiers(img, 'CLOCK', 'e', 4, 0, noMods)).toBeNull();
  });
});
