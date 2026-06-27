import {
  ARCHETYPE_IDS,
  type ArchetypeId,
  type ArtDirectorSpec,
} from '@cms/signage-design';
import { artDirectorSpecToTemplate, scrimToCss } from './art-director';

// Widget types the mapper is allowed to emit (mirrors the engine's slot widgets).
const ALLOWED_WIDGETS = new Set(['TEXT', 'IMAGE']);

function specFor(archetype: ArchetypeId): ArtDirectorSpec {
  return {
    archetype,
    theme: 'clean-corporate',
    copy: {
      kicker: 'TODAY ONLY',
      headline: 'Grand Opening',
      body: 'Doors open at nine on Saturday morning.',
      cta: 'Learn More',
      items: [
        { label: 'Margherita', value: '$12', detail: 'San Marzano, basil' },
        { label: 'Pepperoni', value: '$14', detail: 'Cup-and-char' },
        { label: 'Veggie', value: '$13', detail: 'Seasonal' },
        { label: 'Hawaiian', value: '$13', detail: 'Pineapple, ham' },
        { label: 'BBQ Chicken', value: '$15', detail: 'Smoked gouda' },
      ],
    },
    image: { mode: 'none' },
    accentSlot: 'cta',
  };
}

const OPTS = { screenWidth: 1920, screenHeight: 1080 };

