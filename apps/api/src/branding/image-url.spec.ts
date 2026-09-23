/**
 * image-url — CDN rendition → original, srcset parsing, placeholder detection.
 *
 * The Super Taco hero (2026-09-22) was a Wix `blur_2` LOADING PLACEHOLDER —
 * `…/v1/fill/w_151,h_101,…,blur_2,…/photo.jpg`, 5,200 bytes — while the
 * 2.6 MB original sat at the bare media URL. Every builder / CDN hides the
 * upload behind a rendition URL in its own way; this is the table of them.
 */
import {
  originalImageUrl,
  parseSrcset,
  largestSrcsetCandidate,
  isPlaceholderImageUrl,
  pexelsPhotoAtWidth,
} from './image-url';

describe('originalImageUrl — one row per CDN', () => {
  const table: Array<[string, string, string]> = [
    // ── Wix ──────────────────────────────────────────────────────────────
    [
      'Wix fill rendition (the Super Taco hero blur placeholder)',
      'https://static.wixstatic.com/media/2143c7_2b2a73a7bef0418bb4b7d98a1152d93d~mv2.jpg/v1/fill/w_151,h_101,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto/2143c7_2b2a73a7bef0418bb4b7d98a1152d93d~mv2.jpg',
      'https://static.wixstatic.com/media/2143c7_2b2a73a7bef0418bb4b7d98a1152d93d~mv2.jpg',
    ],
    [
      'Wix fill rendition with a renamed file (the real Super Taco logo)',
      'https://static.wixstatic.com/media/e44cfe_5ca482429a8a469b88bdaa5554a0f5ba~mv2.png/v1/fill/w_700,h_196,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/super_taco_logo_(1).png',
      'https://static.wixstatic.com/media/e44cfe_5ca482429a8a469b88bdaa5554a0f5ba~mv2.png',
    ],
    [
      'Wix fit rendition, %7E-encoded (an og:image)',
      'https://static.wixstatic.com/media/2143c7_6d388627216a4e1b9b9424e0a79df018%7Emv2.png/v1/fit/w_2500,h_1330,al_c/2143c7_6d388627216a4e1b9b9424e0a79df018%7Emv2.png',
      'https://static.wixstatic.com/media/2143c7_6d388627216a4e1b9b9424e0a79df018%7Emv2.png',
    ],
    [
      'Wix crop + fill chain',
      'https://static.wixstatic.com/media/2143c7_f8e4deab5f8f455fbf640d38850656c3~mv2.jpg/v1/crop/x_0,y_292,w_816,h_816/fill/w_539,h_539,al_c,q_80/super%20taco%20august%2022_12.jpg',
      'https://static.wixstatic.com/media/2143c7_f8e4deab5f8f455fbf640d38850656c3~mv2.jpg',
    ],
    // ── Squarespace ──────────────────────────────────────────────────────
    [
      'Squarespace ?format=500w',
      'https://images.squarespace-cdn.com/content/v1/5f1a/1600000000000-ABC/hero.jpg?format=500w',
      'https://images.squarespace-cdn.com/content/v1/5f1a/1600000000000-ABC/hero.jpg',
    ],
    [
      'Squarespace ?format keeps any other param',
      'https://images.squarespace-cdn.com/content/v1/5f1a/abc/logo.png?format=300w&content-type=image%2Fpng',
      'https://images.squarespace-cdn.com/content/v1/5f1a/abc/logo.png?content-type=image%2Fpng',
    ],
    // ── Shopify ──────────────────────────────────────────────────────────
    [
      'Shopify _400x suffix',
      'https://cdn.shopify.com/s/files/1/0123/4567/files/hero_400x.jpg?v=1614',
      'https://cdn.shopify.com/s/files/1/0123/4567/files/hero.jpg?v=1614',
    ],
    [
      'Shopify _400x400_crop_center@2x suffix',
      'https://cdn.shopify.com/s/files/1/0123/4567/products/taco_400x400_crop_center@2x.png?v=1',
      'https://cdn.shopify.com/s/files/1/0123/4567/products/taco.png?v=1',
    ],
    [
      'Shopify legacy named size (_grande)',
      'https://cdn.shopify.com/s/files/1/0123/4567/files/banner_grande.jpg',
      'https://cdn.shopify.com/s/files/1/0123/4567/files/banner.jpg',
    ],
    [
      'Shopify {width}x template',
      'https://cdn.shopify.com/s/files/1/0123/4567/files/logo_{width}x.png?v=2',
      'https://cdn.shopify.com/s/files/1/0123/4567/files/logo.png?v=2',
    ],
    [
      'Shopify store-domain /cdn/shop with ?width=',
      'https://store.example.com/cdn/shop/files/hero.jpg?v=1700&width=800',
      'https://store.example.com/cdn/shop/files/hero.jpg?v=1700',
    ],
    // ── WordPress ────────────────────────────────────────────────────────
    [
      'WordPress -1024x683 intermediate size',
      'https://www.example.com/wp-content/uploads/2024/05/patio-1024x683.jpg',
      'https://www.example.com/wp-content/uploads/2024/05/patio.jpg',
    ],
    [
      'WordPress -150x150 thumbnail (png)',
      'https://example.org/wp-content/uploads/2023/01/logo-150x150.png',
      'https://example.org/wp-content/uploads/2023/01/logo.png',
    ],
    [
      'Jetpack Photon (i0.wp.com) wrapping a WordPress size',
      'https://i0.wp.com/www.example.com/wp-content/uploads/2024/05/patio-768x512.jpg?resize=768%2C512&ssl=1',
      'https://www.example.com/wp-content/uploads/2024/05/patio.jpg',
    ],
    // ── Cloudinary ───────────────────────────────────────────────────────
    [
      'Cloudinary transformation segment + version',
      'https://res.cloudinary.com/demo/image/upload/c_fill,w_400,h_300/q_auto,f_auto/v1571218039/menu/tacos.jpg',
      'https://res.cloudinary.com/demo/image/upload/v1571218039/menu/tacos.jpg',
    ],
    [
      'Cloudinary transformation, no version',
      'https://res.cloudinary.com/demo/image/upload/w_200/sample.jpg',
      'https://res.cloudinary.com/demo/image/upload/sample.jpg',
    ],
    [
      'Cloudinary fetch/ wrapper around a remote image',
      'https://res.cloudinary.com/demo/image/fetch/w_300,f_auto/https://www.example.com/wp-content/uploads/2024/05/hero-300x200.jpg',
      'https://www.example.com/wp-content/uploads/2024/05/hero.jpg',
    ],
    // ── imgix + imgix-backed CDNs ────────────────────────────────────────
    [
      'imgix size params',
      'https://acme.imgix.net/photos/hero.jpg?w=400&h=300&fit=crop&auto=format',
      'https://acme.imgix.net/photos/hero.jpg',
    ],
    [
      'Pexels large2x',
      'https://images.pexels.com/photos/2092507/pexels-photo-2092507.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
      'https://images.pexels.com/photos/2092507/pexels-photo-2092507.jpeg',
    ],
    [
      'Unsplash',
      'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?ixlib=rb-4.0.3&w=640&q=80',
      'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b',
    ],
    // ── Other builders ───────────────────────────────────────────────────
    [
      'Webflow -p-800 responsive variant',
      'https://assets-global.website-files.com/5f1a/5f1b_hero-p-800.jpeg',
      'https://assets-global.website-files.com/5f1a/5f1b_hero.jpeg',
    ],
    [
      'GoDaddy Websites /:/ transform',
      'https://img1.wsimg.com/isteam/ip/abc-123/hero.jpg/:/cr=t:0%25,l:0%25,w:100%25,h:100%25/rs=w:1280',
      'https://img1.wsimg.com/isteam/ip/abc-123/hero.jpg',
    ],
    [
      'Cloudflare Image Resizing (relative source)',
      'https://www.example.com/cdn-cgi/image/width=640,quality=75/uploads/hero.jpg',
      'https://www.example.com/uploads/hero.jpg',
    ],
    [
      'Next.js image optimizer (relative source)',
      'https://www.example.com/_next/image?url=%2Fimages%2Fhero.jpg&w=1080&q=75',
      'https://www.example.com/images/hero.jpg',
    ],
    [
      'Next.js image optimizer wrapping a Wix rendition (unwrapped twice)',
      'https://www.example.com/_next/image?url=https%3A%2F%2Fstatic.wixstatic.com%2Fmedia%2Fabc_123~mv2.jpg%2Fv1%2Ffill%2Fw_300%2Ch_200%2Fx.jpg&w=640&q=75',
      'https://static.wixstatic.com/media/abc_123~mv2.jpg',
    ],
  ];

  it.each(table)('%s', (_label, rendition, original) => {
    expect(originalImageUrl(rendition)).toBe(original);
  });

  it('is idempotent — an original maps to itself', () => {
    for (const [, , original] of table)
      expect(originalImageUrl(original)).toBe(original);
  });

  const unchanged: Array<[string, string]> = [
    ['an unknown host', 'https://www.example.com/images/logo-2x.png?v=3'],
    [
      'a signed imgix URL (touching it breaks the signature)',
      'https://acme.imgix.net/hero.jpg?w=400&s=0f9d1a2b3c',
    ],
    [
      'a WordPress upload that is already the original',
      'https://www.example.com/wp-content/uploads/2024/05/patio.jpg',
    ],
    [
      'a Squarespace URL with no format param',
      'https://images.squarespace-cdn.com/content/v1/5f1a/abc/logo.png',
    ],
    ['a data: URI', 'data:image/png;base64,iVBORw0KGgo='],
    ['a relative path', '/images/hero.jpg'],
    ['garbage', 'not a url'],
  ];

  it.each(unchanged)('leaves %s unchanged', (_label, url) => {
    expect(originalImageUrl(url)).toBe(url);
  });
});

