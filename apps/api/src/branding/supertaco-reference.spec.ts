/**
 * supertacomex.com through the REAL website reader — the Super Taco boards
 * (2026-09-22, docs/research/2026-09-22-ai-designer-rework/01 + 02).
 *
 * GPT-6 Sol drew three bad boards for Super Taco because of what this reader
 * handed it: the site's apple-touch-icon — a 180×180 crop of a FOOD PHOTO,
 * scored 85 — as the logo, over the real header wordmark
 * `super_taco_logo_(1).png` (78) and a "Best of Sacramento" award badge (78,
 * first in page order); a Wix `blur_2` LOADING PLACEHOLDER (151×101 px) the
 * page labels 1805×670 as the hero photo; and a palette of the food photo's
 * browns instead of the logo's orange.
 *
 * The page is the committed, trimmed copy of the real homepage; the images
 * are synthetic stand-ins (test/supertaco-site.ts). No network.
 *
 * NEGATIVE CONTROL: this spec only uses APIs that existed before the fix
 * (`BrandingScraperService.scrape`, `summarizeUrlReference(preview, url)`), so
 * it runs unchanged against the old code — where every test below fails: the
 * logo is the touch icon, the photo a `blur_2` placeholder (the patio's), the
 * palette not orange. The CHECKED + re-hosted version of the same run lives in
 * ai/designer-assets.spec.ts.
 */
const safeFetchMock = jest.fn();
jest.mock('./safe-fetch', () => ({
  ...jest.requireActual<object>('./safe-fetch'),
  safeFetch: (...args: unknown[]): unknown => safeFetchMock(...args),
}));

import type { ConciergeReference } from '@cms/api-types';
import {
  BrandingScraperService,
  type BrandingPreview,
} from './branding-scraper.service';
import { summarizeUrlReference } from '../ai/signage-concierge';
import {
  SUPERTACO_URL,
  SUPERTACO_MEDIA,
  SUPERTACO_LOGO_ORIGINAL,
  SUPERTACO_HERO_ORIGINAL,
  supertacoSite,
  isOrangeRed,
} from '../../test/supertaco-site';

describe('supertacomex.com — what the website reader hands the AI Designer', () => {
  let preview: BrandingPreview;
  let ref: ConciergeReference;

  beforeAll(async () => {
    const site = await supertacoSite();
    safeFetchMock.mockImplementation(site.fetch);
    preview = await new BrandingScraperService().scrape(SUPERTACO_URL, 8000);
    ref = summarizeUrlReference(preview, SUPERTACO_URL);
  });

  afterAll(() => safeFetchMock.mockReset());

  const logoWhere = (test: (url: string, kind: string) => boolean) =>
    preview.logos.find((l) => test(l.url || '', l.kind));

  it('ranks the real header logo super_taco_logo_(1).png first — not the touch icon, not the award badge', () => {
    const top = preview.logos[0];
    expect(top.url).toContain('super_taco_logo_(1).png');
    expect(top.url).toContain(SUPERTACO_MEDIA.logo);
    const badge = logoWhere((u) => u.includes('BOSLogo19'));
    const touch = logoWhere((_u, k) => k === 'apple-touch');
    expect(badge).toBeTruthy();
    expect(touch).toBeTruthy();
    expect(top.score).toBeGreaterThan(badge!.score);
    expect(top.score).toBeGreaterThan(touch!.score);
  });

  it('hands over the logo ORIGINAL (the bare media URL), never a favicon or the badge', () => {
    expect(ref.logoUrl).toBe(SUPERTACO_LOGO_ORIGINAL);
    expect(ref.logoUrl).not.toContain(SUPERTACO_MEDIA.foodPhotoIcon);
    expect(ref.logoUrl).not.toContain(SUPERTACO_MEDIA.awardBadge);
  });

  it('hands over the hero photo ORIGINAL — never a blur_ loading placeholder', () => {
    expect(ref.imageUrl).toBe(SUPERTACO_HERO_ORIGINAL);
    expect(ref.imageUrl).not.toMatch(/blur_\d/);
  });

  it('reads the hero photo by its TRUE size (6000×4000), not the 1805×670 label', () => {
    const hero = preview.heroImages.find((h) =>
      (h.url || '').includes(SUPERTACO_MEDIA.hero),
    );
    expect(hero).toBeTruthy();
    expect(hero!.naturalWidth).toBe(6000);
    expect(hero!.naturalHeight).toBe(4000);
    expect(hero!.placeholder).toBe(true);
  });

  it("derives the palette from the LOGO's orange-red — not the food photo's browns, not Wix blue", () => {
    expect(preview.paletteSource).toBe('logo');
    expect(isOrangeRed(preview.palette.primary)).toBe(true);
    expect(ref.palette?.length).toBeGreaterThan(0);
    expect(isOrangeRed(ref.palette![0])).toBe(true);
    // Site chrome (Wix's own blue / purple) is not the brand.
    expect(ref.palette).not.toContain('#116dff');
    expect(ref.palette).not.toContain('#5f5bcd');
  });

  it('never lets the food-photo touch icon supply colors', () => {
    const touch = logoWhere((_u, k) => k === 'apple-touch');
    expect(touch!.photographic).toBe(true);
    expect((touch!.filterReasons || []).join(' ')).toMatch(/photograph/);
  });
});
