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

  it('keeps EVERY scene in a large dense set (no 20-zone global truncation)', () => {
    // Regression: a "Build a set" of 6 dense boards (menu-list/three-up have
    // ~6-8 zones each) used to silently drop tail scenes once the running zone
    // total hit a flat 20 — the last boards rendered blank. Every scene must
    // now contribute at least its headline.
    const dense: ArchetypeId[] = [
      'menu-list',
      'three-up-grid',
      'menu-list',
      'three-up-grid',
      'menu-list',
      'three-up-grid',
    ];
    const base = specFor('menu-list');
    const spec: ArtDirectorSpec = {
      ...base,
      scenes: dense.map((archetype, i) => ({
        ...specFor(archetype),
        copy: { ...specFor(archetype).copy, headline: `Board ${i + 1}` },
      })),
    };
    const out = artDirectorSpecToTemplate(spec, OPTS);
    expect(out.scenes?.length).toBe(6);
    // Every scene must own at least one zone (no blank tail boards).
    for (const s of out.scenes!) {
      expect(out.zones.some((z) => z.sceneRef === s.name)).toBe(true);
    }
    // …and the set genuinely exceeds the old flat-20 cap.
    expect(out.zones.length).toBeGreaterThan(20);
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

// ───────────────────────────────────────────────────────────────────────
// FUNCTIONAL BINDING (2026-06-28) — generated boards must come out WORKING,
// not as themed shells. These pin: LUNCH_MENU populated from copy.items,
// WEATHER seeded with a location, COUNTDOWN with the real targetDate, LOGO
// with the brand-kit assetUrl, QR/CTA with the real URL, no placeholder TEXT.
// ───────────────────────────────────────────────────────────────────────
describe('artDirectorSpecToTemplate — functional widget emission', () => {
  // A spec whose archetype carries NO menu/weather/etc slots, so the required
  // widgets are appended as supplemental zones (where our binding logic lives).
  const eventSpec = (): ArtDirectorSpec => ({
    archetype: 'title-cta',
    theme: 'clean-corporate',
    copy: {
      kicker: 'THIS FRIDAY',
      headline: 'Happy Hour',
      body: 'Half-price wings and $5 drafts all night long.',
      cta: 'See the deals',
      eventDate: '2099-12-31T18:00:00.000Z',
      ctaHref: 'https://thecornertap.com/happy-hour',
      items: [
        { label: 'Draft beer', value: '$5' },
        { label: 'Wings', value: '$6', detail: 'half price' },
      ],
    },
    image: { mode: 'none' },
    accentSlot: 'cta',
  });

  const CTX = {
    screenWidth: 1920,
    screenHeight: 1080,
    weatherLocation: '32.7767,-96.7970',
    logoUrl: 'https://cdn.example.com/logo.png',
    eventDate: '2099-12-31T18:00:00.000Z',
    ctaHref: 'https://thecornertap.com/happy-hour',
    requiredWidgets: [
      'menu', 'weather', 'countdown', 'logo', 'qr', 'cta', 'ticker', 'clock',
    ] as any,
  };

  it('populates a LUNCH_MENU `menu` from spec.copy.items (the #1 fix)', () => {
    const out = artDirectorSpecToTemplate(eventSpec(), { ...CTX });
    const menu = out.zones.find((z) => z.name === 'menu');
    expect(menu?.widgetType).toBe('LUNCH_MENU');
    expect(typeof menu?.defaultConfig?.menu).toBe('string');
    // The deals the model wrote LAND in the widget (Label: value · detail).
    expect(menu?.defaultConfig?.menu).toContain('Draft beer: $5');
    expect(menu?.defaultConfig?.menu).toContain('Wings: $6 · half price');
    // Newline-joined, one row per item — the format the renderer parses.
    expect(menu?.defaultConfig?.menu.split('\n').length).toBe(2);
  });

  it('seeds WEATHER with the venue location', () => {
    const out = artDirectorSpecToTemplate(eventSpec(), { ...CTX });
    const weather = out.zones.find((z) => z.name === 'weather');
    expect(weather?.widgetType).toBe('WEATHER');
    expect(weather?.defaultConfig?.location).toBe('32.7767,-96.7970');
  });

  it('seeds COUNTDOWN with the real targetDate from eventDate', () => {
    const out = artDirectorSpecToTemplate(eventSpec(), { ...CTX });
    const cd = out.zones.find((z) => z.name === 'countdown');
    expect(cd?.widgetType).toBe('COUNTDOWN');
    expect(cd?.defaultConfig?.targetDate).toBe('2099-12-31T18:00:00.000Z');
  });

  it('omits COUNTDOWN targetDate when no eventDate is supplied (no fake now+30d)', () => {
    const out = artDirectorSpecToTemplate(eventSpec(), { ...CTX, eventDate: undefined });
    const cd = out.zones.find((z) => z.name === 'countdown');
    expect(cd).toBeDefined();
    expect(cd?.defaultConfig?.targetDate).toBeUndefined();
  });

  it('seeds LOGO with the tenant brand-kit assetUrl', () => {
    const out = artDirectorSpecToTemplate(eventSpec(), { ...CTX });
    const logo = out.zones.find((z) => z.name === 'logo');
    expect(logo?.widgetType).toBe('LOGO');
    expect(logo?.defaultConfig?.assetUrl).toBe('https://cdn.example.com/logo.png');
  });

  it('emits a real qrText from ctaHref (never example.com)', () => {
    const out = artDirectorSpecToTemplate(eventSpec(), { ...CTX });
    const qr = out.zones.find((z) => z.name === 'qr');
    expect(qr?.widgetType).toBe('IMAGE');
    expect(qr?.defaultConfig?.qrText).toBe('https://thecornertap.com/happy-hour');
    expect(qr?.defaultConfig?.qrText).not.toContain('example.com/');
  });

  it('omits qrText when no ctaHref is supplied (no example.com placeholder)', () => {
    const out = artDirectorSpecToTemplate(eventSpec(), { ...CTX, ctaHref: undefined });
    const qr = out.zones.find((z) => z.name === 'qr');
    expect(qr).toBeDefined();
    expect(qr?.defaultConfig?.qrText).toBeUndefined();
  });

  it('attaches an open-url touchAction to the CTA when a ctaHref exists', () => {
    const out = artDirectorSpecToTemplate(eventSpec(), { ...CTX });
    const cta = out.zones.find((z) => z.name === 'cta');
    expect(cta?.touchAction?.type).toBe('open-url');
    expect(cta?.touchAction?.target).toBe('https://thecornertap.com/happy-hour');
  });

  it('uses real TICKER messages from copy, never the placeholder', () => {
    const out = artDirectorSpecToTemplate(eventSpec(), { ...CTX });
    const ticker = out.zones.find((z) => z.name === 'ticker');
    expect(ticker?.widgetType).toBe('TICKER');
    const messages = ticker?.defaultConfig?.messages as string[];
    expect(Array.isArray(messages)).toBe(true);
    expect(messages).not.toContain('Add your scrolling message here');
    expect(messages[0]).toContain('Half-price wings');
  });

  it('drops a placeholder-only subtext zone (no real body copy)', () => {
    const spec = eventSpec();
    spec.copy.body = undefined; // no real supporting copy
    const out = artDirectorSpecToTemplate(spec, {
      ...CTX,
      requiredWidgets: ['subtext'] as any,
    });
    // No zone may carry the literal placeholder.
    const placeholderZone = out.zones.find(
      (z) => z.defaultConfig?.content === 'Add your supporting text here',
    );
    expect(placeholderZone).toBeUndefined();
  });

  it('never ships any "Add your supporting text here" / "Your text here" zone', () => {
    const spec = eventSpec();
    spec.copy.body = undefined;
    const out = artDirectorSpecToTemplate(spec, {
      ...CTX,
      requiredWidgets: ['menu', 'weather', 'subtext', 'ticker'] as any,
    });
    for (const z of out.zones) {
      const c = z.defaultConfig?.content;
      expect(c).not.toBe('Add your supporting text here');
      expect(c).not.toBe('Your text here');
    }
  });

  it('omits the menu data (keeps widget) when there are no items', () => {
    const spec = eventSpec();
    spec.copy.items = undefined;
    const out = artDirectorSpecToTemplate(spec, { ...CTX, requiredWidgets: ['menu'] as any });
    const menu = out.zones.find((z) => z.name === 'menu');
    expect(menu).toBeDefined();
    expect(menu?.defaultConfig?.menu).toBeUndefined();
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

// ───────────────────────────────────────────────────────────────────────
// TASTE TIER (2026-06-28) — the mapper must emit the new design tokens:
// per-zone entrance motion, the kicker badge/divider, accent2 on the menu
// value column, tabular figures + balance on the focal text, display tracking.
// ───────────────────────────────────────────────────────────────────────
describe('artDirectorSpecToTemplate — taste-tier design tokens', () => {
  const tasteSpec = (archetype: ArchetypeId): ArtDirectorSpec => ({
    archetype,
    theme: 'neon-sports', // a theme with accent2 + a kicker badge + tracking
    copy: {
      kicker: 'GAME DAY',
      headline: 'Beat State',
      body: 'Kickoff at seven on Friday night.',
      cta: 'Get loud',
      items: [
        { label: 'Nachos', value: '$8' },
        { label: 'Hot Dog', value: '$5' },
        { label: 'Soda', value: '$3' },
      ],
    },
    image: { mode: 'none' },
    accentSlot: 'cta',
  });

  it('attaches a staggered entrance descriptor to every zone', () => {
    const out = artDirectorSpecToTemplate(tasteSpec('title-cta'), OPTS);
    for (const z of out.zones) {
      const e = z.defaultConfig?.entrance;
      expect(e).toBeTruthy();
      expect(['rise-fade', 'fade', 'pop', 'none']).toContain(e.kind);
      expect(typeof e.delayMs).toBe('number');
      expect(e.durationMs).toBeGreaterThanOrEqual(300);
    }
    // Stagger order: kicker reveals before the CTA.
    const kicker = out.zones.find((z) => z.name === 'kicker');
    const cta = out.zones.find((z) => z.name === 'cta');
    expect(kicker!.defaultConfig!.entrance.delayMs).toBeLessThan(
      cta!.defaultConfig!.entrance.delayMs,
    );
  });

  it('renders the kicker as a badge OR an accent2 divider (never both)', () => {
    const out = artDirectorSpecToTemplate(tasteSpec('title-cta'), OPTS);
    const kicker = out.zones.find((z) => z.name === 'kicker')!;
    const cfg = kicker.defaultConfig!;
    const hasBadge = !!cfg.kickerBadge;
    const hasDivider = !!cfg.accentDivider;
    expect(hasBadge || hasDivider).toBe(true);
    expect(hasBadge && hasDivider).toBe(false);
    // neon-sports is high-energy → a FILLED badge.
    expect(cfg.kickerBadge?.variant).toBe('filled');
  });

  it('gives the display headline negative tracking + balanced wrapping', () => {
    const out = artDirectorSpecToTemplate(tasteSpec('title-cta'), OPTS);
    const headline = out.zones.find((z) => z.name === 'headline')!.defaultConfig!;
    expect(headline.textWrapBalance).toBe(true);
    expect(headline.fontFeatureSettings).toContain('kern');
    // neon-sports displayTracking is negative.
    expect(String(headline.letterSpacing)).toMatch(/^-/);
  });

  it('gives the focal stat tabular figures', () => {
    const out = artDirectorSpecToTemplate(
      { ...tasteSpec('stat-spotlight'), copy: { headline: '111', body: 'Wins' } },
      OPTS,
    );
    const stat = out.zones.find((z) => z.name === 'stat')!.defaultConfig!;
    expect(stat.fontVariantNumeric).toBe('tabular-nums');
  });

  it('colors the menu value column in accent2 with tabular figures', () => {
    const out = artDirectorSpecToTemplate(tasteSpec('menu-list'), OPTS);
    const row = out.zones.find((z) => z.name === 'listItem')!.defaultConfig!;
    expect(row.valueTabular).toBe(true);
    expect(row.valueColor).toBeTruthy();
  });
});