describe('parseSrcset / largestSrcsetCandidate', () => {
  it('keeps Wix URLs whole — the commas INSIDE the URL are not separators', () => {
    const srcset =
      'https://static.wixstatic.com/media/e44cfe_5ca482429a8a469b88bdaa5554a0f5ba~mv2.png/v1/fill/w_350,h_98,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/super_taco_logo_(1).png 1x, ' +
      'https://static.wixstatic.com/media/e44cfe_5ca482429a8a469b88bdaa5554a0f5ba~mv2.png/v1/fill/w_700,h_196,al_c,q_85,usm_0.66_1.00_0.01,enc_avif,quality_auto/super_taco_logo_(1).png 2x';
    const cands = parseSrcset(srcset);
    expect(cands).toHaveLength(2);
    expect(cands[0].url).toContain('w_350,h_98,al_c');
    expect(cands[0].density).toBe(1);
    expect(cands[1].url).toContain('w_700,h_196,al_c');
    expect(cands[1].density).toBe(2);
    expect(largestSrcsetCandidate(srcset)?.url).toContain('w_700,h_196');
  });

  it('picks by width descriptor when the set has them', () => {
    const srcset = '/a-400.jpg 400w, /a-1600.jpg 1600w, /a-800.jpg 800w';
    expect(largestSrcsetCandidate(srcset)).toEqual({
      url: '/a-1600.jpg',
      width: 1600,
    });
  });

  it('treats a bare URL as 1x and never returns a placeholder', () => {
    expect(
      largestSrcsetCandidate('data:image/gif;base64,R0lGOD 1x, /real.jpg 2x')
        ?.url,
    ).toBe('/real.jpg');
    expect(largestSrcsetCandidate('/only.jpg')?.url).toBe('/only.jpg');
    expect(largestSrcsetCandidate('')).toBeNull();
    expect(largestSrcsetCandidate(undefined)).toBeNull();
  });
});

