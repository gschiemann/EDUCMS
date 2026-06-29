import {
  buildIntakeRequestFields,
  DEFAULT_INTAKE_ANSWERS,
  PURPOSE_TO_ARCHETYPE,
  THEME_TO_ID,
  WIDGET_TO_TYPE,
  DEFAULT_WIDGETS_BY_PURPOSE,
  PURPOSE_OPTIONS,
  THEME_OPTIONS,
  WIDGET_OPTIONS,
  type AiIntakeAnswers,
} from '../ai-intake-contract';

// The real signage-design ids the contract maps TO (drift guards). Mirrored
// here as literals from packages/signage-design/src/{archetypes,themes}.ts so
// the test stays runnable without that package needing a dist build. If the
// engine adds/renames an id, update both — the failing test will say so.
const REAL_ARCHETYPE_IDS = [
  'hero-fullbleed',
  'split-50',
  'lower-third-banner',
  'stat-spotlight',
  'three-up-grid',
  'menu-list',
  'poster-promo',
  'quote-spotlight',
  'title-cta',
];
const REAL_THEME_IDS = [
  'clean-corporate',
  'warm-school',
  'neon-sports',
  'qsr-appetite',
  'minimal-luxury',
  'calm-clinic',
  'fresh-fitness',
  'worship-warm',
  'bold-retail',
  'sky-civic',
  'forest-campus',
  'midnight-tech',
];

describe('ai-intake-contract: buildIntakeRequestFields', () => {
  it('OMITS every field when answers are the defaults (no regression — engine derives)', () => {
    const out = buildIntakeRequestFields(DEFAULT_INTAKE_ANSWERS);
    expect(out).toEqual({});
  });

  it('forwards a chosen purpose as the semantic key', () => {
    const a: AiIntakeAnswers = { ...DEFAULT_INTAKE_ANSWERS, purpose: 'menu' };
    expect(buildIntakeRequestFields(a).purpose).toBe('menu');
  });

  it("never sends purpose for 'auto'", () => {
    const a: AiIntakeAnswers = { ...DEFAULT_INTAKE_ANSWERS, purpose: 'auto' };
    expect(buildIntakeRequestFields(a).purpose).toBeUndefined();
  });

  it('resolves a friendly theme label to a REAL theme id', () => {
    const a: AiIntakeAnswers = { ...DEFAULT_INTAKE_ANSWERS, theme: 'Bold' };
    expect(buildIntakeRequestFields(a).theme).toBe('bold-retail');
  });

  it("sends palette:'brand' for the brand mode", () => {
    const a: AiIntakeAnswers = { ...DEFAULT_INTAKE_ANSWERS, paletteMode: 'brand' };
    expect(buildIntakeRequestFields(a).palette).toBe('brand');
  });

  it('sends custom palette colors only when present', () => {
    const withColors: AiIntakeAnswers = {
      ...DEFAULT_INTAKE_ANSWERS,
      paletteMode: 'custom',
      paletteColors: ['#111111', '#eeeeee'],
    };
    expect(buildIntakeRequestFields(withColors).palette).toEqual({ colors: ['#111111', '#eeeeee'] });

    const noColors: AiIntakeAnswers = { ...DEFAULT_INTAKE_ANSWERS, paletteMode: 'custom', paletteColors: [] };
    expect(buildIntakeRequestFields(noColors).palette).toBeUndefined();
  });

  it('forwards a non-auto background', () => {
    const a: AiIntakeAnswers = { ...DEFAULT_INTAKE_ANSWERS, background: 'gradient' };
    expect(buildIntakeRequestFields(a).background).toBe('gradient');
  });

  it('forwards selected widgets and omits an empty set', () => {
    const a: AiIntakeAnswers = { ...DEFAULT_INTAKE_ANSWERS, widgets: ['headline', 'logo'] };
    expect(buildIntakeRequestFields(a).widgets).toEqual(['headline', 'logo']);
    expect(buildIntakeRequestFields(DEFAULT_INTAKE_ANSWERS).widgets).toBeUndefined();
  });

  it('builds a full directive body from a fully-answered wizard', () => {
    const a: AiIntakeAnswers = {
      purpose: 'promo',
      theme: 'Neon',
      paletteMode: 'custom',
      paletteColors: ['#facc15', '#0a0a0a'],
      background: 'photo',
      widgets: ['headline', 'cta'],
    };
    expect(buildIntakeRequestFields(a)).toEqual({
      purpose: 'promo',
      theme: 'neon-sports',
      palette: { colors: ['#facc15', '#0a0a0a'] },
      background: 'photo',
      widgets: ['headline', 'cta'],
    });
  });
});

describe('ai-intake-contract: mappings point at REAL signage-design ids (drift guards)', () => {
  it('every purpose→archetype value is a real archetype id', () => {
    for (const archetypeId of Object.values(PURPOSE_TO_ARCHETYPE)) {
      expect(REAL_ARCHETYPE_IDS).toContain(archetypeId);
    }
  });

  it('every theme→id value is a real theme id', () => {
    for (const themeId of Object.values(THEME_TO_ID)) {
      expect(REAL_THEME_IDS).toContain(themeId);
    }
  });

  it('every widget→widgetType is one the WidgetRenderer supports', () => {
    // The supported set this contract relies on (subset of WidgetRenderer cases).
    const SUPPORTED = ['TEXT', 'LOGO', 'IMAGE', 'CLOCK', 'WEATHER', 'COUNTDOWN', 'LUNCH_MENU', 'TICKER'];
    for (const wt of Object.values(WIDGET_TO_TYPE)) {
      expect(SUPPORTED).toContain(wt);
    }
  });
});

describe('ai-intake-contract: option lists are coherent', () => {
  it('default-widgets-by-purpose only reference real widget keys', () => {
    const validWidgetKeys = WIDGET_OPTIONS.map((w) => w.key);
    for (const list of Object.values(DEFAULT_WIDGETS_BY_PURPOSE)) {
      for (const w of list) expect(validWidgetKeys).toContain(w);
    }
  });

  it('every non-auto purpose option has a default-widget set', () => {
    for (const o of PURPOSE_OPTIONS) {
      // 'auto' lets the AI choose the purpose — it intentionally has no fixed
      // default-widget set (the type includes it; this map covers the concrete
      // purposes only). Narrowing past it also keeps the index type-safe.
      if (o.key === 'auto') continue;
      expect(DEFAULT_WIDGETS_BY_PURPOSE[o.key]).toBeDefined();
      expect(DEFAULT_WIDGETS_BY_PURPOSE[o.key].length).toBeGreaterThan(0);
    }
  });

  it('every theme option has a mapping to a real id', () => {
    for (const t of THEME_OPTIONS) {
      expect(THEME_TO_ID[t.key]).toBeTruthy();
    }
  });
});
