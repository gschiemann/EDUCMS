/**
 * Unit tests for the Signage Concierge PURE module (2026-06-28).
 * No Nest / Prisma / network — just the defensive parse + clamp helpers.
 */
import {
  parseConciergeTurn,
  clampConciergeIntake,
  buildConciergeSystemPrompt,
  summarizeUrlReference,
} from './signage-concierge';
import { extractMenuFromSite, describeExtractedMenu } from './menu-extractor';

describe('parseConciergeTurn', () => {
  it('parses a clean JSON envelope', () => {
    const raw = JSON.stringify({
      reply: 'Got it — bold and appetizing?',
      intake: { purpose: 'menu', theme: 'Bold', background: 'photo', widgets: ['headline', 'menu'] },
      missing: ['the actual items'],
      ready: false,
      brief: 'A bold menu board for a burger joint.',
    });
    const turn = parseConciergeTurn(raw);
    expect(turn.reply).toBe('Got it — bold and appetizing?');
    expect(turn.intake.purpose).toBe('menu');
    expect(turn.intake.theme).toBe('Bold');
    expect(turn.intake.background).toBe('photo');
    expect(turn.intake.widgets).toEqual(['headline', 'menu']);
    expect(turn.missing).toEqual(['the actual items']);
    expect(turn.ready).toBe(false);
    expect(turn.brief).toContain('bold menu board');
  });

  it('parses JSON wrapped in markdown fences', () => {
    const raw = '```json\n' + JSON.stringify({ reply: 'Hi', intake: { purpose: 'welcome' }, ready: true, brief: 'b' }) + '\n```';
    const turn = parseConciergeTurn(raw);
    expect(turn.reply).toBe('Hi');
    expect(turn.intake.purpose).toBe('welcome');
    expect(turn.ready).toBe(true);
  });

  it('recovers JSON with a preamble sentence before the object', () => {
    const raw = 'Sure, here you go: ' + JSON.stringify({ reply: 'Picked it', intake: { theme: 'Neon' }, ready: false, brief: '' });
    const turn = parseConciergeTurn(raw);
    expect(turn.reply).toBe('Picked it');
    expect(turn.intake.theme).toBe('Neon');
  });

  it('degrades gracefully on total garbage — keeps the chat alive', () => {
    const raw = 'this is not json at all, just a sentence';
    const turn = parseConciergeTurn(raw);
    expect(turn.reply).toBe('this is not json at all, just a sentence');
    expect(turn.intake).toEqual({});
    expect(turn.missing).toEqual([]);
    expect(turn.ready).toBe(false);
    expect(turn.brief).toBe('');
  });

  it('falls back to a friendly default reply on empty input', () => {
    const turn = parseConciergeTurn('');
    expect(turn.reply.length).toBeGreaterThan(0);
    expect(turn.ready).toBe(false);
  });

  it('supplies a default reply when JSON parses but reply is missing', () => {
    const raw = JSON.stringify({ intake: { purpose: 'promo' }, ready: false });
    const turn = parseConciergeTurn(raw);
    expect(turn.reply.length).toBeGreaterThan(0);
    expect(turn.intake.purpose).toBe('promo');
  });

  it('unwraps a DOUBLE-ENCODED envelope (GPT-5 nests the whole thing in reply)', () => {
    // GPT-5 sometimes returns {reply: "<the real envelope as a JSON string>"}.
    const inner = {
      reply: 'Got it — a bold burger menu it is.',
      intake: { purpose: 'menu', theme: 'Bold', widgets: ['headline', 'menu'] },
      missing: ['the prices'],
      ready: false,
      brief: 'A bold menu board.',
    };
    const raw = JSON.stringify({ reply: JSON.stringify(inner) });
    const turn = parseConciergeTurn(raw);
    // The customer must NOT see raw JSON — the inner reply surfaces.
    expect(turn.reply).toBe('Got it — a bold burger menu it is.');
    expect(turn.reply).not.toContain('{');
    // …and the inner structured fields are recovered, not lost.
    expect(turn.intake.purpose).toBe('menu');
    expect(turn.intake.theme).toBe('Bold');
    expect(turn.intake.widgets).toEqual(['headline', 'menu']);
    expect(turn.missing).toEqual(['the prices']);
    expect(turn.brief).toContain('bold menu board');
  });

  it('leaves a plain non-JSON reply intact (does not over-unwrap)', () => {
    const raw = JSON.stringify({
      reply: 'What hours should the board show?',
      intake: { purpose: 'event' },
      ready: false,
      brief: '',
    });
    const turn = parseConciergeTurn(raw);
    expect(turn.reply).toBe('What hours should the board show?');
    expect(turn.intake.purpose).toBe('event');
  });
});

