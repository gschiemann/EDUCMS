/**
 * menu-extractor.spec.ts — the operator's REAL menu, read off their own site.
 *
 * FIXTURE PROVENANCE (the binding rule: a fixture is cut from the PRODUCER,
 * never written in the shape the code expects):
 *
 *  - `SCHEMA_ORG_EXAMPLE_1` / `SCHEMA_ORG_EXAMPLE_2` are the JSON-LD examples
 *    published on https://schema.org/Menu (fetched 2026-09-22), reproduced
 *    byte-for-byte including the properties we do NOT read (`servesCuisine`,
 *    `image`, a MenuSection-level `offers` that carries availability and no
 *    price, `nutrition`, `suitableForDiet`) and the producer's own shape
 *    quirks: `hasMenu`/`hasMenuSection`/`hasMenuItem` appear as SINGLE OBJECTS
 *    in Example 1 and as ARRAYS in Example 2, and Example 2's "Dinner" section
 *    carries no items at all — only nested sub-sections. Those quirks are the
 *    whole reason this parser exists; writing a tidy array-of-sections fixture
 *    would have tested nothing.
 *  - `YOAST_GRAPH_WRAPPER` is the `{"@context":…,"@graph":[…]}` envelope every
 *    WordPress/Yoast site emits, wrapped around schema.org's own Example 1 node.
 *  - The model-reply fixtures are in the shape the PRODUCER of that text (a
 *    model answering MENU_EXTRACTION_SYSTEM_PROMPT) emits — strict JSON, and
 *    the fenced variant every provider produces some fraction of the time.
 */
import {
  extractMenuFromSite,
  discoverMenuLinks,
  visibleMenuText,
  normalizeMenuPrice,
  describeExtractedMenu,
  dropUnverifiedPrices,
  MENU_MAX_ITEMS,
  MENU_MAX_SECTIONS,
  MENU_NAME_MAX,
  MENU_DESC_MAX,
} from './menu-extractor';
import { SsrfError } from '../branding/safe-fetch';

// ───────────────────────────────────────────────────────────────────────────
// Fixtures — schema.org's own published examples, verbatim.
// ───────────────────────────────────────────────────────────────────────────

const SCHEMA_ORG_EXAMPLE_1 = `{
   "@context":"https://schema.org",
   "@type":"Restaurant",
   "url":"http://www.somerestaurant.com",
   "name":"Some Restaurant",
   "description":"This is the Some Restaurant located on 345 Spear St. San Francisco, 94105 CA. It serves Indian-Mexican fusion cuisine",
   "servesCuisine":[
      "Indian-Mexican Fusion"
   ],
   "hasMenu":{
      "@type":"Menu",
      "hasMenuSection":{
         "@type":"MenuSection",
         "name":"Tacos",
         "description":"Tacos inspired by India cuisine.",
         "image":[
            "https://somerestaurant.com/some_tacos.jpg",
            "https://somerestaurant.com/more_tacos.jpg"
         ],
         "offers":{
            "@type":"Offer",
            "availabilityEnds":"2017-03-02T08:22:00",
            "availabilityStarts":"2017-03-02T08:22:00"
         },
         "hasMenuItem":{
            "@type":"MenuItem",
            "name":"Aloo Gobi Taco",
            "description":"Mexico City-style street corn tortilla taco filled with a flavorful mixture of mildly south Indian spiced cauliflower, potato, tomato, onions and bell peppers.",
            "offers":{
               "@type":"Offer",
               "price":"3.50",
               "priceCurrency":"USD"
            },
            "nutrition":{
               "@type":"NutritionInformation",
               "calories":"170 calories",
               "fatContent":"3 grams",
               "fiberContent":"2 grams",
               "proteinContent":"4 grams"
            },
            "suitableForDiet":"https://schema.org/GlutenFreeDiet"
         }
      },
      "inLanguage":"English"
   }
}`;

