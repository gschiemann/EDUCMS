/**
 * POST /templates/concierge/reference/url — the pasted site now yields the
 * venue's REAL MENU, not just its branding (2026-09-22).
 *
 * Greg pasted his restaurant's website into the AI template dialog and asked
 * for a menu board. The Concierge replied "I'll pull the menu items from your
 * website" and wrote a brief saying "Include all menu items from the website
 * with their prices" — and the three boards came back carrying his tenant's
 * TEST price book (burger $2.99 / fries $3.00 / shake $5.00). This endpoint had
 * never read a menu in its life; it scraped BRANDING and stopped.
 *
 * FIXTURE PROVENANCE: the `menu` handed back by the AiService double is
 * produced by the REAL producer — `extractMenuFromSite` run over a
 * schema.org-shaped JSON-LD document — never hand-written in the shape this
 * endpoint happens to want. The BrandingPreview double is in the shape
 * `BrandingScraperService.scrape` returns (displayName / description /
 * keyMessages / palette / colors / fonts / logos / heroImages), the same shape
 * `summarizeUrlReference`'s own spec feeds it.
 */
import { HttpException } from '@nestjs/common';
import { TemplatesController } from './templates.controller';
import { extractMenuFromSite, type ExtractedMenu } from '../ai/menu-extractor';

const SCHEMA_ORG_MENU_PAGE = (() => {
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
  return `<!doctype html><html><head><script type="application/ld+json">${jsonLd}</script></head><body><h1>Super Taco</h1></body></html>`;
})();

/** The BrandingPreview shape `BrandingScraperService.scrape` returns. */
const BRANDING_PREVIEW = {
  displayName: 'Super Taco',
  description: 'Street tacos and aguas frescas in the Mission',
  keyMessages: ['Handmade tortillas, every morning'],
  palette: { primary: '#e2452a', accent: '#f4c430' },
  colors: [{ hex: '#e2452a' }, { hex: '#f4c430' }],
  fonts: { heading: 'Anton', body: 'Inter' },
  logos: [{ url: 'https://supertaco.example/logo.svg' }],
  heroImages: [{ url: 'https://supertaco.example/hero.jpg', width: 1600, height: 900, kind: 'large-img' }],
};

async function realMenu(): Promise<ExtractedMenu> {
  const fetch = (async () => ({
    body: Buffer.from(SCHEMA_ORG_MENU_PAGE, 'utf-8'),
    contentType: 'text/html; charset=utf-8',
    finalUrl: 'https://supertaco.example/menu',
    status: 200,
  })) as any;
  const menu = await extractMenuFromSite('https://supertaco.example/menu', { fetch });
  if (!menu) throw new Error('fixture producer returned no menu');
  return menu;
}

function makeController(over: {
  scrape?: () => Promise<any>;
  extractSiteMenu?: () => Promise<ExtractedMenu | null>;
} = {}) {
  const brandingScraper: any = {
    scrape: jest.fn(over.scrape ?? (async () => BRANDING_PREVIEW)),
  };
  const ai: any = {
    extractSiteMenu: jest.fn(over.extractSiteMenu ?? (async () => null)),
  };
  const controller = Object.create(TemplatesController.prototype) as TemplatesController;
  (controller as any).brandingScraper = brandingScraper;
  (controller as any).ai = ai;
  return { controller, brandingScraper, ai };
}

const req = { user: { tenantId: 't1', id: 'u1', role: 'SCHOOL_ADMIN' } } as any;

describe('POST concierge/reference/url — menu attachment', () => {
  it('attaches the real menu and LEADS the summary with what it found', async () => {
    const menu = await realMenu();
    const { controller, ai } = makeController({ extractSiteMenu: async () => menu });

    const ref: any = await controller.conciergeReferenceUrl(req, { url: 'supertaco.example' } as any);

    // The menu rides structurally, so the designer can render every row.
    expect(ref.menu).toEqual(menu);
    expect(ref.menu.itemCount).toBe(3);
    expect(ref.menu.sections.map((s: any) => s.name)).toEqual(['Tacos', 'Drinks']);

    // …and the summary — the text the concierge model actually reads — says so
    // FIRST, before any of the branding it used to lead with.
    expect(ref.summary.startsWith('Menu found on /menu: 3 items in 2 sections (Tacos, Drinks). USE THESE EXACT items and prices.')).toBe(true);
    expect(ref.summary).toContain('Super Taco');
    expect(ref.summary.length).toBeLessThanOrEqual(4000);

    // Branding is untouched by any of this.
    expect(ref.kind).toBe('url');
    expect(ref.label).toBe('supertaco.example');
    expect(ref.palette).toContain('#e2452a');
    expect(ref.logoUrl).toBe('https://supertaco.example/logo.svg');
    expect(ref.imageUrl).toBe('https://supertaco.example/hero.jpg');

    // Scheme-less input is normalized before either read.
    expect(ai.extractSiteMenu).toHaveBeenCalledWith({ tenantId: 't1', userId: 'u1', url: 'https://supertaco.example' });
  });

  it('is byte-identical to the old behaviour when the site has no menu', async () => {
    const { controller } = makeController({ extractSiteMenu: async () => null });
    const ref: any = await controller.conciergeReferenceUrl(req, { url: 'https://joecoffee.example' } as any);
    expect(ref.menu).toBeUndefined();
    expect(ref.summary.startsWith('Brand: Super Taco.')).toBe(true);
    expect(ref.summary).not.toContain('Menu found on');
  });

  it('ignores an empty menu rather than advertising zero items', async () => {
    const empty = { sections: [], itemCount: 0, source: { url: 'https://x.example/', method: 'jsonld' as const } };
    const { controller } = makeController({ extractSiteMenu: async () => empty });
    const ref: any = await controller.conciergeReferenceUrl(req, { url: 'https://x.example' } as any);
    expect(ref.menu).toBeUndefined();
    expect(ref.summary).not.toContain('Menu found on');
  });

  it('still surfaces the friendly 422 when the SCRAPE fails (menu read never runs)', async () => {
    const { controller, ai } = makeController({
      scrape: async () => { const e: any = new Error('blocked'); e.name = 'BotProtectionError'; throw e; },
    });
    (controller as any).auditLogger = { warn: jest.fn() };
    await expect(controller.conciergeReferenceUrl(req, { url: 'https://blocked.example' } as any))
      .rejects.toBeInstanceOf(HttpException);
    expect(ai.extractSiteMenu).not.toHaveBeenCalled();
  });
});
