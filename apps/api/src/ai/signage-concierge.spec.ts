/**
 * Unit tests for the Signage Concierge PURE module (2026-06-28).
 * No Nest / Prisma / network — just the defensive parse + clamp helpers.
 */
import {
  parseConciergeTurn,
  clampConciergeIntake,
  buildConciergeSystemPrompt,
  summarizeUrlReference,
  rankLogoCandidates,
  rankPhotoCandidates,
} from './signage-concierge';
import { extractMenuFromSite, describeExtractedMenu } from './menu-extractor';
import { BrandingScraperService, type RankedColor, type RankedFont } from '../branding/branding-scraper.service';
import type { ResolvedDesignerAssets, CheckedAsset } from './designer-assets';

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

  it('a menu board needs the REAL menu — never promise to pull items from a site that gave none (2026-09-22)', () => {
    const prompt = buildConciergeSystemPrompt({ canvas: { w: 1920, h: 1080 } });
    expect(prompt).toContain('A MENU BOARD NEEDS THE REAL MENU');
    expect(prompt).toContain('NEVER say you will pull items from a site that gave you none');
    expect(prompt).toContain('Paste your menu here');
    expect(prompt).toContain('keep ready=false for a menu board');
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

// ───────────────────────────────────────────────────────────────────────────
// THE REFERENCE'S LOGO, PHOTO, PALETTE AND FONTS (2026-09-22 — Super Taco)
// ───────────────────────────────────────────────────────────────────────────
describe('summarizeUrlReference — fonts, honest wording, checked assets', () => {
  // FIXTURE PROVENANCE: the fonts are RankedFont objects made by the REAL
  // producer (the scraper's CSS pass), not hand-written — hand-written string
  // fonts are exactly why "Fonts: [object Object] / [object Object]" shipped.
  function scrapedFonts(): { heading: RankedFont | null; body: RankedFont | null } {
    const svc = new BrandingScraperService();
    const colors = new Map<string, RankedColor>();
    const fonts = new Map<string, RankedFont>();
    (svc as unknown as { extractFromCss: (c: string, a: typeof colors, b: typeof fonts) => void }).extractFromCss(
      'h1, h2 { font-family: "Playfair Display", Georgia, serif; } body { font-family: Lato, sans-serif; }',
      colors,
      fonts,
    );
    const all = [...fonts.values()];
    return {
      heading: all.find((f) => f.role === 'heading') ?? null,
      body: all.find((f) => f.role === 'body') ?? null,
    };
  }

  const asset = (over: Partial<CheckedAsset>): CheckedAsset => ({
    url: 'https://sb.example/storage/v1/object/public/assets/ai-designer/t1/x.png',
    sourceUrl: 'https://static.wixstatic.com/media/abc~mv2.png',
    source: 'site',
    width: 4513,
    height: 1263,
    storedWidth: 1500,
    storedHeight: 420,
    format: 'png',
    ...over,
  });

  const checked = (over: Partial<ResolvedDesignerAssets> = {}): ResolvedDesignerAssets => ({
    logo: asset({}),
    photo: asset({
      url: 'https://sb.example/storage/v1/object/public/assets/ai-designer/t1/p.jpg',
      width: 6000,
      height: 4000,
      format: 'jpeg',
    }),
    palette: ['#f76422', '#fceb00'],
    paletteSource: 'logo',
    rejected: [],
    ...over,
  });

  const preview = {
    displayName: 'Super Taco',
    palette: { primary: '#996738', accent: '#c7d7e4' },
    colors: [{ hex: '#116dff' }],
    logos: [
      {
        url: 'https://static.wixstatic.com/media/abc~mv2.png/v1/fill/w_700,h_196/logo.png',
        kind: 'img-logo',
        score: 109,
        headerMark: true,
      },
    ],
    heroImages: [{ url: 'https://static.wixstatic.com/media/def~mv2.jpg', kind: 'large-img', naturalWidth: 6000, naturalHeight: 4000 }],
  };

  it('names the scraped fonts — never "[object Object]"', () => {
    const fonts = scrapedFonts();
    expect(fonts.heading).toBeTruthy(); // the producer really returns objects
    const ref = summarizeUrlReference({ displayName: 'Joe Coffee', fonts }, 'https://joecoffee.com/');
    expect(ref.summary).not.toContain('[object Object]');
    expect(ref.summary).toContain('Fonts: Playfair Display / Lato.');
  });

  it('with CHECKED assets: our URLs, the logo palette, and what was checked — never "verified"', () => {
    const ref = summarizeUrlReference(preview, 'https://www.supertacomex.com/', checked());
    expect(ref.logoUrl).toBe('https://sb.example/storage/v1/object/public/assets/ai-designer/t1/x.png');
    expect(ref.imageUrl).toBe('https://sb.example/storage/v1/object/public/assets/ai-designer/t1/p.jpg');
    expect(ref.palette).toEqual(['#f76422', '#fceb00']);
    expect((ref as Record<string, unknown>).imageSource).toBe('site');
    expect(ref.summary).toContain('Brand palette (from their logo): #f76422, #fceb00.');
    expect(ref.summary).toContain("Logo: the venue's own logo, read from their site and checked (4513×1263 PNG)");
    expect(ref.summary).toContain("Photo: one of the venue's own photos from their site, checked (6000×4000)");
    expect(ref.summary).not.toMatch(/verified/i);
    // No styling orders ride along with a photo any more.
    expect(ref.summary).not.toMatch(/scrim|duotone/i);
    // The food photo's browns from the preview never reach the reference.
    expect(ref.palette).not.toContain('#996738');
  });

  it('labels a STOCK photo as stock — never the venue\'s own', () => {
    const ref = summarizeUrlReference(
      preview,
      'https://www.supertacomex.com/',
      checked({ photo: asset({ source: 'stock', stockQuery: 'mexican food tacos', format: 'jpeg' }) }),
    );
    expect(ref.summary).toContain('STOCK photo ("mexican food tacos") — not the venue\'s own');
    expect((ref as Record<string, unknown>).imageSource).toBe('stock');
  });

  it('with nothing usable: says so plainly and carries NO image URL at all', () => {
    const ref = summarizeUrlReference(
      preview,
      'https://www.supertacomex.com/',
      checked({ logo: null, photo: null, palette: ['#996738'], paletteSource: 'page' }),
    );
    expect(ref.logoUrl).toBeUndefined();
    expect(ref.imageUrl).toBeUndefined();
    expect(ref.summary).toContain('Logo: no usable logo image could be prepared from the site — set the brand name in type.');
    expect(ref.summary).toMatch(/Photo: no usable photo could be prepared from the site/);
    expect(ref.summary).toContain("Brand palette (from the site's colors — the logo gave none)");
  });

  it('flags a small real logo so the board keeps it modest', () => {
    const ref = summarizeUrlReference(preview, 'https://x.example/', checked({ logo: asset({ width: 350, height: 98, lowRes: true }) }));
    expect(ref.summary).toContain('only a small version exists');
  });

  it('WITHOUT assets (unchecked): the ranked picks, labelled as not yet checked', () => {
    const ref = summarizeUrlReference(preview, 'https://www.supertacomex.com/');
    expect(ref.logoUrl).toBe('https://static.wixstatic.com/media/abc~mv2.png'); // the CDN original
    expect(ref.imageUrl).toBe('https://static.wixstatic.com/media/def~mv2.jpg');
    expect(ref.summary).toContain('(not yet checked)');
    expect(ref.summary).not.toMatch(/verified/i);
  });
});

describe('rankLogoCandidates — the real mark before any site icon', () => {
  it('orders every header mark (by score) before the fallbacks, drops photos and demoted marks, keeps inline SVG', () => {
    const svg = '<svg viewBox="0 0 10 10"><path fill="#e8112d" d="M0 0h10v10H0z"/></svg>';
    const ranked = rankLogoCandidates({
      logos: [
        { url: 'https://acme.example/apple-touch-icon.png', kind: 'apple-touch', score: 85 },
        { url: 'https://acme.example/food.png', kind: 'icon', score: 82, photographic: true },
        { url: 'https://acme.example/img/best-of-2019.png', kind: 'img-logo', score: 23, filterReasons: ['award/partner badge'] },
        {
          url: 'https://static.wixstatic.com/media/logo~mv2.png/v1/fill/w_700,h_196/acme_logo.png',
          kind: 'img-logo',
          score: 70,
          headerMark: true,
        },
        { url: '', kind: 'svg-inline', svgInline: svg, isSvg: true, score: 95, headerMark: true },
      ],
    });
    expect(ranked.map((c) => [c.tier, c.kind])).toEqual([
      ['real', 'svg-inline'],
      ['real', 'img-logo'],
      ['fallback', 'apple-touch'],
    ]);
    // The Wix rendition is replaced by its original, with the rendition kept as a fallback.
    expect(ranked[1].url).toBe('https://static.wixstatic.com/media/logo~mv2.png');
    expect(ranked[1].fallbackUrls).toEqual(['https://static.wixstatic.com/media/logo~mv2.png/v1/fill/w_700,h_196/acme_logo.png']);
    expect(ranked[0].svgInline).toBe(svg);
  });

  it('a logo-named image outside the header is a fallback: it competes with the site icon on score', () => {
    // A footer partner strip ("chamber-logo.png") is not the venue's mark. It
    // must not jump the queue ahead of the venue's own touch icon.
    const ranked = rankLogoCandidates({
      logos: [
        { url: 'https://acme.example/img/chamber-logo.png', kind: 'img-logo', score: 60 },
        { url: 'https://acme.example/apple-touch-icon.png', kind: 'apple-touch', score: 85 },
      ],
    });
    expect(ranked.map((c) => [c.tier, c.kind])).toEqual([
      ['fallback', 'apple-touch'],
      ['fallback', 'img-logo'],
    ]);
  });

  it('treats a kind-less URL (older callers) as a real mark unless it is named like a site icon', () => {
    const ranked = rankLogoCandidates({
      logos: ['https://acme.example/favicon-192.png', { url: 'https://acme.example/logo.svg' }],
    });
    expect(ranked.map((c) => c.tier)).toEqual(['real', 'fallback']);
    expect(ranked[0].url).toBe('https://acme.example/logo.svg');
    expect(ranked[0].isSvg).toBe(true);
  });
});

describe('rankPhotoCandidates — the biggest real photo, never a placeholder', () => {
  it('prefers the largest known CONTENT photo, recovers a Wix blur placeholder, drops an unrecoverable one', () => {
    const ranked = rankPhotoCandidates({
      ogImage: 'https://acme.example/og-card.jpg',
      heroImages: [
        { url: 'https://acme.example/og-card.jpg', kind: 'og', score: 80 },
        {
          url: 'https://static.wixstatic.com/media/hero~mv2.jpg/v1/fill/w_151,h_101,al_c,blur_2/hero~mv2.jpg',
          kind: 'large-img',
          width: 1805,
          height: 670,
          naturalWidth: 6000,
          naturalHeight: 4000,
          placeholder: true,
        },
        { url: 'https://acme.example/lqip/patio.jpg', kind: 'large-img', width: 1805, height: 1388 },
        { url: 'https://acme.example/img/patio-small.jpg', kind: 'large-img', width: 900, height: 600 },
      ],
    });
    expect(ranked.map((c) => c.url)).toEqual([
      'https://static.wixstatic.com/media/hero~mv2.jpg',
      'https://acme.example/img/patio-small.jpg',
      'https://acme.example/og-card.jpg',
    ]);
    expect(ranked[0]).toMatchObject({ width: 6000, height: 4000, fallbackUrls: [] });
  });
});