const SCHEMA_ORG_EXAMPLE_2 = `{
   "@context":"https://schema.org",
   "@type":"Restaurant",
   "url":"http://www.thisisarestaurant.com",
   "name":"The Restaurant",
   "image":"http://www.example.com/image-of-some-restaurant.jpg",
   "description":"This is an example restaurant that serves American cuisine.",
   "servesCuisine":[
      "American cuisine"
   ],
   "hasMenu":{
      "@type":"Menu",
      "name":"Dine-In Menu",
      "description":"Menu for in-restaurant dining only.",
      "hasMenuSection":[
         {
            "@type":"MenuSection",
            "name":"Dinner",
            "description":"Dinner dishes",
            "image":"https://thisisarestaurant.com/dinner_dishes.jpg",
            "offers":{
               "@type":"Offer",
               "availabilityEnds":"2017-03-02T08:22:00",
               "availabilityStarts":"2017-03-02T08:22:00"
            },
            "hasMenuSection":[
               {
                  "@type":"MenuSection",
                  "name":"Starters",
                  "description":"Appetizers and such",
                  "image":"https://thisisarestaurant.com/starter_dishes.jpg",
                  "offers":{
                     "@type":"Offer",
                     "availabilityEnds":"2017-03-02T08:22:00",
                     "availabilityStarts":"2017-03-02T08:22:00"
                  },
                  "hasMenuItem":{
                     "@type":"MenuItem",
                     "name":"Potato Skins",
                     "description":"Small serving of stuffed potato skins.",
                     "offers":{
                        "@type":"Offer",
                        "price":"7.49",
                        "priceCurrency":"USD"
                     },
                     "suitableForDiet":"https://schema.org/GlutenFreeDiet"
                  }
               },
               {
                  "@type":"MenuSection",
                  "name":"Soups & Salads",
                  "description":"Salads and a few choices of soup",
                  "image":"https://thisisarestaurant.com/soup_and_salad_dishes.jpg",
                  "offers":{
                     "@type":"Offer",
                     "availabilityEnds":"2017-03-02T08:22:00",
                     "availabilityStarts":"2017-03-02T08:22:00"
                  },
                  "hasMenuItem":{
                     "@type":"MenuItem",
                     "name":"Pea Soup",
                     "description":"Creamy pea soup topped with melted cheese and sourdough croutons.",
                     "offers":{
                        "@type":"Offer",
                        "price":"3.49",
                        "priceCurrency":"USD"
                     }
                  }
               }
            ]
         }
      ]
   }
}`;

/** The Yoast/WordPress envelope, around schema.org's own Example 1 node. */
const YOAST_GRAPH_WRAPPER = `{"@context":"https://schema.org","@graph":[
  {"@type":"WebSite","@id":"https://somerestaurant.com/#website","name":"Some Restaurant"},
  ${SCHEMA_ORG_EXAMPLE_1.replace(/^\{\s*"@context":"https:\/\/schema\.org",\s*/, '{')}
]}`;

