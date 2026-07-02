/**
 * Smart drop sizes — Wave B / editor-crush B6a (2026-07-02).
 *
 * Pins the contract both add gestures (VariantPicker.handlePick click-adds
 * and BuilderShell.handleDragEnd drops) rely on: variant overrides beat the
 * widgetType map, unmapped types return undefined (so addZone's default
 * 40×30 keeps applying — no regression for the long tail), and every
 * Elements-wave tile (SHAPE primitives + DECORATION variants) has a
 * deliberate footprint instead of the generic box.
 */
import { resolveDropSize } from '../drop-sizes';
import { SHAPE_KINDS } from '@/components/widgets/ShapeWidget';
import { DECORATION_VARIANTS } from '@/components/widgets/DecorationWidget';

describe('resolveDropSize', () => {
  it('returns undefined for unmapped types (addZone default applies — no regression)', () => {
    expect(resolveDropSize('BELL_SCHEDULE')).toBeUndefined();
    expect(resolveDropSize(undefined)).toBeUndefined();
    expect(resolveDropSize('SOME_FUTURE_TYPE', 'some-future-variant')).toBeUndefined();
  });

  it('gives the audit call-outs (LOGO / TICKER) natural footprints instead of 40×30', () => {
    expect(resolveDropSize('LOGO')).toEqual({ w: 15, h: 18 });
    expect(resolveDropSize('TICKER')).toEqual({ w: 100, h: 10 });
  });

  it('variant overrides beat the widgetType map (line ≠ rectangle even though both are SHAPE)', () => {
    const line = resolveDropSize('SHAPE', 'shape-line')!;
    const rect = resolveDropSize('SHAPE', 'shape-rectangle')!;
    expect(line).toEqual({ w: 40, h: 4 });
    expect(rect.h).toBeGreaterThan(line.h);
    // Unknown variant falls back to the type default.
    expect(resolveDropSize('SHAPE', 'shape-not-a-thing')).toEqual({ w: 25, h: 25 });
  });

  it('covers every SHAPE primitive and every DECORATION variant with a sane size', () => {
    for (const s of SHAPE_KINDS) {
      const size = resolveDropSize('SHAPE', `shape-${s.key}`)!;
      expect(size.w).toBeGreaterThan(0);
      expect(size.w).toBeLessThanOrEqual(100);
      expect(size.h).toBeGreaterThan(0);
      expect(size.h).toBeLessThanOrEqual(100);
    }
    for (const d of DECORATION_VARIANTS) {
      const size = resolveDropSize('DECORATION', `decoration-${d.key}`)!;
      expect(size.w).toBeGreaterThan(0);
      expect(size.w).toBeLessThanOrEqual(100);
      expect(size.h).toBeGreaterThan(0);
      expect(size.h).toBeLessThanOrEqual(100);
    }
  });

  it('mirrors the App Library map for the shared types (the two add paths agree)', () => {
    // AppConfigForm.tsx WIDGET_TYPE_DEFAULT_SIZE parity — keep in sync.
    expect(resolveDropSize('CLOCK')).toEqual({ w: 28, h: 22 });
    expect(resolveDropSize('WEATHER')).toEqual({ w: 28, h: 22 });
    expect(resolveDropSize('COUNTDOWN')).toEqual({ w: 28, h: 22 });
    expect(resolveDropSize('WEBPAGE')).toEqual({ w: 60, h: 55 });
    expect(resolveDropSize('STREAMING')).toEqual({ w: 60, h: 45 });
  });
});
