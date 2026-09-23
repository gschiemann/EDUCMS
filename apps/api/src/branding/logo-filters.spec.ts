/**
 * logo-filters — the third-party / photo rejection matrix.
 *
 * Regression cover for the 2026-08-25 operator report (with screenshot):
 * a scrape returned 8 "logo" candidates — the real brand mark (a colored
 * lotus), **Pinterest's** circular P, a stock photo of a hydrogen truck,
 * and a photo of an airport terminal. The scraper already rejected
 * third-party badges, but ONLY on the inline-SVG branch: the
 * `<link rel="apple-touch-icon">` path (base score 85, the HIGHEST), the
 * og/twitter share cards and the `<img>` path had NO such filter.
 *
 * These tests assert the rules on EVERY discovery path, because the
 * scraper now runs all of them through one `pushLogo` choke point.
 */
import {
  classifyLogoUrl,
  photoSignalDemotion,
  scoreLogoCandidate,
  ensureSurvivor,
  hostOf,
  awardBadgeDemotion,
  brandKeysFrom,
  logoSignalBonus,
  capIconsBelowRealLogo,
  isRealLogoCandidate,
  isHeaderLogoCandidate,
  decodedPhotoDemotion,
} from './logo-filters';

describe('classifyLogoUrl — third-party hosts (hard reject)', () => {
  // Every one of these was reachable through a path that had NO filter
  // before this change.
  const thirdParty: Array<[string, string]> = [
    [
      "Pinterest (the operator's actual bug)",
      'https://www.pinterest.com/static/img/favicon.png',
    ],
    ['Pinterest CDN', 'https://i.pinimg.com/originals/ab/cd/logo.png'],
    ['Facebook', 'https://www.facebook.com/images/fb_icon_325x325.png'],
    ['Facebook CDN', 'https://scontent.fbcdn.net/v/t39/logo.png'],
    [
      'Instagram',
      'https://www.instagram.com/static/images/ico/favicon-192.png',
    ],
    ['Instagram CDN', 'https://scontent.cdninstagram.com/v/t51/mark.jpg'],
    ['X', 'https://x.com/favicon.ico'],
    ['Twitter', 'https://twitter.com/favicon.ico'],
    ['Twitter CDN', 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png'],
    ['LinkedIn', 'https://www.linkedin.com/favicon.ico'],
    ['LinkedIn CDN', 'https://static.licdn.com/aero-v1/sc/h/logo.svg'],
    ['TikTok', 'https://www.tiktok.com/favicon.ico'],
    ['YouTube', 'https://www.youtube.com/s/desktop/icon.png'],
    ['YouTube CDN', 'https://i.ytimg.com/img/logo.png'],
    ['WhatsApp', 'https://www.whatsapp.com/apple-touch-icon.png'],
    ['Yelp', 'https://www.yelp.com/favicon.ico'],
    [
      'Google Play badge',
      'https://play.google.com/intl/en/badges/img/badge.png',
    ],
    ['App Store badge', 'https://apps.apple.com/assets/badge.svg'],
    ['Finalsite (school CMS vendor)', 'https://www.finalsite.com/logo.svg'],
    ['AddThis share widget', 'https://s7.addthis.com/static/sh.png'],
  ];

  it.each(thirdParty)('rejects %s', (_label, url) => {
    const v = classifyLogoUrl(url, 'acmelotus.com');
    expect(v.reject).toBe(true);
    expect(v.reasons.join(' ')).toMatch(/third-party host/);
  });

  it('does NOT reject when the tenant IS that company (the guard)', () => {
    // Pinterest branding pinterest.com must still work.
    expect(
      classifyLogoUrl('https://www.pinterest.com/logo.svg', 'pinterest.com')
        .reject,
    ).toBe(false);
    // …and a subdomain of the site being scraped counts as the same site.
    expect(
      classifyLogoUrl('https://cdn.facebook.com/logo.svg', 'facebook.com')
        .reject,
    ).toBe(false);
  });

  it('does NOT treat a look-alike host as third-party (dot-boundary match)', () => {
    // `evil-pinterest.com` and `pinterest.com.attacker.net` are NOT
    // pinterest.com — but neither should they be rejected as one; the
    // point is that host matching is anchored, not substring.
    expect(classifyLogoUrl('https://evil-pinterest.com/logo.svg').reject).toBe(
      false,
    );
    expect(classifyLogoUrl('https://mypinterestclone.io/logo.svg').reject).toBe(
      false,
    );
  });

  it('leaves an ordinary first-party logo completely untouched', () => {
    const v = classifyLogoUrl(
      'https://acmelotus.com/assets/logo.svg',
      'acmelotus.com',
    );
    expect(v).toEqual({ reject: false, factor: 1, reasons: [] });
  });

  it('is a no-op for an inline SVG (no URL)', () => {
    expect(classifyLogoUrl('', 'acmelotus.com')).toEqual({
      reject: false,
      factor: 1,
      reasons: [],
    });
  });
});

describe('classifyLogoUrl — social/share/badge FILENAMES (demote, never drop)', () => {
  const demoted = [
    'https://acmelotus.com/img/pinterest.png',
    'https://acmelotus.com/img/icon-facebook.svg',
    'https://acmelotus.com/assets/social-icons.svg',
    'https://acmelotus.com/assets/share-this.png',
    'https://acmelotus.com/assets/sprite.svg',
    'https://acmelotus.com/img/app-store-badge.png',
    'https://acmelotus.com/img/follow-us.png',
  ];
  it.each(demoted)('demotes but keeps %s', (url) => {
    const v = classifyLogoUrl(url, 'acmelotus.com');
    expect(v.reject).toBe(false);
    expect(v.factor).toBeLessThan(0.5);
    expect(v.reasons.join(' ')).toMatch(/social\/share\/badge/);
  });

  it('does not penalize a brand whose DOMAIN contains a social word', () => {
    // Only the path + query are tested, never the host.
    const v = classifyLogoUrl(
      'https://sharehouse.com/logo.svg',
      'sharehouse.com',
    );
    expect(v.factor).toBe(1);
  });

  it('does not fire on an unrelated substring inside a longer word', () => {
    // "sharpie" contains "shar", "instagram-worthy" is not "instagram" as
    // a whole token when it's mid-word — token boundaries are required.
    expect(
      classifyLogoUrl('https://acme.com/img/sharpie-logo.png').factor,
    ).toBe(1);
    expect(classifyLogoUrl('https://acme.com/img/badgerlogo.png').factor).toBe(
      1,
    );
  });
});

describe('photoSignalDemotion — the truck and the airport terminal', () => {
  it('demotes a photo path token', () => {
    const v = photoSignalDemotion({
      url: 'https://acme.com/images/hero/truck.png',
    });
    expect(v.factor).toBeLessThan(0.3);
    expect(v.reasons.join(' ')).toMatch(/photographic path/);
  });

  it('demotes a stock-photo library URL', () => {
    expect(
      photoSignalDemotion({ url: 'https://images.unsplash.com/photo-123' })
        .factor,
    ).toBeLessThan(1);
    expect(
      photoSignalDemotion({
        url: 'https://cdn.acme.com/shutterstock/12345.jpg',
      }).factor,
    ).toBeLessThan(1);
  });

  it('demotes JPEG — logos are essentially never JPEG', () => {
    const v = photoSignalDemotion({
      url: 'https://acme.com/assets/terminal.jpg',
    });
    expect(v.factor).toBe(0.5);
  });

  it('demotes a photo-SHAPED image by its real decoded dimensions', () => {
    // The classic 1200x630 og share card and a 16:9 slider shot.
    expect(
      photoSignalDemotion({
        url: 'https://acme.com/a.png',
        width: 1200,
        height: 630,
      }).factor,
    ).toBeLessThan(0.4);
    expect(
      photoSignalDemotion({
        url: 'https://acme.com/b.png',
        width: 1920,
        height: 1080,
      }).factor,
    ).toBeLessThan(0.4);
  });

  it('does NOT demote a wide WORDMARK — they are far thinner than a photo', () => {
    // 3:1 through 8:1 is wordmark territory and sits outside the window.
    expect(
      photoSignalDemotion({
        url: 'https://acme.com/wordmark.png',
        width: 1200,
        height: 300,
      }).factor,
    ).toBe(1);
    expect(
      photoSignalDemotion({
        url: 'https://acme.com/wordmark.svg',
        width: 1600,
        height: 200,
      }).factor,
    ).toBe(1);
  });

  it('does NOT demote a small square brand mark', () => {
    expect(
      photoSignalDemotion({
        url: 'https://acme.com/mark.png',
        width: 512,
        height: 512,
      }).factor,
    ).toBe(1);
    expect(
      photoSignalDemotion({
        url: 'https://acme.com/apple-touch-icon.png',
        width: 180,
        height: 180,
      }).factor,
    ).toBe(1);
  });

  it('stacks an extra demotion on an og/twitter share card that already looks photographic', () => {
    const plain = photoSignalDemotion({ url: 'https://acme.com/og.jpg' });
    const card = photoSignalDemotion({
      url: 'https://acme.com/og.jpg',
      kind: 'og',
    });
    expect(card.factor).toBeLessThan(plain.factor);
  });

  it('leaves a clean og:image that shows no photo signals alone', () => {
    expect(
      photoSignalDemotion({
        url: 'https://acme.com/brand-card.png',
        kind: 'og',
      }).factor,
    ).toBe(1);
  });

  it('reads photo signals out of alt text too', () => {
    const v = photoSignalDemotion({
      url: 'https://acme.com/x.png',
      text: 'hero banner of our facility',
    });
    expect(v.factor).toBeLessThan(1);
  });
});

describe('scoreLogoCandidate — the combined gate on every path', () => {
  it('kills a Pinterest apple-touch-icon that would otherwise score 85+', () => {
    const v = scoreLogoCandidate(
      {
        url: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
        score: 97,
        kind: 'apple-touch',
      },
      'acmelotus.com',
    );
    expect(v.reject).toBe(true);
  });

  it('lets the real brand mark keep its full score', () => {
    const v = scoreLogoCandidate(
      {
        url: 'https://acmelotus.com/apple-touch-icon.png',
        score: 93,
        kind: 'apple-touch',
        width: 180,
        height: 180,
      },
      'acmelotus.com',
    );
    expect(v.reject).toBe(false);
    expect(v.score).toBe(93);
  });

  it('ranks the real mark ABOVE a demoted share/photo candidate', () => {
    const mark = scoreLogoCandidate(
      { url: 'https://acmelotus.com/logo.svg', score: 65, kind: 'img-logo' },
      'acmelotus.com',
    );
    const photo = scoreLogoCandidate(
      {
        url: 'https://acmelotus.com/images/hero/hydrogen-truck.jpg',
        score: 88,
        kind: 'img-logo',
        width: 1200,
        height: 675,
      },
      'acmelotus.com',
    );
    expect(mark.score).toBeGreaterThan(photo.score);
  });

  it('never drops a demoted score below 1 (ordering stays stable, still pickable)', () => {
    const v = scoreLogoCandidate(
      {
        url: 'https://acme.com/social/share-sprite.jpg',
        score: 2,
        width: 1200,
        height: 630,
      },
      'acme.com',
    );
    expect(v.score).toBeGreaterThanOrEqual(1);
  });
});

describe('ensureSurvivor — the gallery is never empty', () => {
  it('restores the best rejected candidate when everything was rejected', () => {
    const kept: Array<{ score: number; url: string }> = [];
    const rejected = [
      { score: 40, url: 'https://i.pinimg.com/a.png' },
      { score: 90, url: 'https://abs.twimg.com/b.png' },
    ];
    const out = ensureSurvivor(kept, rejected);
    expect(out).toHaveLength(1);
    expect(out[0].url).toBe('https://abs.twimg.com/b.png'); // the highest-scored
    expect(out[0].score).toBeLessThan(90); // …but heavily demoted
    expect(out[0].score).toBeGreaterThanOrEqual(1);
  });

  it('is a no-op when anything survived', () => {
    const kept = [{ score: 10, url: 'a' }];
    expect(ensureSurvivor(kept, [{ score: 99, url: 'b' }])).toBe(kept);
  });

  it('is a no-op when nothing was rejected and nothing was kept', () => {
    expect(ensureSurvivor([], [])).toEqual([]);
  });
});

describe('hostOf', () => {
  it('lowercases the hostname', () => {
    expect(hostOf('https://WWW.Example.COM/x')).toBe('www.example.com');
  });
  it('returns empty string for a relative / unparseable URL', () => {
    expect(hostOf('/assets/logo.png')).toBe('');
    expect(hostOf('')).toBe('');
  });
});

// ── 2026-09-22: the Super Taco logo — the real mark vs. its neighbours ──────
//
// supertacomex.com's header shows a "Best of Sacramento" award badge
// (`BOSLogo19_edited.png`, 78) right before the real wordmark
// (`super_taco_logo_(1).png`, 78, linked to the home page), and its
// apple-touch-icon — a crop of a FOOD PHOTO — scored 85 above both.
describe("awardBadgeDemotion — somebody else's program is not the logo", () => {
  const badges: Array<[string, string, string]> = [
    [
      '"best of" in the alt',
      'Best of Sacramento 2019',
      'https://acme.com/img/badge-2019.png',
    ],
    ['an award filename', '', 'https://acme.com/img/award-2023.png'],
    ['a winner seal', 'readers choice winner', 'https://acme.com/img/seal.png'],
    [
      'a certification mark',
      'Certified B Corporation',
      'https://acme.com/img/bcorp.png',
    ],
    ['a partner logo', 'our partners', 'https://acme.com/img/partner-logo.png'],
    ['a top-N list', '', 'https://acme.com/img/top-10-restaurants.png'],
    ['an "as seen on" strip', 'As seen on TV', 'https://acme.com/img/tv.png'],
  ];
  it.each(badges)('demotes %s', (_label, text, url) => {
    const v = awardBadgeDemotion(text, url, ['acmetacos']);
    expect(v.reject).toBe(false);
    expect(v.factor).toBeLessThan(0.5);
    expect(v.reasons).toEqual(['award/partner badge']);
  });

  it('exempts a mark that carries the BRAND name ("Best Of Philly" calls its own logo that)', () => {
    const keys = brandKeysFrom('Best Of Philly Cheesesteaks');
    expect(
      awardBadgeDemotion(
        'Best Of Philly Cheesesteaks logo',
        'https://bop.com/img/best-of-philly-cheesesteaks-logo.png',
        keys,
      ).factor,
    ).toBe(1);
  });

  it('leaves an ordinary logo alone — no token-boundary false hits', () => {
    const plain: Array<[string, string]> = [
      [
        'super_taco_logo_(1).png',
        'https://static.wixstatic.com/media/e44cfe_5ca48~mv2.png/v1/fill/w_700,h_196/super_taco_logo_(1).png',
      ],
      ['Generated Logo', 'https://acme.com/img/generated-logo.png'],
      ['Won Ton House', 'https://wonton.com/logo.svg'],
      ['Seal Beach Surf Shop', 'https://sealbeachsurf.com/logo.png'],
    ];
    for (const [text, url] of plain) {
      expect(awardBadgeDemotion(text, url, []).factor).toBe(1);
    }
  });
});

describe('brandKeysFrom + logoSignalBonus — positive evidence of THE logo', () => {
  it('normalizes brand names and drops "The" and short keys', () => {
    expect(brandKeysFrom('Super Taco', 'Super Taco', 'Supertacomex')).toEqual([
      'supertaco',
      'supertacomex',
    ]);
    expect(brandKeysFrom('The Home Depot')).toEqual(['homedepot']);
    expect(brandKeysFrom('IHOP', 'X', null, undefined)).toEqual(['ihop']);
    expect(brandKeysFrom('Café Río')).toEqual(['caferio']);
  });

  it('super_taco_logo_(1).png — brand in the filename + linked home + wordmark shape = +31', () => {
    const b = logoSignalBonus({
      text: 'super_taco_logo_(1).png super_taco_logo_(1).png',
      brandKeys: brandKeysFrom('Super Taco'),
      linksHome: true,
      width: 350,
      height: 98,
    });
    expect(b).toEqual({ bonus: 31, brandMatch: true });
  });

  it('the award badge beside it earns nothing', () => {
    const b = logoSignalBonus({
      text: 'boslogo19_edited.png BOSLogo19_edited.png',
      brandKeys: brandKeysFrom('Super Taco'),
      linksHome: false,
      width: 197,
      height: 98,
    });
    expect(b).toEqual({ bonus: 0, brandMatch: false });
  });

  it('counts each signal on its own, and a square mark gets no shape bonus', () => {
    expect(
      logoSignalBonus({
        text: 'logo.png',
        linksHome: true,
        width: 200,
        height: 200,
      }).bonus,
    ).toBe(10);
    expect(
      logoSignalBonus({ text: 'logo.png', width: 900, height: 200 }).bonus,
    ).toBe(6);
    expect(
      logoSignalBonus({
        text: 'acme-coffee-logo.svg',
        brandKeys: ['acmecoffee'],
      }).bonus,
    ).toBe(15);
    // A 20:1 strip is a divider, not a wordmark.
    expect(
      logoSignalBonus({ text: 'strip.png', width: 2000, height: 100 }).bonus,
    ).toBe(0);
  });
});

describe('capIconsBelowRealLogo — a site icon never out-ranks the real mark', () => {
  it('caps the apple-touch-icon / favicon / og card below the best header logo', () => {
    const logos: Array<{
      kind: string;
      score: number;
      filterReasons?: string[];
      headerMark?: boolean;
    }> = [
      { kind: 'apple-touch', score: 85 },
      { kind: 'icon', score: 82 },
      { kind: 'og', score: 60 },
      { kind: 'img-logo', score: 70, headerMark: true },
    ];
    capIconsBelowRealLogo(logos);
    const real = logos.find((l) => l.kind === 'img-logo')!;
    for (const l of logos)
      if (l !== real) expect(l.score).toBeLessThan(real.score);
    expect(logos[0].score).toBe(63);
    expect(logos[0].filterReasons?.join(' ')).toMatch(/site icon/);
    // Already below the ceiling: untouched, no reason stamped.
    expect(logos[2].score).toBe(60);
    expect(logos[2].filterReasons).toBeUndefined();
  });

  it('is a no-op when the site has no real logo candidate (icons stay the fallback)', () => {
    const logos = [
      { kind: 'apple-touch', score: 85 },
      {
        kind: 'img-logo',
        score: 20,
        filterReasons: ['social/share/badge asset name'],
      },
    ];
    capIconsBelowRealLogo(logos);
    expect(logos[0].score).toBe(85);
  });

  it('a logo-named image OUTSIDE the header (a footer partner strip) does not push the icon aside', () => {
    const logos: Array<{
      kind: string;
      score: number;
      filterReasons?: string[];
      headerMark?: boolean;
    }> = [
      { kind: 'apple-touch', score: 85 },
      { kind: 'img-logo', score: 70 },
    ];
    capIconsBelowRealLogo(logos);
    expect(logos[0].score).toBe(85);
    expect(logos[0].filterReasons).toBeUndefined();
  });

  it('isHeaderLogoCandidate needs BOTH a real, undemoted mark and header evidence', () => {
    expect(isHeaderLogoCandidate({ kind: 'img-logo', headerMark: true })).toBe(
      true,
    );
    expect(
      isHeaderLogoCandidate({ kind: 'svg-inline', headerMark: true }),
    ).toBe(true);
    expect(isHeaderLogoCandidate({ kind: 'img-logo' })).toBe(false);
    expect(
      isHeaderLogoCandidate({
        kind: 'img-logo',
        headerMark: true,
        filterReasons: ['award/partner badge'],
      }),
    ).toBe(false);
    // A touch icon in the <head> is never a header MARK, whatever it claims.
    expect(
      isHeaderLogoCandidate({ kind: 'apple-touch', headerMark: true }),
    ).toBe(false);
    expect(isHeaderLogoCandidate(undefined)).toBe(false);
  });

  it('does not count a DEMOTED img as a real logo', () => {
    expect(isRealLogoCandidate({ kind: 'img-logo' })).toBe(true);
    expect(isRealLogoCandidate({ kind: 'svg-inline', filterReasons: [] })).toBe(
      true,
    );
    expect(
      isRealLogoCandidate({
        kind: 'img-logo',
        filterReasons: ['award/partner badge'],
      }),
    ).toBe(false);
    expect(isRealLogoCandidate({ kind: 'apple-touch' })).toBe(false);
    expect(isRealLogoCandidate(null)).toBe(false);
  });
});

describe('decodedPhotoDemotion + scoreLogoCandidate(brandKeys)', () => {
  it('a candidate whose pixels are a photograph drops to a fifth', () => {
    expect(decodedPhotoDemotion(true)).toEqual({
      reject: false,
      factor: 0.2,
      reasons: ['decodes as a photograph'],
    });
    expect(decodedPhotoDemotion(false).factor).toBe(1);
  });

  it('scoreLogoCandidate applies the award demotion on every path', () => {
    const v = scoreLogoCandidate(
      {
        url: 'https://acme.com/img/best-of-2019.png',
        score: 78,
        kind: 'img-logo',
        text: 'best of the city',
      },
      'acme.com',
      { brandKeys: ['acmetacos'] },
    );
    expect(v.score).toBeLessThan(30);
    expect(v.reasons).toContain('award/partner badge');
  });
});
