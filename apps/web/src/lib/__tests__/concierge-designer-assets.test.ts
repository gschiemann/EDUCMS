/**
 * Which logo and photo a Concierge generation hands the AI Designer — and whose
 * they are (2026-09-23). The operator's own image always wins: photos rank
 * upload > POS > site > (no provenance) > stock, logos upload > site.
 *
 * FIXTURE PROVENANCE: every reference below is the verbatim JSON the API's
 * own producers returned (see concierge-asset-references.fixture.ts) — the
 * `imageSource` / `logoSource` values are the API's, not typed here.
 */
import type { ConciergeReference } from '@cms/api-types';
import { pickConciergeDesignerAssets, conciergeUrlReferenceBody } from '../concierge-designer-assets';
import {
  URL_SITE_PHOTO,
  URL_STOCK_PHOTO,
  UPLOAD_LOGO,
  UPLOAD_PHOTO,
  UPLOAD_DESIGN,
} from './concierge-asset-references.fixture';

describe('pickConciergeDesignerAssets — the operator\'s own image wins', () => {
  it('the producers really do mark where each image came from (the premise)', () => {
    expect([URL_SITE_PHOTO.imageSource, URL_STOCK_PHOTO.imageSource, UPLOAD_PHOTO.imageSource]).toEqual(['site', 'stock', 'upload']);
    expect([URL_SITE_PHOTO.logoSource, UPLOAD_LOGO.logoSource]).toEqual(['site', 'upload']);
    expect(UPLOAD_DESIGN.imageUrl).toBeUndefined();
    expect(UPLOAD_DESIGN.logoUrl).toBeUndefined();
  });

  it('a site reference alone: its logo and photo, marked as the site\'s', () => {
    expect(pickConciergeDesignerAssets([URL_SITE_PHOTO])).toEqual({
      logoUrl: URL_SITE_PHOTO.logoUrl,
      logoSource: 'site',
      heroImageUrl: URL_SITE_PHOTO.imageUrl,
      heroImageSource: 'site',
    });
  });

  it('an uploaded photo beats the site\'s STOCK photo even though the URL came first', () => {
    const got = pickConciergeDesignerAssets([URL_STOCK_PHOTO, UPLOAD_PHOTO]);
    expect(got.heroImageUrl).toBe(UPLOAD_PHOTO.imageUrl);
    expect(got.heroImageSource).toBe('upload');
    // The site's logo still comes along — no upload replaced it.
    expect(got.logoUrl).toBe(URL_STOCK_PHOTO.logoUrl);
    expect(got.logoSource).toBe('site');
  });

  it('an uploaded logo beats the site\'s logo, in either order', () => {
    for (const refs of [[URL_SITE_PHOTO, UPLOAD_LOGO], [UPLOAD_LOGO, URL_SITE_PHOTO]]) {
      const got = pickConciergeDesignerAssets(refs);
      expect(got.logoUrl).toBe(UPLOAD_LOGO.logoUrl);
      expect(got.logoSource).toBe('upload');
      expect(got.heroImageUrl).toBe(URL_SITE_PHOTO.imageUrl);
    }
  });

  it('the site\'s own photo beats a stock photo from another site reference', () => {
    const got = pickConciergeDesignerAssets([URL_STOCK_PHOTO, URL_SITE_PHOTO]);
    expect(got.heroImageUrl).toBe(URL_SITE_PHOTO.imageUrl);
    expect(got.heroImageSource).toBe('site');
  });

  it('a stock photo is used only when nothing better exists — and is SAID to be stock', () => {
    const got = pickConciergeDesignerAssets([UPLOAD_DESIGN, URL_STOCK_PHOTO]);
    expect(got.heroImageUrl).toBe(URL_STOCK_PHOTO.imageUrl);
    expect(got.heroImageSource).toBe('stock');
  });

  it('upload > POS > site > unmarked > stock, whatever order they arrive in', () => {
    const photo = (source: string | undefined, n: number) =>
      ({ kind: 'url', summary: 's', imageUrl: `https://sb.example/p-${n}.jpg`, ...(source ? { imageSource: source } : {}) }) as unknown as ConciergeReference;
    const refs = [photo('stock', 0), photo(undefined, 1), photo('site', 2), photo('pos', 3), photo('upload', 4)];
    const ranked: string[] = [];
    let pool = [...refs];
    while (pool.length) {
      const got = pickConciergeDesignerAssets(pool);
      ranked.push(`${got.heroImageSource ?? 'unmarked'}`);
      pool = pool.filter((r) => r.imageUrl !== got.heroImageUrl);
    }
    expect(ranked).toEqual(['upload', 'pos', 'site', 'unmarked', 'stock']);
    // Reversed input, same winner.
    expect(pickConciergeDesignerAssets([...refs].reverse()).heroImageSource).toBe('upload');
  });

  it('ties go to the earlier reference (the old first-wins rule, within a rank)', () => {
    const a = { ...URL_SITE_PHOTO, imageUrl: 'https://sb.example/a.jpg' } as ConciergeReference;
    const b = { ...URL_SITE_PHOTO, imageUrl: 'https://sb.example/b.jpg' } as ConciergeReference;
    expect(pickConciergeDesignerAssets([a, b]).heroImageUrl).toBe('https://sb.example/a.jpg');
  });

  it('never sends a source it does not know, or a URL the generate request would reject', () => {
    const odd = [
      { kind: 'url', summary: 's', imageUrl: 'https://sb.example/x.jpg', imageSource: 'ai-generated', logoUrl: 'https://sb.example/l.png', logoSource: 'pos' },
      { kind: 'image', summary: 's', imageUrl: 'not a url', imageSource: 'upload' },
      { kind: 'image', summary: 's', logoUrl: 'javascript:alert(1)', logoSource: 'upload' },
    ] as unknown as ConciergeReference[];
    expect(pickConciergeDesignerAssets(odd)).toEqual({ logoUrl: 'https://sb.example/l.png', heroImageUrl: 'https://sb.example/x.jpg' });
  });

  it('nothing usable: nothing at all (the request carries no logo / photo fields)', () => {
    expect(pickConciergeDesignerAssets([UPLOAD_DESIGN])).toEqual({});
    expect(pickConciergeDesignerAssets([])).toEqual({});
    expect(pickConciergeDesignerAssets(undefined)).toEqual({});
  });

  it('negative control: the page\'s old first-wins rule picks the STOCK photo here', () => {
    const refs = [URL_STOCK_PHOTO, UPLOAD_PHOTO];
    const firstWins = refs.map((r) => r.imageUrl).find((u) => typeof u === 'string' && u);
    expect(firstWins).toBe(URL_STOCK_PHOTO.imageUrl);
    expect(pickConciergeDesignerAssets(refs).heroImageUrl).not.toBe(firstWins);
  });
});

