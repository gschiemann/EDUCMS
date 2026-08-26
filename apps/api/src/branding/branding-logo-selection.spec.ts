/**
 * End-to-end proof that the logo filters + the logo-first palette are
 * actually WIRED into `BrandingScraperService.scrape()` — not just correct in
 * isolation.
 *
 * This is the suite that reproduces the operator's 2026-08-25 screenshot: a
 * scrape that returned the real brand mark, a **Pinterest** icon, and two
 * stock photographs, with the wrong one out-ranking the mark. Before the fix
 * the third-party filter existed ONLY on the inline-SVG branch, so the
 * `<link rel="apple-touch-icon">` path (base score 85 — the highest in
 * `iconRelPriority`), `og:image`, `twitter:image` and `<img>` were all
 * unguarded.
 *
 * Network is fully mocked: the HTML comes from the fixture below, stylesheets
 * and images resolve (or fail) per test.
 */

const safeFetchMock = jest.fn();
jest.mock('./safe-fetch', () => ({
  ...jest.requireActual('./safe-fetch'),
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

import sharp from 'sharp';
import { BrandingScraperService } from './branding-scraper.service';

const SITE = 'https://acmelotus.com';

/**
 * A homepage shaped like the operator's: the real mark plus a Pinterest icon
 * on the highest-scoring path, a share-card photo, and page photography.
 */
function html(opts: { markUrl?: string } = {}): string {
  const mark = opts.markUrl || 'https://acmelotus.com/assets/lotus-mark.svg';
  return `<!doctype html><html><head>
    <title>Acme Lotus | Clean Hydrogen Logistics</title>
    <meta property="og:site_name" content="Acme Lotus">
    <!-- The exact shape of the operator's bug: a THIRD-PARTY icon on the
         highest-scoring discovery path (apple-touch-icon, base 85). -->
    <link rel="apple-touch-icon" sizes="192x192" href="https://i.pinimg.com/apple-touch-icon.png">
    <link rel="icon" href="https://acmelotus.com/favicon.ico">
    <!-- A share card that is really a photograph. -->
    <meta property="og:image" content="https://acmelotus.com/images/hero/hydrogen-truck.jpg">
    <meta property="og:image:alt" content="hero banner of a hydrogen truck">
    <meta name="twitter:image" content="https://acmelotus.com/images/slider/airport-terminal.jpg">
    <style>
      :root { --brand-primary: #0f2d52; }
      header, .navbar { background: #0f2d52; }
      .btn-primary { background: #0f2d52; color: #fff; }
      .cta { background: #1b6ca8; }
    </style>
  </head><body>
    <header>
      <a href="/"><img class="logo" src="${mark}" alt="Acme Lotus logo" width="220" height="64"></a>
      <a href="https://pinterest.com/acmelotus"><img src="https://acmelotus.com/img/social/pinterest-logo.png" alt="Pinterest logo" width="32" height="32"></a>
    </header>
    <img src="https://acmelotus.com/images/hero/terminal-logo-shot.jpg" alt="brand logo on our terminal" width="1200" height="675">
    <h1>Clean hydrogen logistics</h1>
  </body></html>`;
}

/** Route every fetch: the page HTML, then per-URL handlers; anything else 404s. */
function routeFetch(handlers: Record<string, { body: string | Buffer; contentType: string }> = {}) {
  safeFetchMock.mockImplementation(async (url: string) => {
    if (url === SITE) {
      return { status: 200, body: Buffer.from(html(), 'utf-8'), contentType: 'text/html', finalUrl: SITE };
    }
    const hit = handlers[url];
    if (hit) {
      const body = Buffer.isBuffer(hit.body) ? hit.body : Buffer.from(hit.body, 'utf-8');
      return { status: 200, body, contentType: hit.contentType, finalUrl: url };
    }
    throw new Error(`no route for ${url}`);
  });
}

afterEach(() => safeFetchMock.mockReset());

describe('scrape() — third-party marks never reach the gallery, on ANY path', () => {
  it('drops the Pinterest apple-touch-icon that used to out-rank the real mark', async () => {
    routeFetch();
    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 4000);

    const urls = preview.logos.map((l) => l.url);
    // The third-party HOST is gone entirely, from the HIGHEST-scoring path.
    expect(urls.some((u) => /pinimg\.com/.test(u))).toBe(false);
    // The real mark survived.
    expect(urls).toContain('https://acmelotus.com/assets/lotus-mark.svg');
  });

  it('keeps a same-site file merely NAMED pinterest, but demoted below the mark', async () => {
    routeFetch();
    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 4000);

    const social = preview.logos.find((l) => /pinterest-logo\.png/.test(l.url));
    const mark = preview.logos.find((l) => /lotus-mark\.svg/.test(l.url));
    expect(social).toBeTruthy(); // demoted, not dropped — conservative by design
    expect(mark).toBeTruthy();
    expect(mark!.score).toBeGreaterThan(social!.score);
    expect(social!.filterReasons?.join(' ')).toMatch(/social\/share\/badge/);
  });

  it('demotes the hero PHOTOGRAPHS below the mark (the truck + the terminal)', async () => {
    routeFetch();
    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 4000);

    const mark = preview.logos.find((l) => /lotus-mark\.svg/.test(l.url))!;
    for (const l of preview.logos) {
      if (/hydrogen-truck|airport-terminal|terminal-logo-shot/.test(l.url)) {
        expect(l.score).toBeLessThan(mark.score);
        expect(l.filterReasons?.length).toBeGreaterThan(0);
      }
    }
  });

  it('the TOP candidate is the real brand mark', async () => {
    routeFetch();
    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 4000);
    expect(preview.logos[0].url).toBe('https://acmelotus.com/assets/lotus-mark.svg');
  });

  it('never returns an EMPTY gallery', async () => {
    routeFetch();
    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 4000);
    expect(preview.logos.length).toBeGreaterThan(0);
  });
});