describe('artDirectorSpecToTemplate', () => {
  it.each(ARCHETYPE_IDS)(
    'produces legal signage zones for archetype %s',
    (archetype) => {
      const out = artDirectorSpecToTemplate(specFor(archetype), OPTS);

      expect(out.background.bgColor).toBeTruthy();
      expect(out.zones.length).toBeGreaterThan(0);
      expect(out.zones.length).toBeLessThanOrEqual(20);

      for (const z of out.zones) {
        // Allowed widget set.
        expect(ALLOWED_WIDGETS.has(z.widgetType)).toBe(true);

        // Geometry within 0-100.
        expect(z.x).toBeGreaterThanOrEqual(0);
        expect(z.y).toBeGreaterThanOrEqual(0);
        expect(z.width).toBeGreaterThanOrEqual(0);
        expect(z.height).toBeGreaterThanOrEqual(0);
        expect(z.x + z.width).toBeLessThanOrEqual(100.001);
        expect(z.y + z.height).toBeLessThanOrEqual(100.001);

        // Every TEXT zone has an absolute px font size >= 50.
        if (z.widgetType === 'TEXT') {
          expect(z.defaultConfig?.sizeMode).toBe('absolute');
          expect(typeof z.defaultConfig?.fontSize).toBe('number');
          expect(z.defaultConfig?.fontSize).toBeGreaterThanOrEqual(50);
        }
      }
    },
  );

  it('hero-fullbleed has a >=50px headline zone and a background IMAGE zone', () => {
    const out = artDirectorSpecToTemplate(specFor('hero-fullbleed'), OPTS);

    const headline = out.zones.find((z) => z.name === 'headline');
    expect(headline).toBeDefined();
    expect(headline?.widgetType).toBe('TEXT');
    expect(headline?.defaultConfig?.fontSize).toBeGreaterThanOrEqual(50);

    const bg = out.zones.find((z) => z.name === 'background');
    expect(bg).toBeDefined();
    expect(bg?.widgetType).toBe('IMAGE');
    // Wave 2a: no real photo yet — relies on the gradient.
    expect(bg?.defaultConfig?.bgGradient).toBeTruthy();
    expect(bg?.defaultConfig?.assetUrl).toBeUndefined();
  });

  it('falls back to hero-fullbleed for an unknown archetype', () => {
    const spec = {
      ...specFor('hero-fullbleed'),
      archetype: 'not-a-real-archetype' as ArchetypeId,
    };
    const out = artDirectorSpecToTemplate(spec, OPTS);
    // hero-fullbleed always emits a background IMAGE zone.
    expect(
      out.zones.some(
        (z) => z.name === 'background' && z.widgetType === 'IMAGE',
      ),
    ).toBe(true);
  });

  it('renders the CTA as a filled accent button', () => {
    const out = artDirectorSpecToTemplate(specFor('hero-fullbleed'), OPTS);
    const cta = out.zones.find((z) => z.name === 'cta');
    expect(cta).toBeDefined();
    expect(cta?.defaultConfig?.paddingMode).toBe('button');
    expect(cta?.defaultConfig?.bgColor).toBeTruthy();
  });

  it('menu-list rows carry value + detail in rowLayout', () => {
    const out = artDirectorSpecToTemplate(specFor('menu-list'), OPTS);
    const rows = out.zones.filter((z) => z.name === 'listItem');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.defaultConfig?.rowLayout).toBe(true);
    expect(rows[0]?.defaultConfig?.valueText).toBe('$12');
    expect(rows[0]?.defaultConfig?.content).toBe('Margherita');
  });

  it('three-up-grid cards use cardLayout + surface bg', () => {
    const out = artDirectorSpecToTemplate(specFor('three-up-grid'), OPTS);
    const cards = out.zones.filter((z) => z.name === 'listItem');
    expect(cards.length).toBe(3);
    expect(cards[0]?.defaultConfig?.cardLayout).toBe(true);
    expect(cards[0]?.defaultConfig?.bgColor).toBeTruthy();
    // Each card pulls its OWN item.
    expect(cards[0]?.defaultConfig?.content).toBe('Margherita');
    expect(cards[1]?.defaultConfig?.content).toBe('Pepperoni');
    expect(cards[2]?.defaultConfig?.content).toBe('Veggie');
  });

  it('derives a brand theme when theme==="brand"', () => {
    const spec = { ...specFor('stat-spotlight'), theme: 'brand' };
    const out = artDirectorSpecToTemplate(spec, {
      ...OPTS,
      brandPrimaryHex: '#e11d48',
      brandAccentHex: '#facc15',
    });
    expect(out.background.bgColor).toMatch(/^#/);
    expect(out.zones.length).toBeGreaterThan(0);
  });

  it('emits a multi-scene template tagged with per-scene names', () => {
    const base = specFor('hero-fullbleed');
    const spec: ArtDirectorSpec = {
      ...base,
      scenes: [
        { ...base, copy: { ...base.copy, headline: 'Welcome' } },
        {
          ...specFor('menu-list'),
          copy: { ...specFor('menu-list').copy, headline: 'Our Menu' },
        },
      ],
    };
    const out = artDirectorSpecToTemplate(spec, OPTS);
    expect(out.scenes?.length).toBe(2);
    const sceneNames = new Set(out.scenes!.map((s) => s.name));
    // Every zone references a real scene.
    for (const z of out.zones) {
      expect(z.sceneRef).toBeTruthy();
      expect(sceneNames.has(z.sceneRef!)).toBe(true);
    }
  });

  it('drops empty optional text zones but keeps the headline', () => {
    const spec = specFor('split-50');
    spec.copy = { headline: 'Just A Headline' }; // no kicker/body/cta/items
    const out = artDirectorSpecToTemplate(spec, OPTS);
    expect(out.zones.some((z) => z.name === 'headline')).toBe(true);
    expect(out.zones.some((z) => z.name === 'kicker')).toBe(false);
    expect(out.zones.some((z) => z.name === 'body')).toBe(false);
  });
});

describe('scrimToCss', () => {
  it('returns undefined for none', () => {
    expect(
      scrimToCss({ color: '#000000', opacity: 0.5, direction: 'none' }),
    ).toBeUndefined();
    expect(scrimToCss(undefined)).toBeUndefined();
  });
  it('builds a full overlay', () => {
    const css = scrimToCss({
      color: '#000000',
      opacity: 0.5,
      direction: 'full',
    });
    expect(css).toContain('linear-gradient(0deg');
    expect(css).toContain('rgba(0, 0, 0, 0.5)');
  });
  it('builds a bottom fade', () => {
    const css = scrimToCss({
      color: '#000000',
      opacity: 0.8,
      direction: 'bottom',
    });
    expect(css).toContain('transparent 62%');
  });
});