const page = (body: string, head = '') =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Menu</title>${head}</head><body>${body}</body></html>`;

const ld = (json: string) => `<script type="application/ld+json">${json}</script>`;

/** A fetch double in `safeFetch`'s exact return shape, keyed by URL. */
function fakeFetch(pages: Record<string, { html?: string; contentType?: string; throws?: Error }>) {
  const calls: string[] = [];
  const fn = (async (url: string) => {
    calls.push(url);
    const hit = pages[url];
    if (!hit) throw new Error(`ECONNREFUSED ${url}`);
    if (hit.throws) throw hit.throws;
    return {
      body: Buffer.from(hit.html ?? '', 'utf-8'),
      contentType: hit.contentType ?? 'text/html; charset=utf-8',
      finalUrl: url,
      status: 200,
    };
  }) as any;
  return Object.assign(fn, { calls });
}

// ───────────────────────────────────────────────────────────────────────────
// 1. The deterministic JSON-LD path
// ───────────────────────────────────────────────────────────────────────────

describe('extractMenuFromSite — schema.org JSON-LD', () => {
  it("reads schema.org's own Example 1 (single-object hasMenu / hasMenuSection / hasMenuItem)", async () => {
    const fetch = fakeFetch({ 'https://somerestaurant.com/': { html: page('<h1>Some Restaurant</h1>', ld(SCHEMA_ORG_EXAMPLE_1)) } });
    const menu = await extractMenuFromSite('https://somerestaurant.com/', { fetch });

    expect(menu).not.toBeNull();
    expect(menu!.source.method).toBe('jsonld');
    expect(menu!.itemCount).toBe(1);
    expect(menu!.sections).toHaveLength(1);
    expect(menu!.sections[0].name).toBe('Tacos');
    expect(menu!.sections[0].items[0]).toEqual({
      name: 'Aloo Gobi Taco',
      price: '$3.50',
      // schema.org's description is 187 chars — clamped to the 140 ceiling.
      description: expect.stringContaining('Mexico City-style street corn tortilla taco'),
    });
    expect(menu!.sections[0].items[0].description!.length).toBeLessThanOrEqual(MENU_DESC_MAX);
  });

  it("reads schema.org's Example 2 — NESTED sections, and an item-less parent section is dropped", async () => {
    const fetch = fakeFetch({ 'https://thisisarestaurant.com/': { html: page('<h1>The Restaurant</h1>', ld(SCHEMA_ORG_EXAMPLE_2)) } });
    const menu = await extractMenuFromSite('https://thisisarestaurant.com/', { fetch });

    expect(menu).not.toBeNull();
    // "Dinner" carries no hasMenuItem of its own — only sub-sections — so it
    // never reaches the board as an empty column.
    expect(menu!.sections.map((s) => s.name)).toEqual(['Starters', 'Soups & Salads']);
    expect(menu!.itemCount).toBe(2);
    expect(menu!.sections[0].items[0]).toMatchObject({ name: 'Potato Skins', price: '$7.49' });
    expect(menu!.sections[1].items[0]).toMatchObject({ name: 'Pea Soup', price: '$3.49' });
  });

  it('reads the menu through a Yoast `@graph` wrapper', async () => {
    const fetch = fakeFetch({ 'https://somerestaurant.com/': { html: page('<h1>Hi</h1>', ld(YOAST_GRAPH_WRAPPER)) } });
    const menu = await extractMenuFromSite('https://somerestaurant.com/', { fetch });
    expect(menu!.sections[0].name).toBe('Tacos');
    expect(menu!.sections[0].items[0].price).toBe('$3.50');
  });

  it('reads a price from an `offers` ARRAY (schema.org allows offers to repeat)', async () => {
    const json = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Menu',
      name: 'Bar',
      hasMenuItem: [
        {
          '@type': 'MenuItem',
          name: 'House Margarita',
          offers: [
            { '@type': 'Offer', availabilityStarts: '2017-03-02T08:22:00' },
            { '@type': 'Offer', price: '11.00', priceCurrency: 'USD' },
          ],
        },
      ],
    });
    const fetch = fakeFetch({ 'https://bar.example/': { html: page('<h1>Bar</h1>', ld(json)) } });
    const menu = await extractMenuFromSite('https://bar.example/', { fetch });
    expect(menu!.sections[0].items[0]).toMatchObject({ name: 'House Margarita', price: '$11' });
  });

  it('reads schema.org MICRODATA when there is no JSON-LD at all', async () => {
    const body = `
      <div itemscope itemtype="https://schema.org/MenuSection">
        <h2 itemprop="name">Burritos</h2>
        <div itemscope itemtype="https://schema.org/MenuItem">
          <h3 itemprop="name">Carne Asada Burrito</h3>
          <p itemprop="description">Grilled steak, rice, beans, pico.</p>
          <div itemprop="offers" itemscope itemtype="https://schema.org/Offer">
            <meta itemprop="priceCurrency" content="USD">
            <span itemprop="price" content="12.75">$12.75</span>
          </div>
        </div>
      </div>`;
    const fetch = fakeFetch({ 'https://taco.example/menu': { html: page(body) } });
    const menu = await extractMenuFromSite('https://taco.example/menu', { fetch });
    expect(menu!.source.method).toBe('jsonld');
    expect(menu!.sections[0].name).toBe('Burritos');
    expect(menu!.sections[0].items[0]).toEqual({
      name: 'Carne Asada Burrito',
      price: '$12.75',
      description: 'Grilled steak, rice, beans, pico.',
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 2. Discovery — the pasted page is the homepage, the menu is one click away
// ───────────────────────────────────────────────────────────────────────────

describe('extractMenuFromSite — menu-page discovery', () => {
  const HOME = page(`
    <nav><a href="/about">About</a><a href="/contact">Contact</a></nav>
    <ul><li><a href="/our-menu">Menu</a></li><li><a href="/catering">Catering</a></li></ul>`);

  it('follows a same-host menu link and reads the menu there', async () => {
    const fetch = fakeFetch({
      'https://taco.example/': { html: HOME },
      'https://taco.example/our-menu': { html: page('<h1>Menu</h1>', ld(SCHEMA_ORG_EXAMPLE_1)) },
    });
    const menu = await extractMenuFromSite('https://taco.example/', { fetch });
    expect(menu!.sections[0].items[0].name).toBe('Aloo Gobi Taco');
    expect(menu!.source.url).toBe('https://taco.example/our-menu');
    expect(describeExtractedMenu(menu!)).toContain('Menu found on /our-menu: 1 item in 1 section (Tacos).');
  });

  it('follows at most 2 candidates and stops at the first that yields items', async () => {
    const many = page(
      ['/menu-a', '/menu-b', '/menu-c'].map((h) => `<a href="${h}">Menu</a>`).join('') +
      '<a href="/drinks">Drinks</a>',
    );
    const fetch = fakeFetch({
      'https://x.example/': { html: many },
      'https://x.example/menu-a': { html: page('<h1>nothing structured</h1>') },
      'https://x.example/menu-b': { html: page('<h1>Menu</h1>', ld(SCHEMA_ORG_EXAMPLE_1)) },
      'https://x.example/menu-c': { html: page('<h1>Menu</h1>', ld(SCHEMA_ORG_EXAMPLE_2)) },
    });
    const menu = await extractMenuFromSite('https://x.example/', { fetch });
    expect(menu!.source.url).toBe('https://x.example/menu-b');
    expect(fetch.calls).toEqual(['https://x.example/', 'https://x.example/menu-a', 'https://x.example/menu-b']);
  });

  it('ranks link TEXT matches ahead of href-only matches, skips other hosts and PDFs', () => {
    const html = page(`
      <a href="/company-food-safety">Food safety policy</a>
      <a href="https://doordash.com/menu">Order on DoorDash</a>
      <a href="/menu.pdf">Menu (PDF)</a>
      <a href="/eat">Our Menu</a>
      <a href="mailto:hi@x.example">Email</a>
      <a href="#menu">Jump</a>`);
    expect(discoverMenuLinks(html, 'https://x.example/')).toEqual([
      'https://x.example/eat',                  // text says "Menu"
      'https://x.example/company-food-safety',  // href says "food"
    ]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 3. The LLM fallback — and the anti-fabrication guard
// ───────────────────────────────────────────────────────────────────────────

// A hand-rolled menu page: no JSON-LD, no microdata, prices in bare <div>s.
// This is the shape the deterministic path CANNOT read, which is why the model
// path exists.
const HANDROLLED_MENU = page(`
  <h1>Super Taco</h1>
  <section>
    <h2>Tacos</h2>
    <div class="row"><div class="n">Al Pastor</div><div class="d">marinated pork, pineapple</div><div class="p">$4.25</div></div>
    <div class="row"><div class="n">Carnitas</div><div class="d">slow-braised pork</div><div class="p">$4.25</div></div>
    <div class="row"><div class="n">Pescado</div><div class="d">beer-battered cod, slaw</div><div class="p">$5.50</div></div>
  </section>
  <section>
    <h2>Drinks</h2>
    <div class="row"><div class="n">Horchata</div><div class="p">$3.00</div></div>
  </section>`);

const MODEL_REPLY = JSON.stringify({
  sections: [
    {
      name: 'Tacos',
      items: [
        { name: 'Al Pastor', price: '4.25', description: 'marinated pork, pineapple' },
        { name: 'Carnitas', price: '4.25', description: 'slow-braised pork' },
        { name: 'Pescado', price: '5.50', description: 'beer-battered cod, slaw' },
      ],
    },
    { name: 'Drinks', items: [{ name: 'Horchata', price: '3.00' }] },
  ],
});

describe('extractMenuFromSite — LLM fallback', () => {
  it('reads a hand-rolled menu page through the model and keeps every verified row', async () => {
    const fetch = fakeFetch({ 'https://supertaco.example/': { html: HANDROLLED_MENU } });
    const askModel = jest.fn(async () => MODEL_REPLY);
    const menu = await extractMenuFromSite('https://supertaco.example/', { fetch, askModel });

    expect(menu!.source.method).toBe('llm');
    expect(menu!.itemCount).toBe(4);
    expect(menu!.sections.map((s) => s.name)).toEqual(['Tacos', 'Drinks']);
    expect(menu!.sections[0].items.map((i) => `${i.name} ${i.price}`)).toEqual([
      'Al Pastor 4.25', 'Carnitas 4.25', 'Pescado 5.50',
    ]);
    // The model saw the page's visible text, including the prices.
    const sent = askModel.mock.calls[0][0] as unknown as { system: string; user: string };
    expect(sent.user).toContain('Al Pastor');
    expect(sent.user).toContain('$4.25');
    expect(sent.system).toContain('INVENT NOTHING');
  });

  it('parses a fenced reply (what providers actually emit some of the time)', async () => {
    const fetch = fakeFetch({ 'https://supertaco.example/': { html: HANDROLLED_MENU } });
    const askModel = async () => '```json\n' + MODEL_REPLY + '\n```';
    const menu = await extractMenuFromSite('https://supertaco.example/', { fetch, askModel });
    expect(menu!.itemCount).toBe(4);
  });

  it('DROPS an item whose price is not on the page — a model cannot invent a price onto a wall', async () => {
    const fetch = fakeFetch({ 'https://supertaco.example/': { html: HANDROLLED_MENU } });
    const invented = JSON.stringify({
      sections: [{
        name: 'Tacos',
        items: [
          { name: 'Al Pastor', price: '4.25' },
          { name: 'Birria Taco', price: '6.95' },  // ← never appears on the page
        ],
      }],
    });
    const menu = await extractMenuFromSite('https://supertaco.example/', { fetch, askModel: async () => invented });
    expect(menu!.sections[0].items.map((i) => i.name)).toEqual(['Al Pastor']);
    expect(menu!.itemCount).toBe(1);
  });

  it('keeps an item the model returned with NO price (no claim, nothing to verify)', () => {
    const kept = dropUnverifiedPrices(
      [{ name: 'Tacos', items: [{ name: 'Market Fish' }, { name: 'Ghost', price: '99.00' }] }],
      'Tacos ... Al Pastor $4.25',
    );
    expect(kept).toEqual([{ name: 'Tacos', items: [{ name: 'Market Fish' }] }]);
  });

  it('returns null when everything the model claimed fails verification', async () => {
    const fetch = fakeFetch({ 'https://supertaco.example/': { html: HANDROLLED_MENU } });
    const allFake = JSON.stringify({ sections: [{ name: 'Tacos', items: [{ name: 'Birria', price: '6.95' }] }] });
    expect(await extractMenuFromSite('https://supertaco.example/', { fetch, askModel: async () => allFake })).toBeNull();
  });

  it('never calls the model when the deterministic path already answered', async () => {
    const fetch = fakeFetch({ 'https://somerestaurant.com/': { html: page('<h1>x</h1>', ld(SCHEMA_ORG_EXAMPLE_1)) } });
    const askModel = jest.fn(async () => MODEL_REPLY);
    await extractMenuFromSite('https://somerestaurant.com/', { fetch, askModel });
    expect(askModel).not.toHaveBeenCalled();
  });

  it('is deterministic-only when no model is available (a tenant with no provider key)', async () => {
    const fetch = fakeFetch({ 'https://supertaco.example/': { html: HANDROLLED_MENU } });
    expect(await extractMenuFromSite('https://supertaco.example/', { fetch })).toBeNull();
  });

  it('does not call the model on a page with no prices at all', async () => {
    const fetch = fakeFetch({ 'https://blog.example/': { html: page('<h1>Our story</h1><p>We opened in 2019.</p>') } });
    const askModel = jest.fn(async () => MODEL_REPLY);
    expect(await extractMenuFromSite('https://blog.example/', { fetch, askModel })).toBeNull();
    expect(askModel).not.toHaveBeenCalled();
  });

  it('returns null — never throws — when the model itself blows up or returns junk', async () => {
    const fetch = fakeFetch({ 'https://supertaco.example/': { html: HANDROLLED_MENU } });
    await expect(extractMenuFromSite('https://supertaco.example/', { fetch, askModel: async () => { throw new Error('429'); } })).resolves.toBeNull();
    await expect(extractMenuFromSite('https://supertaco.example/', { fetch, askModel: async () => 'I am afraid I cannot do that' })).resolves.toBeNull();
    await expect(extractMenuFromSite('https://supertaco.example/', { fetch, askModel: async () => '' })).resolves.toBeNull();
    await expect(extractMenuFromSite('https://supertaco.example/', { fetch, askModel: async () => '{"sections":[]}' })).resolves.toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 4. Caps + normalisation
// ───────────────────────────────────────────────────────────────────────────

describe('extractMenuFromSite — caps and normalisation', () => {
  it('caps a 61-item menu at 60', async () => {
    const json = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Menu',
      name: 'Everything',
      hasMenuItem: Array.from({ length: 61 }, (_v, i) => ({
        '@type': 'MenuItem', name: `Item ${i + 1}`, offers: { '@type': 'Offer', price: `${i + 1}.00`, priceCurrency: 'USD' },
      })),
    });
    const fetch = fakeFetch({ 'https://big.example/': { html: page('<h1>x</h1>', ld(json)) } });
    const menu = await extractMenuFromSite('https://big.example/', { fetch });
    expect(menu!.itemCount).toBe(MENU_MAX_ITEMS);
    expect(menu!.sections[0].items).toHaveLength(MENU_MAX_ITEMS);
    expect(menu!.sections[0].items[59].name).toBe('Item 60');
  });

  it('caps sections at 8 and de-duplicates (section, name)', async () => {
    const json = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Menu',
      hasMenuSection: Array.from({ length: 10 }, (_v, i) => ({
        '@type': 'MenuSection',
        name: `Section ${i + 1}`,
        hasMenuItem: [
          { '@type': 'MenuItem', name: 'Repeat', offers: { '@type': 'Offer', price: '5.00' } },
          { '@type': 'MenuItem', name: 'repeat', offers: { '@type': 'Offer', price: '5.00' } },
        ],
      })),
    });
    const fetch = fakeFetch({ 'https://big.example/': { html: page('<h1>x</h1>', ld(json)) } });
    const menu = await extractMenuFromSite('https://big.example/', { fetch });
    expect(menu!.sections).toHaveLength(MENU_MAX_SECTIONS);
    expect(menu!.sections[0].items).toHaveLength(1); // "Repeat" / "repeat" are one row
  });

  it('clamps a long item name to the 80-char ceiling', async () => {
    const long = 'A'.repeat(200);
    const json = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'Menu',
      hasMenuItem: [{ '@type': 'MenuItem', name: long, offers: { '@type': 'Offer', price: '5.00' } }],
    });
    const fetch = fakeFetch({ 'https://big.example/': { html: page('<h1>x</h1>', ld(json)) } });
    const menu = await extractMenuFromSite('https://big.example/', { fetch });
    expect(menu!.sections[0].items[0].name).toHaveLength(MENU_NAME_MAX);
  });

  it('normalizes prices to a canonical string, keeping the currency symbol seen', () => {
    expect(normalizeMenuPrice('3.50', 'USD')).toBe('$3.50');
    expect(normalizeMenuPrice('24.00', 'USD')).toBe('$24');
    expect(normalizeMenuPrice('$4.5')).toBe('$4.50');
    expect(normalizeMenuPrice(12.5)).toBe('12.50');
    expect(normalizeMenuPrice('8')).toBe('8');
    expect(normalizeMenuPrice('11.00', 'GBP')).toBe('£11');
    expect(normalizeMenuPrice('€12,50')).toBe('€12.50');   // European decimal comma
    expect(normalizeMenuPrice('1,299.00', 'EUR')).toBe('€1299');
    expect(normalizeMenuPrice('Market price')).toBeNull();
    expect(normalizeMenuPrice('')).toBeNull();
    expect(normalizeMenuPrice(null)).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 5. Failure modes — every one of them returns null, none of them throw
// ───────────────────────────────────────────────────────────────────────────

describe('extractMenuFromSite — failure modes all return null', () => {
  it('fetch error', async () => {
    const fetch = fakeFetch({});
    await expect(extractMenuFromSite('https://gone.example/', { fetch })).resolves.toBeNull();
  });

  it('a blocked host (safeFetch throws SsrfError)', async () => {
    const fetch = fakeFetch({ 'https://internal.example/': { throws: new SsrfError('DNS for internal.example resolved to private range (10.0.0.5)') } });
    await expect(extractMenuFromSite('https://internal.example/', { fetch })).resolves.toBeNull();
  });

  it('a non-HTML document (a PDF menu)', async () => {
    const fetch = fakeFetch({ 'https://x.example/menu': { html: '%PDF-1.4 …', contentType: 'application/pdf' } });
    await expect(extractMenuFromSite('https://x.example/menu', { fetch })).resolves.toBeNull();
  });

  it('an empty document', async () => {
    const fetch = fakeFetch({ 'https://x.example/': { html: '   ' } });
    await expect(extractMenuFromSite('https://x.example/', { fetch })).resolves.toBeNull();
  });

  it('a page whose JSON-LD is malformed', async () => {
    const fetch = fakeFetch({ 'https://x.example/': { html: page('<h1>x</h1>', ld('{"@type":"Menu", oops')) } });
    await expect(extractMenuFromSite('https://x.example/', { fetch })).resolves.toBeNull();
  });

  it('a page whose JSON-LD carries no menu at all', async () => {
    const org = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Organization', name: 'Acme' });
    const fetch = fakeFetch({ 'https://x.example/': { html: page('<h1>x</h1>', ld(org)) } });
    await expect(extractMenuFromSite('https://x.example/', { fetch })).resolves.toBeNull();
  });

  it('stops when the time budget is spent instead of chasing candidates forever', async () => {
    let clock = 0;
    const fetch = fakeFetch({
      'https://slow.example/': { html: page('<a href="/menu">Menu</a><a href="/food">Food</a>') },
      'https://slow.example/menu': { html: page('<h1>nothing</h1>') },
      'https://slow.example/food': { html: page('<h1>x</h1>', ld(SCHEMA_ORG_EXAMPLE_1)) },
    });
    // Every fetch burns 5s of the 8s budget.
    const timed = (async (url: string, opts: any) => { clock += 5_000; return (fetch as any)(url, opts); }) as any;
    const menu = await extractMenuFromSite('https://slow.example/', { fetch: timed, now: () => clock });
    expect(menu).toBeNull();
    expect(fetch.calls).toEqual(['https://slow.example/', 'https://slow.example/menu']);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// 6. visibleMenuText — what the model is actually shown
// ───────────────────────────────────────────────────────────────────────────

describe('visibleMenuText', () => {
  it('keeps headings / rows / priced elements and drops chrome + scripts', () => {
    const text = visibleMenuText(page(`
      <nav><a href="/">Home</a><a href="/jobs">Careers</a></nav>
      <h2>Tacos</h2>
      <div class="row"><span class="n">Al Pastor</span><span class="p">$4.25</span></div>
      <footer>© 2026 Super Taco · 555-0100</footer>
      <script>window.PRICE_TABLE = {"secret": 99};</script>
      <style>.p{color:red}</style>`));
    expect(text).toContain('Tacos');
    expect(text).toContain('Al Pastor');
    expect(text).toContain('$4.25');
    expect(text).not.toContain('Careers');
    expect(text).not.toContain('© 2026');
    expect(text).not.toContain('PRICE_TABLE');
    expect(text).not.toContain('color:red');
  });

  it('emits the innermost priced row once, not the whole document per ancestor', () => {
    const text = visibleMenuText(page('<main><section><div class="row"><span>Horchata</span><span>$3.00</span></div></section></main>'));
    expect(text.split('\n').filter((l) => l.includes('Horchata'))).toHaveLength(1);
  });

  it('is capped, so a huge page can never blow the prompt budget', () => {
    const rows = Array.from({ length: 4000 }, (_v, i) => `<li>Item ${i} $${i % 90}.00</li>`).join('');
    expect(visibleMenuText(page(rows)).length).toBeLessThanOrEqual(12_000);
  });
});
