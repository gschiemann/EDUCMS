import {
  ARCHETYPE_IDS,
  THEMES,
  contrastRatio,
  LARGE_CONTRAST_FLOOR,
  type ArchetypeId,
  type ArtDirectorSpec,
} from '@cms/signage-design';
import {
  parseGuidedIntake,
  resolveThemeId,
  archetypeForPurpose,
  applyGuidedIntakeToSpec,
  guidedMapperDirectives,
  paletteIsBrand,
  type GuidedIntake,
} from './guided-intake';
import { artDirectorSpecToTemplate } from './art-director';

const THEME_IDS = new Set(THEMES.map((t) => t.id));

function baseSpec(archetype: ArchetypeId = 'title-cta'): ArtDirectorSpec {
  return {
    archetype,
    theme: 'clean-corporate',
    copy: { kicker: 'TODAY', headline: 'Hello', body: 'Some body', cta: 'Go' },
    image: { mode: 'none' },
    accentSlot: 'cta',
  };
}

// ───────────────────────────────────────────────────────────────────────
// parseGuidedIntake — the API-boundary validator/clamp.
// ───────────────────────────────────────────────────────────────────────
describe('parseGuidedIntake', () => {
  it('returns undefined when no usable directive is present', () => {
    expect(parseGuidedIntake(undefined)).toBeUndefined();
    expect(parseGuidedIntake({})).toBeUndefined();
    expect(parseGuidedIntake({ prompt: 'just a prompt' })).toBeUndefined();
    // every field 'auto'/garbage → ignored → undefined
    expect(
      parseGuidedIntake({ purpose: 'auto', theme: 'NotAThemeXYZ', palette: 'auto', background: 'auto', widgets: ['bogus'] }),
    ).toBeUndefined();
  });

  it('parses a full valid intake', () => {
    const out = parseGuidedIntake({
      purpose: 'menu',
      theme: 'Bold',
      palette: { colors: ['#112233', '#ff0000'] },
      background: 'textured',
      widgets: ['clock', 'logo', 'clock'], // dup dropped
    });
    expect(out).toBeDefined();
    expect(out!.purpose).toBe('menu');
    expect(out!.theme).toBe('neon-sports'); // Bold → neon-sports
    expect(out!.palette).toEqual({ colors: ['#112233', '#ff0000'] });
    expect(out!.background).toBe('textured');
    expect(out!.widgets).toEqual(['clock', 'logo']);
  });

  it('clamps custom palette to ≤6 valid hex, drops malformed', () => {
    const out = parseGuidedIntake({
      palette: { colors: ['#fff', 'red', '#1a2b3c', '#GGGGGG', '#abc', '#def', '#123', '#456', '#789'] },
    });
    // valid: #fff, #1a2b3c, #abc, #def, #123, #456, #789 → 7 valid, capped at 6
    expect(out!.palette).toEqual({ colors: ['#fff', '#1a2b3c', '#abc', '#def', '#123', '#456'] });
  });

  it('ignores an all-garbage custom palette (folds to derive)', () => {
    expect(parseGuidedIntake({ palette: { colors: ['red', 'blue', 'notahex'] } })).toBeUndefined();
  });

  it('keeps brand palette directive', () => {
    const out = parseGuidedIntake({ palette: 'brand' });
    expect(out!.palette).toBe('brand');
    expect(paletteIsBrand(out)).toBe(true);
  });

  it('rejects unknown enum values', () => {
    const out = parseGuidedIntake({ purpose: 'nope', background: 'sparkly', widgets: ['headline', 'banana'] });
    expect(out!.purpose).toBeUndefined();
    expect(out!.background).toBeUndefined();
    expect(out!.widgets).toEqual(['headline']);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Mappings — friendly → real id.
// ───────────────────────────────────────────────────────────────────────
describe('resolveThemeId', () => {
  it('maps every friendly label to a REAL theme id', () => {
    const friendly = {
      Modern: 'clean-corporate',
      Bold: 'neon-sports',
      Elegant: 'minimal-luxury',
      Warm: 'warm-school',
      Neon: 'midnight-tech',
      Minimal: 'sky-civic',
      Playful: 'forest-campus',
    };
    for (const [label, id] of Object.entries(friendly)) {
      expect(resolveThemeId(label)).toBe(id);
      expect(resolveThemeId(label.toLowerCase())).toBe(id); // case-insensitive
      expect(THEME_IDS.has(id)).toBe(true); // it's a real curated id
    }
  });
  it('passes through real ids + brand, rejects unknown', () => {
    expect(resolveThemeId('qsr-appetite')).toBe('qsr-appetite');
    expect(resolveThemeId('brand')).toBe('brand');
    expect(resolveThemeId('not-real')).toBeUndefined();
    expect(resolveThemeId(undefined)).toBeUndefined();
  });
});

describe('archetypeForPurpose', () => {
  it('maps every purpose to a REAL archetype id', () => {
    const map = {
      welcome: 'hero-fullbleed',
      menu: 'menu-list',
      promo: 'poster-promo',
      event: 'title-cta',
      announcement: 'title-cta',
      feature: 'split-50',
      'photo-hero': 'hero-fullbleed',
    } as const;
    for (const [purpose, archetype] of Object.entries(map)) {
      const out = archetypeForPurpose(purpose as any);
      expect(out).toBe(archetype);
      expect((ARCHETYPE_IDS as string[]).includes(out!)).toBe(true);
    }
  });
  it('auto/undefined → no override', () => {
    expect(archetypeForPurpose('auto')).toBeUndefined();
    expect(archetypeForPurpose(undefined)).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────
// applyGuidedIntakeToSpec — HARD archetype/theme directive.
// ───────────────────────────────────────────────────────────────────────
describe('applyGuidedIntakeToSpec', () => {
  it('forces archetype + theme over the spec', () => {
    const spec = baseSpec('hero-fullbleed');
    applyGuidedIntakeToSpec(spec, { purpose: 'menu', theme: 'neon-sports' });
    expect(spec.archetype).toBe('menu-list');
    expect(spec.theme).toBe('neon-sports');
  });

  it('forces every scene of a multi-scene set', () => {
    const spec = baseSpec('hero-fullbleed');
    spec.scenes = [baseSpec('split-50'), baseSpec('quote-spotlight')];
    applyGuidedIntakeToSpec(spec, { purpose: 'promo', theme: 'warm-school' });
    expect(spec.archetype).toBe('poster-promo');
    for (const sc of spec.scenes!) {
      expect(sc.archetype).toBe('poster-promo');
      expect(sc.theme).toBe('warm-school');
    }
  });

  it('omitted intake leaves spec untouched (no regression)', () => {
    const spec = baseSpec('hero-fullbleed');
    const before = JSON.stringify(spec);
    applyGuidedIntakeToSpec(spec, undefined);
    expect(JSON.stringify(spec)).toBe(before);
  });

  it('photo background upgrades the image plan on an image-bg archetype', () => {
    const spec = baseSpec('hero-fullbleed');
    spec.image = { mode: 'none' };
    applyGuidedIntakeToSpec(spec, { background: 'photo' });
    expect(spec.image.mode).toBe('generate');
    expect(spec.image.prompt).toBeTruthy();
  });

  it('photo background does NOT upgrade a non-image archetype', () => {
    const spec = baseSpec('menu-list');
    spec.image = { mode: 'none' };
    applyGuidedIntakeToSpec(spec, { background: 'photo' });
    expect(spec.image.mode).toBe('none');
  });
});

// ───────────────────────────────────────────────────────────────────────
// guidedMapperDirectives — surface / palette / widgets.
// ───────────────────────────────────────────────────────────────────────
describe('guidedMapperDirectives', () => {
  it('maps each background to a forced SurfaceStyle', () => {
    expect(guidedMapperDirectives({ background: 'solid' })!.forcedSurfaceStyle).toMatchObject({ background: 'wash', glow: 0 });
    expect(guidedMapperDirectives({ background: 'gradient' })!.forcedSurfaceStyle).toMatchObject({ background: 'spotlight' });
    expect(guidedMapperDirectives({ background: 'textured' })!.forcedSurfaceStyle).toMatchObject({ background: 'duotone' });
    const photo = guidedMapperDirectives({ background: 'photo' })!;
    expect(photo.photoRequested).toBe(true);
    expect(photo.forcedSurfaceStyle).toMatchObject({ background: 'spotlight' }); // rich gradient fallback under the photo
  });

  it('maps custom swatches to bg/accent/surface override', () => {
    const d = guidedMapperDirectives({ palette: { colors: ['#101010', '#ff3366', '#202020'] } })!;
    expect(d.paletteOverride).toEqual({ background: '#101010', accent: '#ff3366', surface: '#202020' });
  });

  it('brand/auto palette produce no paletteOverride', () => {
    expect(guidedMapperDirectives({ palette: 'brand' })).toBeUndefined();
    expect(guidedMapperDirectives({ palette: 'auto' as any })).toBeUndefined();
  });

  it('carries required widgets', () => {
    expect(guidedMapperDirectives({ widgets: ['clock', 'weather'] })!.requiredWidgets).toEqual(['clock', 'weather']);
  });

  it('undefined intake → undefined', () => {
    expect(guidedMapperDirectives(undefined)).toBeUndefined();
  });
});

// ───────────────────────────────────────────────────────────────────────
// Integration: artDirectorSpecToTemplate honors the directives.
// ───────────────────────────────────────────────────────────────────────
describe('artDirectorSpecToTemplate + guided directives', () => {
  const OPTS = { screenWidth: 1920, screenHeight: 1080 };

  it('forces SurfaceStyle into the board background gradient (solid = flat)', () => {
    const spec = baseSpec('title-cta');
    const solid = artDirectorSpecToTemplate(spec, {
      ...OPTS,
      forcedSurfaceStyle: { background: 'wash', glow: 0, card: 'flat' },
    });
    const textured = artDirectorSpecToTemplate(spec, {
      ...OPTS,
      forcedSurfaceStyle: { background: 'duotone', glow: 0.85 },
    });
    // The two background gradients must differ — proof the dial is honored.
    expect(solid.background.bgGradient).not.toBe(textured.background.bgGradient);
    // textured = duotone → a 135deg diagonal ramp.
    expect(textured.background.bgGradient).toContain('135deg');
  });

  it('custom palette overrides the board background color + keeps text legible', () => {
    const spec = baseSpec('title-cta');
    const out = artDirectorSpecToTemplate(spec, {
      ...OPTS,
      paletteOverride: { background: '#ffffff', accent: '#0044cc' }, // light bg
    });
    // The board base color is the custom bg.
    expect(out.background.bgColor).toBe('#ffffff');
    // Every TEXT zone must clear the large-text contrast floor against the white bg
    // (the engine re-derived ink to dark) — proof the custom palette never produces
    // illegible text.
    const textZones = out.zones.filter((z) => z.widgetType === 'TEXT' && z.defaultConfig?.color && !z.defaultConfig?.bgColor);
    expect(textZones.length).toBeGreaterThan(0);
    for (const z of textZones) {
      const ratio = contrastRatio(z.defaultConfig!.color, '#ffffff');
      expect(ratio).toBeGreaterThanOrEqual(LARGE_CONTRAST_FLOOR);
    }
  });

  it('emits required widget zones the archetype lacks', () => {
    const spec = baseSpec('title-cta'); // no clock/weather/countdown slot
    const out = artDirectorSpecToTemplate(spec, {
      ...OPTS,
      requiredWidgets: ['clock', 'weather', 'countdown', 'logo'],
    });
    const types = out.zones.map((z) => z.widgetType);
    expect(types).toContain('CLOCK');
    expect(types).toContain('WEATHER');
    expect(types).toContain('COUNTDOWN');
    expect(types).toContain('LOGO');
    // Every emitted required zone is geometrically legal.
    for (const z of out.zones) {
      expect(z.x).toBeGreaterThanOrEqual(0);
      expect(z.x + z.width).toBeLessThanOrEqual(100.001);
      expect(z.y + z.height).toBeLessThanOrEqual(100.001);
    }
  });

  it('does NOT double-add a widget the archetype already covers (headline)', () => {
    const spec = baseSpec('title-cta'); // has a headline slot
    const out = artDirectorSpecToTemplate(spec, {
      ...OPTS,
      requiredWidgets: ['headline'],
    });
    // headline is covered by the archetype's display slot, so no supplemental
    // 'headline'-named zone is appended (count of headline-named zones stays 1).
    const headlineNamed = out.zones.filter((z) => z.name === 'headline');
    expect(headlineNamed.length).toBe(1);
  });

  it('no directives → identical output to a plain map (no regression)', () => {
    const spec = baseSpec('title-cta');
    const plain = artDirectorSpecToTemplate(baseSpec('title-cta'), OPTS);
    const withEmpty = artDirectorSpecToTemplate(spec, {
      ...OPTS,
      forcedSurfaceStyle: undefined,
      paletteOverride: undefined,
      requiredWidgets: undefined,
    });
    expect(JSON.stringify(withEmpty.zones)).toBe(JSON.stringify(plain.zones));
    expect(withEmpty.background).toEqual(plain.background);
  });
});
