/**
 * Imported text must be READABLE on the background the import produced.
 * Two conversions produced provably invisible text and neither said so:
 *
 *   1. A dark slide whose text colour we never resolved. PowerPoint
 *      keeps placeholder colour in the layout/master list styles, not on
 *      the run, so the zone gets no colour and `TextWidget` falls back
 *      to `#1e293b` — 1.21:1 on a `#111827` slide, with no warning,
 *      because `colorUnresolved` fires only when a fill node exists and
 *      fails to resolve.
 *   2. A picture background we dropped (BACKGROUND_UNSUPPORTED) under
 *      the deck's authored white text, which then lands on the white
 *      default. 1:1.
 *
 * And three surfaces disagree about what "no background" means —
 * BuilderCanvas `|| '#ffffff'`, the player `|| '#000000'`, the commit
 * service `|| '#ffffff'` — so the builder states the background itself
 * rather than measuring contrast against a colour another layer picks.
 *
 * Every case here carries its negative control: the colours a source
 * authored legibly, and the text sitting on a picture we cannot see
 * into, must come through untouched.
 */
import {
  buildImport,
  IMPORT_DEFAULT_BG,
  PLAYER_DEFAULT_BG,
  TEXT_WIDGET_DEFAULT_COLOR,
  contrastRatio,
} from './import-builder';
import type { ParsedDocument, ParsedZone } from './types';

const textZone = (
  defaultConfig: Record<string, unknown>,
  over: Partial<ParsedZone> = {},
): ParsedZone => ({
  name: 'Headline',
  widgetType: 'TEXT',
  x: 10,
  y: 10,
  width: 50,
  height: 20,
  zIndex: 1,
  defaultConfig: { content: 'Fall Festival', fontSize: 64, ...defaultConfig },
  ...over,
});

const doc = (page: {
  bgColor?: string;
  zones: ParsedZone[];
}): ParsedDocument => ({
  pages: [
    {
      sourcePage: 1,
      label: 'Page 1',
      screenWidth: 1920,
      screenHeight: 1080,
      ...(page.bgColor ? { bgColor: page.bgColor } : {}),
      zones: page.zones,
      disposition: 'converted',
      warnings: [],
    },
  ],
  media: [],
  sourcePageCount: 1,
  warnings: [],
});

const build = (d: ParsedDocument) =>
  buildImport(d, { resolveMedia: (id) => `https://cdn.test/${id}.png` });

describe('contrastRatio', () => {
  it('measures the WCAG ratio, extremes included', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 4);
    // The exact pairing this whole file exists for.
    expect(
      contrastRatio(TEXT_WIDGET_DEFAULT_COLOR, PLAYER_DEFAULT_BG),
    ).toBeLessThan(1.5);
  });
});

describe('an imported template always states its own background', () => {
  it('fills in paper white when the source declared none', () => {
    // Spelled out, not just compared to the constant — an undefined
    // constant would otherwise match an undefined bgColor and the test
    // would pass while the defect shipped.
    expect(IMPORT_DEFAULT_BG).toBe('#ffffff');
    const [page] = build(doc({ zones: [textZone({})] })).pages;
    // Without this the player paints #000000 behind #1e293b text.
    expect(page.template?.bgColor).toBe('#ffffff');
  });

  it('never overrides a background the source DID declare', () => {
    const [page] = build(
      doc({ bgColor: '#112233', zones: [textZone({})] }),
    ).pages;
    expect(page.template?.bgColor).toBe('#112233');
  });
});

describe('no text zone is left unreadable on its own background', () => {
  it('repaints the widget default when the slide is dark', () => {
    const [page] = build(
      doc({ bgColor: '#111827', zones: [textZone({})] }),
    ).pages;
    const zone = page.template!.zones[0];
    const color = String(zone.defaultConfig.color);
    expect(contrastRatio(color, '#111827')).toBeGreaterThanOrEqual(4.5);
    expect(page.warnings.map((w) => w.code)).toContain('CONTRAST_ADJUSTED');
  });

  it('rescues white source text whose background we could not import', () => {
    // The deck's picture background was dropped, so #ffffff text would
    // land on the paper-white default.
    const [page] = build(
      doc({ zones: [textZone({ color: '#ffffff' })] }),
    ).pages;
    const zone = page.template!.zones[0];
    expect(
      contrastRatio(String(zone.defaultConfig.color), IMPORT_DEFAULT_BG),
    ).toBeGreaterThanOrEqual(4.5);
    expect(page.warnings.map((w) => w.code)).toContain('CONTRAST_ADJUSTED');
  });

  // ── Negative controls: the ones it must NOT touch ──────────────────
  it('leaves a legible source colour exactly as authored', () => {
    const [page] = build(
      doc({ bgColor: '#111827', zones: [textZone({ color: '#fbbf24' })] }),
    ).pages;
    expect(page.template!.zones[0].defaultConfig.color).toBe('#fbbf24');
    expect(page.warnings.map((w) => w.code)).not.toContain('CONTRAST_ADJUSTED');
  });

  it('leaves a merely-subtle source colour alone (it is the design)', () => {
    // #64748b on white is 4.0:1 — under AA for body text, but authored,
    // legible, and none of our business.
    const [page] = build(
      doc({ zones: [textZone({ color: '#64748b' })] }),
    ).pages;
    expect(page.template!.zones[0].defaultConfig.color).toBe('#64748b');
    expect(page.warnings.map((w) => w.code)).not.toContain('CONTRAST_ADJUSTED');
  });

  it('honours the zone own background over the page background', () => {
    // A text zone with its own dark fill on a white page: the backdrop
    // is the fill, so the default dark text must still be rescued.
    const [page] = build(
      doc({ zones: [textZone({ bgColor: '#0f172a' })] }),
    ).pages;
    expect(
      contrastRatio(
        String(page.template!.zones[0].defaultConfig.color),
        '#0f172a',
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('does not guess when the text sits on an imported picture', () => {
    // A full-bleed photo under the text: we cannot know the backdrop,
    // so we must not repaint from the page background and risk making
    // it worse. White text over a dark photo is the common shape.
    const photo: ParsedZone = {
      name: 'Photo',
      widgetType: 'IMAGE',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 0,
      defaultConfig: {},
      mediaRef: 'media-0',
    };
    const [page] = build(
      doc({ zones: [photo, textZone({ color: '#ffffff' })] }),
    ).pages;
    const text = page.template!.zones.find((z) => z.widgetType === 'TEXT')!;
    expect(text.defaultConfig.color).toBe('#ffffff');
    expect(page.warnings.map((w) => w.code)).not.toContain('CONTRAST_ADJUSTED');
  });
});