describe('clampConciergeIntake', () => {
  it('returns empty for non-objects', () => {
    expect(clampConciergeIntake(null)).toEqual({});
    expect(clampConciergeIntake('nope')).toEqual({});
    expect(clampConciergeIntake(42)).toEqual({});
  });

  it('drops invalid purpose / background enums', () => {
    const out = clampConciergeIntake({ purpose: 'destroy-the-world', background: 'hologram' });
    expect(out.purpose).toBeUndefined();
    expect(out.background).toBeUndefined();
  });

  it('keeps valid purpose / background enums', () => {
    const out = clampConciergeIntake({ purpose: 'event', background: 'gradient' });
    expect(out.purpose).toBe('event');
    expect(out.background).toBe('gradient');
  });

  it("accepts palette === 'brand'", () => {
    const out = clampConciergeIntake({ palette: 'brand' });
    expect(out.palette).toBe('brand');
  });

  it('accepts a { colors } palette and normalizes hexes', () => {
    const out = clampConciergeIntake({ palette: { colors: ['#ff0000', '00ff00', 'not-a-color'] } });
    expect(out.palette).toEqual({ colors: ['#ff0000', '#00ff00'] });
  });

  it('drops a { colors } palette with no valid colors', () => {
    const out = clampConciergeIntake({ palette: { colors: ['banana', ''] } });
    expect(out.palette).toBeUndefined();
  });

  it('filters widgets to the allow-list and dedupes', () => {
    const out = clampConciergeIntake({ widgets: ['headline', 'headline', 'bogus', 'qr'] });
    expect(out.widgets).toEqual(['headline', 'qr']);
  });

  it('accepts an arbitrary theme label (re-resolved downstream) and clamps length', () => {
    const out = clampConciergeIntake({ theme: 'Some Very Long Custom Theme Name That Exceeds The Forty Char Cap' });
    expect(out.theme).toBeDefined();
    expect((out.theme as string).length).toBeLessThanOrEqual(40);
  });
});

describe('buildConciergeSystemPrompt', () => {
  it('produces a non-empty prompt and folds in references + brand', () => {
    const prompt = buildConciergeSystemPrompt({
      vertical: 'bar',
      brandPrimary: '#112233',
      brandAccent: '#445566',
      brandVoice: 'cheeky and fun',
      canvas: { w: 1920, h: 1080 },
      references: [{ kind: 'url', label: 'example.com', summary: 'A sleek dark bar site', palette: ['#000000'] }],
    });
    expect(prompt).toContain('Signage Concierge');
    expect(prompt).toContain('bar');
    expect(prompt).toContain('landscape');
    expect(prompt).toContain('#112233');
    expect(prompt).toContain('cheeky and fun');
    expect(prompt).toContain('A sleek dark bar site');
  });

  it('tells the model to close a READY turn with the Generate button, never "Shall I proceed?" (2026-09-22)', () => {
    const prompt = buildConciergeSystemPrompt({ canvas: { w: 1920, h: 1080 } });
    expect(prompt).toContain('hit Generate 3 boards below');
    expect(prompt).toContain('NEVER ask "Shall I proceed?"');
    expect(prompt).toContain('NEVER say you are generating');
  });

  it('marks portrait orientation when h > w', () => {
    const prompt = buildConciergeSystemPrompt({ canvas: { w: 1080, h: 1920 } });
    expect(prompt).toContain('portrait');
  });
});

