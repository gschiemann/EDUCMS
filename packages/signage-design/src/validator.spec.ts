import { resolveArchetype } from './archetypes';
import { contrastRatio, BODY_CONTRAST_FLOOR, LARGE_CONTRAST_FLOOR } from './contrast';
import { THEMES, deriveThemeFromBrand } from './themes';
import { CANVAS_CLASSES } from './types';
import {
  MAX_FONT_FAMILIES,
  accentTextPasses,
  enforce,
} from './validator';
import type { ResolvedZone, ThemeBundle } from './types';

const theme = THEMES[0]!;
const landscape = CANVAS_CLASSES['landscape-16-9'];

describe('enforce — type sizing (rule A)', () => {
  it('owns + assigns derived font sizes to every text role', () => {
    const zones = resolveArchetype('split-50', landscape, theme);
    const { zones: out } = enforce(zones, { canvas: landscape, theme });
    for (const z of out) {
      if (z.styleTokens.typeRole) {
        expect(z.styleTokens.fontSizePx).toBeGreaterThanOrEqual(50);
      }
    }
  });

  it('reports a fix when an incoming size was below the 50px floor', () => {
    const zones = resolveArchetype('split-50', landscape, theme);
    // Sabotage: pretend the LLM had set a tiny size.
    zones.find((z) => z.slot === 'headline')!.styleTokens.fontSizePx = 12;
    const { findings } = enforce(zones, { canvas: landscape, theme });
    expect(findings.some((f) => f.code === 'FONT_BELOW_FLOOR')).toBe(true);
  });
});

describe('enforce — typeface cap (rule B)', () => {
  it('flags more than 2 font families', () => {
    const zones = resolveArchetype('split-50', landscape, theme);
    zones[1]!.styleTokens.fontFamily = 'FamilyA';
    zones[2]!.styleTokens.fontFamily = 'FamilyB';
    zones[3]!.styleTokens.fontFamily = 'FamilyC';
    const { ok, findings } = enforce(zones, { canvas: landscape, theme });
    expect(findings.some((f) => f.code === 'TOO_MANY_FONTS')).toBe(true);
    expect(ok).toBe(false);
    expect(MAX_FONT_FAMILIES).toBe(2);
  });
});

describe('enforce — contrast (rule C)', () => {
  it('adds a scrim behind text over an image background', () => {
    const zones = resolveArchetype('hero-fullbleed', landscape, theme);
    // Strip any pre-set scrim to force the guard to add one.
    for (const z of zones) z.styleTokens.scrim = undefined;
    const { zones: out, findings } = enforce(zones, { canvas: landscape, theme });
    const headline = out.find((z) => z.slot === 'headline')!;
    expect(headline.styleTokens.scrim).toBeDefined();
    expect(findings.some((f) => f.code === 'TEXT_OVER_IMAGE_NO_SCRIM')).toBe(true);
  });

  it('flips a text token when a flat pairing fails the floor', () => {
    // Build a deliberately bad theme: ink that fails on its own background, but
    // where a flip to inkInverse fixes it.
    const badTheme: ThemeBundle = {
      ...theme,
      palette: {
        ...theme.palette,
        background: '#101010',
        ink: '#202020', // dark ink on dark bg = fails
        inkInverse: '#ffffff', // flipping to white fixes it
      },
    };
    const zones: ResolvedZone[] = [
      {
        slot: 'headline',
        widgetType: 'TEXT',
        x: 5,
        y: 5,
        width: 90,
        height: 20,
        zIndex: 2,
        styleTokens: { typeRole: 'headline', colorToken: 'ink', fontFamily: 'Inter' },
      },
    ];
    const { zones: out, findings } = enforce(zones, { canvas: landscape, theme: badTheme });
    expect(findings.some((f) => f.code === 'CONTRAST_FLIP' || f.code === 'CONTRAST_SCRIM')).toBe(
      true,
    );
    expect(out[0]!.styleTokens.colorToken).toBe('inkInverse');
  });
});