describe('isPlaceholderImageUrl', () => {
  const placeholders = [
    'https://static.wixstatic.com/media/2143c7_2b2a73a7bef0418bb4b7d98a1152d93d~mv2.jpg/v1/fill/w_151,h_101,al_c,q_80,usm_0.66_1.00_0.01,blur_2,enc_avif,quality_auto/x.jpg',
    'https://static.wixstatic.com/media/e44cfe_72c5219d~mv2.png/v1/fill/w_49,h_2,al_c,q_85/x.png',
    'https://cdn.example.com/lqip/hero.jpg',
    'https://cdn.example.com/hero-lqip.jpg',
    'https://www.example.com/wp-content/themes/x/images/placeholder.png',
    'https://www.example.com/img/blank.gif',
    'https://www.example.com/img/spacer.gif',
    'https://www.example.com/lazy-load/1x1.png',
    'https://images.ctfassets.net/abc/hero.jpg?w=20&blur=50',
    'https://res.cloudinary.com/demo/image/upload/e_blur:2000,w_40/sample.jpg',
    'data:image/svg+xml;base64,PHN2Zz4=',
    '',
  ];
  it.each(placeholders.map((u) => [u]))('flags %s', (u) => {
    expect(isPlaceholderImageUrl(u)).toBe(true);
  });

  const real = [
    'https://static.wixstatic.com/media/2143c7_2b2a73a7bef0418bb4b7d98a1152d93d~mv2.jpg',
    'https://www.example.com/images/blurry-lake-sunset.jpg',
    'https://www.example.com/uploads/lazy-river-waterpark.jpg',
    'https://www.example.com/menu/spinach-enchiladas.jpg',
    'https://res.cloudinary.com/demo/image/upload/v1571218039/menu/tacos.jpg',
  ];
  it.each(real.map((u) => [u]))('does not flag %s', (u) => {
    expect(isPlaceholderImageUrl(u)).toBe(false);
  });
});

describe('pexelsPhotoAtWidth — the original at the slot width, not large2x', () => {
  it('rebuilds a Pexels rendition as the original + a width', () => {
    expect(
      pexelsPhotoAtWidth(
        'https://images.pexels.com/photos/2092507/pexels-photo-2092507.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940',
        4096,
      ),
    ).toBe(
      'https://images.pexels.com/photos/2092507/pexels-photo-2092507.jpeg?auto=compress&cs=tinysrgb&w=4096',
    );
  });

  it('clamps the width and refuses anything that is not a Pexels https URL', () => {
    expect(
      pexelsPhotoAtWidth('https://images.pexels.com/photos/1/p.jpeg', 50),
    ).toContain('w=320');
    expect(
      pexelsPhotoAtWidth('https://images.pexels.com/photos/1/p.jpeg', 99999),
    ).toContain('w=6000');
    expect(
      pexelsPhotoAtWidth('http://images.pexels.com/photos/1/p.jpeg', 2000),
    ).toBeNull();
    expect(
      pexelsPhotoAtWidth(
        'https://images.pexels.com.evil.example/photos/1/p.jpeg',
        2000,
      ),
    ).toBeNull();
    expect(
      pexelsPhotoAtWidth('https://cdn.example.com/p.jpeg', 2000),
    ).toBeNull();
  });
});