describe('summarizeUrlReference', () => {
  it('summarizes a BrandingPreview-shaped object into a url reference', () => {
    const preview = {
      displayName: 'Joe Coffee',
      tagline: 'Small-batch roasts',
      palette: { primary: '#6f4e37', accent: '#d2b48c' },
      colors: [{ hex: '#6f4e37' }, { hex: '#d2b48c' }],
      fonts: { heading: 'Playfair Display', body: 'Inter' },
      heroImages: [{ url: 'https://example.com/hero.jpg' }],
      ogImage: 'https://example.com/og.png',
    };
    const ref = summarizeUrlReference(preview, 'https://joecoffee.com/');
    expect(ref.kind).toBe('url');
    expect(ref.label).toBe('joecoffee.com');
    expect(ref.summary).toContain('Joe Coffee');
    expect(ref.summary).toContain('Small-batch roasts');
    expect(ref.palette).toContain('#6f4e37');
    expect(ref.imageUrl).toBe('https://example.com/hero.jpg');
  });

  it('handles a near-empty preview without throwing', () => {
    const ref = summarizeUrlReference({}, 'https://unknown.example');
    expect(ref.kind).toBe('url');
    expect(ref.summary.length).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// THE REAL MENU IN THE PROMPT (2026-09-22)
//
// FIXTURE PROVENANCE: the `menu` on the reference below is not hand-written —
// it is produced by the REAL producer, `extractMenuFromSite`, run over a
// schema.org-shaped JSON-LD document (the property names and nesting come from
// the Menu / MenuSection / MenuItem examples published on schema.org, which
// `menu-extractor.spec.ts` carries verbatim — including the single-object
// `hasMenuItem` quirk, reproduced on the Drinks section here). If the
// extractor's output shape ever drifts, this block drifts with it instead of
// quietly agreeing with a stale hand-made object.
// ───────────────────────────────────────────────────────────────────────────
describe("buildConciergeSystemPrompt — a reference carrying the venue's REAL menu", () => {
  let reference: any;

  beforeAll(async () => {
    const jsonLd = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      name: 'Super Taco',
      hasMenu: {
        '@type': 'Menu',
        hasMenuSection: [
          {
            '@type': 'MenuSection',
            name: 'Tacos',
            hasMenuItem: [
              { '@type': 'MenuItem', name: 'Al Pastor', description: 'marinated pork, pineapple', offers: { '@type': 'Offer', price: '4.25', priceCurrency: 'USD' } },
              { '@type': 'MenuItem', name: 'Carnitas', offers: { '@type': 'Offer', price: '4.25', priceCurrency: 'USD' } },
            ],
          },
          {
            '@type': 'MenuSection',
            name: 'Drinks',
            hasMenuItem: { '@type': 'MenuItem', name: 'Horchata', offers: { '@type': 'Offer', price: '3.00', priceCurrency: 'USD' } },
          },
        ],
      },
    });
    const html = `<!doctype html><html><head><script type="application/ld+json">${jsonLd}</script></head><body><h1>Super Taco</h1></body></html>`;
    const fetch = (async () => ({
      body: Buffer.from(html, 'utf-8'),
      contentType: 'text/html; charset=utf-8',
      finalUrl: 'https://supertaco.example/menu',
      status: 200,
    })) as any;
    const menu = await extractMenuFromSite('https://supertaco.example/menu', { fetch });
    expect(menu).not.toBeNull();
    reference = {
      kind: 'url',
      label: 'supertaco.example',
      summary: `${describeExtractedMenu(menu!)} Brand: Super Taco.`,
      menu,
    };
  });

  it('lists every section, item and price so the model can SEE what we hold', () => {
    const prompt = buildConciergeSystemPrompt({ vertical: 'restaurant', references: [reference] });
    expect(prompt).toContain('▸ Tacos');
    expect(prompt).toContain('- Al Pastor — $4.25 — marinated pork, pineapple');
    expect(prompt).toContain('- Carnitas — $4.25');
    expect(prompt).toContain('▸ Drinks');
    expect(prompt).toContain('- Horchata — $3');
    expect(prompt).toContain('REAL MENU read from this site — 3 items');
  });

  it('forbids asking the operator to type a menu we are already holding', () => {
    const prompt = buildConciergeSystemPrompt({ vertical: 'restaurant', references: [reference] });
    expect(prompt).toMatch(/NEVER ask the customer to type, paste, list, confirm item-by-item/);
    expect(prompt).toMatch(/ACKNOWLEDGE what you found, with the count/);
    // The intake + brief contract the designer depends on.
    expect(prompt).toMatch(/"widgets" MUST include "menu"/);
    expect(prompt).toMatch(/REAL CONTENT block/);
    expect(prompt).toMatch(/no item, price, combo or deal may be invented/i);
  });

  it('leaves the ready-turn rule (end by pointing at the Generate button) untouched', () => {
    const prompt = buildConciergeSystemPrompt({ vertical: 'restaurant', references: [reference] });
    expect(prompt).toContain('hit Generate 3 boards below');
    expect(prompt).toContain('NEVER ask "Shall I proceed?"');
  });

  it('says NOTHING about menus when the reference carries none (zero regression)', () => {
    const plain = { kind: 'url' as const, label: 'joecoffee.com', summary: 'Brand: Joe Coffee.' };
    const prompt = buildConciergeSystemPrompt({ vertical: 'restaurant', references: [plain] });
    expect(prompt).toContain('Brand: Joe Coffee.');
    expect(prompt).not.toContain('REAL MENU read from this site');
    expect(prompt).not.toContain('NEVER ask the customer to type');
  });

  it('survives a malformed menu (empty sections / junk items) without emitting a stub block', () => {
    const shapes: any[] = [
      { sections: [] },
      { sections: [{ name: 'X', items: [] }] },
      { sections: [{ name: 'X', items: [{}] }] },
      { sections: 'nope' },
    ];
    for (const menu of shapes) {
      const prompt = buildConciergeSystemPrompt({
        vertical: 'restaurant',
        references: [{ kind: 'url' as const, summary: 's', menu } as any],
      });
      expect(prompt).not.toContain('REAL MENU read from this site');
    }
  });
});
