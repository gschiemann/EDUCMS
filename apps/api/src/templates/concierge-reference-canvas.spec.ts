/**
 * POST /templates/concierge/reference/url — the canvas the Concierge now sends
 * (2026-09-23, useConciergeUrlReference(canvas) on the web) decides how big the
 * site's photo must be.
 *
 * A photo is checked against the slot it will fill: on the Designer's default
 * 3840×2160 board its short side must reach 800 px; on a 960×1080 LED poster,
 * 60% of that canvas's short side (576 px). Without the canvas, a perfectly good
 * photo for the poster was refused as "too small" for a 4K board it was never
 * going on.
 *
 * The scrape is the REAL BrandingScraperService over the committed, trimmed
 * supertacomex.com homepage; images are real encodings (test/supertaco-site.ts)
 * behind a mocked safeFetch; the bucket is in memory.
 */
const safeFetchMock = jest.fn();
jest.mock('../branding/safe-fetch', () => ({
  ...jest.requireActual<object>('../branding/safe-fetch'),
  safeFetch: (...args: unknown[]): unknown => safeFetchMock(...args),
}));

import { TemplatesController } from './templates.controller';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import { supertacoSite, photoJpeg, SUPERTACO_URL, SUPERTACO_MEDIA } from '../../test/supertaco-site';

jest.setTimeout(30_000);

const HERO_ORIGINAL = `https://static.wixstatic.com/media/${SUPERTACO_MEDIA.hero}~mv2.jpg`;

function makeController() {
  const uploads: string[] = [];
  const controller = Object.create(TemplatesController.prototype) as TemplatesController;
  Object.assign(controller, {
    brandingScraper: new BrandingScraperService(),
    ai: { extractSiteMenu: () => Promise.resolve(null) },
    storage: {
      upload: (path: string) => {
        uploads.push(path);
        return Promise.resolve(`https://sb.example/storage/v1/object/public/assets/${path}`);
      },
    },
    stockImages: { isConfigured: () => false, search: () => Promise.resolve(null) },
    auditLogger: { warn: () => undefined, log: () => undefined },
  });
  return { controller, uploads };
}

const REQ = { user: { tenantId: 'tenant-st', id: 'u1', role: 'SCHOOL_ADMIN' } };

describe('reference/url sizes the photo check for the canvas it is sent', () => {
  beforeEach(async () => {
    // The site's hero is a real 1000×650 photo: too small for a 4K board, plenty for a 960×1080 poster.
    const hero = await photoJpeg(1000, 650, 81);
    const site = await supertacoSite({
      [HERO_ORIGINAL]: () => Promise.resolve({ status: 200, body: hero, contentType: 'image/jpeg', finalUrl: HERO_ORIGINAL }),
    });
    safeFetchMock.mockImplementation(site.fetch);
  });
  afterEach(() => safeFetchMock.mockReset());

  it('a 960×1080 canvas: the photo is used (and marked as the site\'s)', async () => {
    const { controller } = makeController();
    const ref: any = await controller.conciergeReferenceUrl(REQ, { url: SUPERTACO_URL, screenWidth: 960, screenHeight: 1080 } as any);
    expect(ref.imageUrl).toMatch(/^https:\/\/sb\.example\/.*\/ai-designer\/tenant-st\/photo-[0-9a-f]{16}\.jpg$/);
    expect(ref.imageSource).toBe('site');
  });

  it('negative control: no canvas (the old body) sizes for 3840×2160, and the same photo is refused', async () => {
    const { controller } = makeController();
    const ref: any = await controller.conciergeReferenceUrl(REQ, { url: SUPERTACO_URL } as any);
    expect(ref.imageUrl).toBeUndefined();
    expect(ref.imageSource).toBeUndefined();
    // The logo is unaffected either way.
    expect(ref.logoSource).toBe('site');
  });
});