describe('conciergeUrlReferenceBody — the canvas rides with the URL', () => {
  it('sends the canvas being designed', () => {
    expect(conciergeUrlReferenceBody('https://supertacomex.com', { w: 960, h: 1080 })).toEqual({
      url: 'https://supertacomex.com',
      screenWidth: 960,
      screenHeight: 1080,
    });
    expect(conciergeUrlReferenceBody('x.com', { w: 2160, h: 3840 })).toEqual({ url: 'x.com', screenWidth: 2160, screenHeight: 3840 });
  });

  it('leaves out a missing or nonsensical canvas (the API then sizes for 3840x2160, as before)', () => {
    expect(conciergeUrlReferenceBody('x.com')).toEqual({ url: 'x.com' });
    expect(conciergeUrlReferenceBody('x.com', null)).toEqual({ url: 'x.com' });
    expect(conciergeUrlReferenceBody('x.com', { w: 0, h: 1080 })).toEqual({ url: 'x.com' });
    expect(conciergeUrlReferenceBody('x.com', { w: 1920, h: Number.NaN })).toEqual({ url: 'x.com' });
    expect(conciergeUrlReferenceBody('x.com', { w: 20000, h: 1080 })).toEqual({ url: 'x.com' });
    expect(conciergeUrlReferenceBody('x.com', { w: '1920', h: '1080' })).toEqual({ url: 'x.com' });
  });

  it('rounds a fractional canvas', () => {
    expect(conciergeUrlReferenceBody('x.com', { w: 1919.6, h: 1080.2 })).toEqual({ url: 'x.com', screenWidth: 1920, screenHeight: 1080 });
  });
});