describe('scrape() — the palette derives from the CHOSEN LOGO', () => {
  const LOTUS_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">' +
    '<path fill="#c2185b" d="M10 30 Q30 0 50 30 Z"/>' +
    '<path fill="#c2185b" d="M50 30 Q70 0 90 30 Z"/>' +
    '<circle fill="#f9a825" cx="50" cy="20" r="6"/></svg>';

  it('takes primary + accent from the mark, NOT the navy page chrome', async () => {
    routeFetch({
      'https://acmelotus.com/assets/lotus-mark.svg': { body: LOTUS_SVG, contentType: 'image/svg+xml' },
    });
    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 4000);

    expect(preview.paletteSource).toBe('logo');
    expect(preview.logos[0].brandColors).toEqual(expect.arrayContaining(['#c2185b', '#f9a825']));
    // The page's dominant color is the navy #0f2d52 — proof we did NOT use it.
    expect(preview.palette.primaryRaw?.toLowerCase()).toBe('#c2185b');
    expect(preview.palette.accentRaw?.toLowerCase()).toBe('#f9a825');
    expect(preview.colors.map((c) => c.hex)).toContain('#0f2d52');
  });

  it('MONOCHROME mark → falls back to the page colors (pre-2026-08-25 behavior)', async () => {
    routeFetch({
      'https://acmelotus.com/assets/lotus-mark.svg': {
        body: '<svg viewBox="0 0 10 10"><path fill="#000000" d="M0 0h10v10H0z"/></svg>',
        contentType: 'image/svg+xml',
      },
    });
    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 4000);

    expect(preview.paletteSource).toBe('page');
    expect(preview.palette.primaryRaw?.toLowerCase()).toBe('#0f2d52');
  });

  it('UNREACHABLE mark (bot-block / 404) → page colors, never a throw', async () => {
    routeFetch(); // every image fetch rejects
    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 4000);

    expect(preview.paletteSource).toBe('page');
    expect(preview.palette.primaryRaw?.toLowerCase()).toBe('#0f2d52');
  });

  it('keeps the WCAG contrast contract intact on the logo-derived palette', async () => {
    routeFetch({
      'https://acmelotus.com/assets/lotus-mark.svg': { body: LOTUS_SVG, contentType: 'image/svg+xml' },
    });
    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 4000);

    expect(preview.contrastReport).toBeTruthy();
    expect(preview.contrastReport).toBe(preview.palette.contrastReport);
    expect(Array.isArray(preview.contrastReport.adjustments)).toBe(true);
    expect(preview.palette.primaryInk).toBeTruthy();
    expect(preview.palette.primaryStrong).toBeTruthy();
  });
});

describe('scrape() — the logo BACKGROUND default rides along', () => {
  it('ships a backdrop for the winning mark AND per-candidate', async () => {
    routeFetch({
      'https://acmelotus.com/assets/lotus-mark.svg': {
        body: '<svg viewBox="0 0 10 10"><path fill="#c2185b" d="M0 0h10v10H0z"/></svg>',
        contentType: 'image/svg+xml',
      },
    });
    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 4000);

    expect(['transparent', 'white', 'dark', 'primary', 'tile']).toContain(preview.logoBackground);
    expect(preview.logos[0].logoBackground).toBe(preview.logoBackground);
    // It is also mirrored into the palette so adopt persists it with no
    // extra plumbing (and no schema change).
    expect((preview.palette as any).logoBackground).toBe(preview.logoBackground);
  });

  it('a WHITE-on-transparent wordmark gets a dark-enough backing, not white-on-white', async () => {
    routeFetch({
      'https://acmelotus.com/assets/lotus-mark.svg': {
        body: '<svg viewBox="0 0 10 10"><path fill="#ffffff" d="M0 0h10v10H0z"/></svg>',
        contentType: 'image/svg+xml',
      },
    });
    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 4000);
    expect(['dark', 'primary']).toContain(preview.logoBackground);
  });
});


describe('scrape() — RASTER marks decode through sharp (already an API dep)', () => {
  it('extracts the mark\'s colors from a real PNG and derives the palette from them', async () => {
    // Build a genuine PNG so this exercises the ACTUAL decode path, not a
    // stub: 32x32 of the lotus magenta. `sharp` is already an API dependency
    // (storage/media-optimization.service.ts) — no new package was added.
    const png = await sharp({
      create: { width: 32, height: 32, channels: 4, background: { r: 194, g: 24, b: 91, alpha: 1 } },
    }).png().toBuffer();

    // Point the fixture at a PNG mark instead of the SVG one.
    safeFetchMock.mockImplementation(async (url: string) => {
      if (url === SITE) {
        return {
          status: 200,
          body: Buffer.from(html({ markUrl: 'https://acmelotus.com/assets/lotus-mark.png' }), 'utf-8'),
          contentType: 'text/html',
          finalUrl: SITE,
        };
      }
      if (url === 'https://acmelotus.com/assets/lotus-mark.png') {
        return { status: 200, body: png, contentType: 'image/png', finalUrl: url };
      }
      throw new Error(`no route for ${url}`);
    });

    const svc = new BrandingScraperService();
    const preview = await svc.scrape(SITE, 6000);

    const mark = preview.logos.find((l) => /lotus-mark\.png/.test(l.url));
    expect(mark?.brandColors?.[0]).toMatch(/^#c[0-9a-f]/i);
    expect(preview.paletteSource).not.toBe('page');
    expect(preview.palette.primaryRaw?.toLowerCase()).toMatch(/^#c[0-9a-f]/);
  });
});
