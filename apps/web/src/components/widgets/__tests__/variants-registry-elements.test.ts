/**
 * Elements-wave registry drift-catcher — Wave B / editor-crush B2+B3+B5
 * (2026-07-02).
 *
 * THE BUG CLASS THIS PINS: dead palette registration (CLAUDE.md rule #9).
 * The 8 Decoration animations shipped complete on 2026-04-27 — widget,
 * renderer case, Properties editor, store canonicalization — but their only
 * "palette" listing was constants.ts WIDGET_GROUPS, which NO rendered
 * surface imports. They were invisible to operators for two months. The
 * palette that actually renders is VariantPicker, which reads the
 * variants-register.ts registry — so THIS file asserts the registry itself
 * carries every Elements tile. If a refactor drops a registerVariant call,
 * this fails instead of the tiles silently vanishing again.
 */
import '@/components/widgets/variants-register';
import { getVariant, listVariants } from '@/components/widgets/variants';
import { SHAPE_KINDS } from '@/components/widgets/ShapeWidget';
import { DECORATION_VARIANTS } from '@/components/widgets/DecorationWidget';

describe('Elements wave — variant registry registrations', () => {
  it('registers every SHAPE primitive as shape-<key> under widgetType SHAPE', () => {
    expect(SHAPE_KINDS.length).toBeGreaterThanOrEqual(7); // rect/pill/circle/triangle/star/line/arrow
    for (const s of SHAPE_KINDS) {
      const v = getVariant(`shape-${s.key}`);
      expect(v).toBeDefined();
      expect(v!.widgetType).toBe('SHAPE');
      expect(v!.previewOnly).toBe(true); // canvas must dispatch via WidgetRenderer case 'SHAPE'
      expect(v!.defaultConfig).toMatchObject({ shape: s.key });
      expect(typeof v!.render).toBe('function');
    }
  });

  it('registers the ICON element tile', () => {
    const v = getVariant('icon-element');
    expect(v).toBeDefined();
    expect(v!.widgetType).toBe('ICON');
    expect(v!.previewOnly).toBe(true);
    expect(v!.defaultConfig).toMatchObject({ icon: 'star' });
  });

  it('registers all 8 Decoration animations as decoration-<key> under widgetType DECORATION', () => {
    expect(DECORATION_VARIANTS).toHaveLength(8);
    for (const d of DECORATION_VARIANTS) {
      const v = getVariant(`decoration-${d.key}`);
      expect(v).toBeDefined();
      expect(v!.widgetType).toBe('DECORATION');
      expect(v!.previewOnly).toBe(true);
      // defaults must round-trip so a fresh drop animates immediately.
      expect(v!.defaultConfig).toMatchObject(d.defaults as Record<string, unknown>);
    }
  });

  it('keeps Elements tiles visible to EVERY vertical (no K12-only category, no vertical scope)', () => {
    const elementIds = [
      ...SHAPE_KINDS.map((s) => `shape-${s.key}`),
      'icon-element',
      ...DECORATION_VARIANTS.map((d) => `decoration-${d.key}`),
    ];
    for (const id of elementIds) {
      const v = getVariant(id)!;
      // No vertical scoping — confetti belongs in a bar on NYE as much as a
      // K-12 hallway; shapes/icons are universal design primitives.
      expect(v.vertical).toBeUndefined();
      expect(v.verticals).toBeUndefined();
      // MODERN is a universal category (not in VariantPicker's
      // K12_ONLY_CATEGORIES) so non-K12 tenants see the tiles too.
      expect(v.category).toBe('MODERN');
    }
  });

  it('lists SHAPE / ICON / DECORATION variants in the registry stream (the picker source)', () => {
    expect(listVariants({ widgetType: 'SHAPE' }).length).toBe(SHAPE_KINDS.length);
    expect(listVariants({ widgetType: 'ICON' }).length).toBeGreaterThanOrEqual(1);
    expect(listVariants({ widgetType: 'DECORATION' }).length).toBe(DECORATION_VARIANTS.length);
  });
});