describe('enforce — density (rule D)', () => {
  it('reduces multiple accents to one', () => {
    const zones = resolveArchetype('split-50', landscape, theme);
    // Force two accents.
    zones.filter((z) => z.styleTokens.typeRole).slice(0, 2).forEach((z) => {
      z.styleTokens.isAccent = true;
    });
    const { zones: out, findings } = enforce(zones, { canvas: landscape, theme });
    const accents = out.filter((z) => z.styleTokens.isAccent);
    expect(accents.length).toBe(1);
    expect(findings.some((f) => f.code === 'MULTIPLE_ACCENTS')).toBe(true);
  });

  it('warns when headline copy busts the 3x5 glance cap', () => {
    const zones = resolveArchetype('hero-fullbleed', landscape, theme);
    const { findings } = enforce(zones, {
      canvas: landscape,
      theme,
      copy: {
        headline: 'this is a very long headline that absolutely blows past the fifteen word glance cap for signage',
      },
    });
    expect(findings.some((f) => f.code === 'COPY_TOO_DENSE')).toBe(true);
  });
});

describe('enforce — layout (rule E)', () => {
  it('clamps an out-of-margin zone back inside the safe area', () => {
    const zones: ResolvedZone[] = [
      {
        slot: 'headline',
        widgetType: 'TEXT',
        x: 0, // outside the 5% margin
        y: 0,
        width: 100,
        height: 20,
        zIndex: 2,
        styleTokens: { typeRole: 'headline', colorToken: 'ink', fontFamily: 'Inter' },
      },
    ];
    const { zones: out, findings } = enforce(zones, { canvas: landscape, theme });
    expect(out[0]!.x).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(out[0]!.x + out[0]!.width).toBeLessThanOrEqual(95 + 1e-6);
    expect(findings.some((f) => f.code === 'SAFE_MARGIN_CLAMP')).toBe(true);
  });

  it('flags overlap between distinct content zones (geometry stays archetype-owned)', () => {
    const zones: ResolvedZone[] = [
      {
        slot: 'headline',
        widgetType: 'TEXT',
        x: 10,
        y: 10,
        width: 40,
        height: 40,
        zIndex: 2,
        styleTokens: { typeRole: 'headline', colorToken: 'ink', fontFamily: 'Inter' },
      },
      {
        slot: 'body',
        widgetType: 'TEXT',
        x: 30,
        y: 30,
        width: 40,
        height: 40,
        zIndex: 2,
        styleTokens: { typeRole: 'body', colorToken: 'ink', fontFamily: 'Inter' },
      },
    ];
    const { ok, findings } = enforce(zones, { canvas: landscape, theme });
    expect(findings.some((f) => f.code === 'ZONE_OVERLAP')).toBe(true);
    expect(ok).toBe(false);
  });
});

describe('enforce — clean archetype output is legal (no errors)', () => {
  it.each(['hero-fullbleed', 'split-50', 'lower-third-banner', 'stat-spotlight', 'three-up-grid', 'menu-list'] as const)(
    '%s resolves to a board that passes enforce with no errors',
    (id) => {
      const zones = resolveArchetype(id, landscape, theme);
      const { ok, findings } = enforce(zones, {
        canvas: landscape,
        theme,
        copy: { headline: 'Welcome Back' },
      });
      const errors = findings.filter((f) => f.severity === 'error');
      expect(errors).toEqual([]);
      expect(ok).toBe(true);
    },
  );
});

describe('precedence: validator never invents a new palette', () => {
  it('only touches color tokens, scrims, sizes — not the theme palette', () => {
    const t = deriveThemeFromBrand('#1d4ed8');
    const zones = resolveArchetype('split-50', landscape, t);
    const before = JSON.stringify(t.palette);
    enforce(zones, { canvas: landscape, theme: t });
    expect(JSON.stringify(t.palette)).toBe(before); // palette untouched
  });
});

describe('accentTextPasses helper', () => {
  it('curated themes have legible onAccent', () => {
    for (const t of THEMES) {
      expect(accentTextPasses(t)).toBe(true);
      expect(contrastRatio(t.palette.onAccent, t.palette.accent)).toBeGreaterThanOrEqual(
        LARGE_CONTRAST_FLOOR - 0.05,
      );
    }
  });

  it('the body floor exceeds the large floor (sanity)', () => {
    expect(BODY_CONTRAST_FLOOR).toBeGreaterThan(LARGE_CONTRAST_FLOOR);
  });
});
