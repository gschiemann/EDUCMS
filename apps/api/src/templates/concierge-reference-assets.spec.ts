/**
 * POST /templates/concierge/reference/url — the reference's logo, photo and
 * palette are CHECKED and COPIED to our storage before the Designer sees them
 * (2026-09-22, the Super Taco boards).
 *
 * The scrape is the REAL BrandingScraperService over the committed, trimmed
 * supertacomex.com homepage; every image is a synthetic stand-in served by
 * test/supertaco-site.ts through the mocked safeFetch. The bucket is in memory.
 */
const safeFetchMock = jest.fn();
jest.mock('../branding/safe-fetch', () => ({
  ...jest.requireActual<object>('../branding/safe-fetch'),
  safeFetch: (...args: unknown[]): unknown => safeFetchMock(...args),
}));

import type { ConciergeReference } from '@cms/api-types';
import { TemplatesController } from './templates.controller';
import { BrandingScraperService } from '../branding/branding-scraper.service';
import {
  supertacoSite,
  isOrangeRed,
  photoJpeg,
  SUPERTACO_URL,
  SUPERTACO_MEDIA,
} from '../../test/supertaco-site';

jest.setTimeout(30_000);

type Reference = ConciergeReference & { imageSource?: string };

interface Bucket {
  upload: (path: string, buf: Buffer, contentType: string) => Promise<string>;
  uploads: Array<{ path: string; buf: Buffer; contentType: string }>;
}

function bucket(opts: { fail?: boolean } = {}): Bucket {
  const uploads: Bucket['uploads'] = [];
  return {
    uploads,
    upload: (path, buf, contentType) => {
      if (opts.fail) return Promise.reject(new Error('storage down'));
      uploads.push({ path, buf, contentType });
      return Promise.resolve(
        `https://sb.example/storage/v1/object/public/assets/${path}`,
      );
    },
  };
}

function makeController(storage: Bucket): TemplatesController {
  const controller = Object.create(
    TemplatesController.prototype,
  ) as TemplatesController;
  Object.assign(controller, {
    brandingScraper: new BrandingScraperService(),
    ai: { extractSiteMenu: () => Promise.resolve(null) },
    storage,
    stockImages: {
      isConfigured: () => false,
      search: () => Promise.resolve(null),
    },
    auditLogger: { warn: () => undefined, log: () => undefined },
  });
  return controller;
}

async function reference(
  controller: TemplatesController,
  url: string,
): Promise<Reference> {
  const req = {
    user: { tenantId: 'tenant-st', id: 'u1', role: 'SCHOOL_ADMIN' },
  };
  return (await controller.conciergeReferenceUrl(req, { url })) as Reference;
}

describe('POST concierge/reference/url — checked, copied assets', () => {
  let site: Awaited<ReturnType<typeof supertacoSite>>;

  beforeEach(async () => {
    site = await supertacoSite();
    safeFetchMock.mockImplementation(site.fetch);
  });

  afterEach(() => safeFetchMock.mockReset());

  it("hands the Designer OUR copies of the real logo and hero, and the logo's orange palette", async () => {
    const b = bucket();
    const ref = await reference(makeController(b), SUPERTACO_URL);

    expect(ref.logoUrl).toMatch(
      /^https:\/\/sb\.example\/.*\/ai-designer\/tenant-st\/logo-[0-9a-f]{16}\.png$/,
    );
    expect(ref.imageUrl).toMatch(
      /^https:\/\/sb\.example\/.*\/ai-designer\/tenant-st\/photo-[0-9a-f]{16}\.jpg$/,
    );
    expect(ref.imageSource).toBe('site');
    expect(isOrangeRed(ref.palette![0])).toBe(true);
    expect(b.uploads.map((u) => u.contentType).sort()).toEqual([
      'image/jpeg',
      'image/png',
    ]);

    // Only the real logo's original and the hero's original were fetched for
    // the board — never the food-photo icon's original, the badge, or a blur.
    const boardFetches = site.calls.filter(
      (u) => !/\/v1\//.test(u) && u !== SUPERTACO_URL,
    );
    expect(boardFetches.sort()).toEqual(
      [
        `https://static.wixstatic.com/media/${SUPERTACO_MEDIA.hero}~mv2.jpg`,
        `https://static.wixstatic.com/media/${SUPERTACO_MEDIA.logo}~mv2.png`,
      ].sort(),
    );
    expect(site.calls.some((u) => /blur_\d/.test(u))).toBe(false);

    expect(ref.summary).toContain('checked');
    expect(ref.summary).not.toMatch(/verified/i);
    expect(ref.summary).not.toContain('[object Object]');
  });

  it('never hotlinks: when our storage is down, the reference carries NO image URL', async () => {
    const ref = await reference(
      makeController(bucket({ fail: true })),
      SUPERTACO_URL,
    );
    expect(ref.logoUrl).toBeUndefined();
    expect(ref.imageUrl).toBeUndefined();
    expect(ref.summary).toContain('no usable logo image could be prepared');
    // The brand facts still arrive.
    expect(ref.summary).toContain('Brand: Super Taco.');
  });
});

describe('rehostStockUrl — the stock-photo re-host, now shared', () => {
  afterEach(() => safeFetchMock.mockReset());

  it('still stores a Pexels photo byte-for-byte at ai-stock/<tenant>/<hash16>.<ext>', async () => {
    const body = await photoJpeg(400, 300, 5);
    const src = 'https://images.pexels.com/photos/1/pexels-photo-1.jpeg?w=940';
    safeFetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        status: 200,
        body,
        contentType: 'image/jpeg',
        finalUrl: url,
      }),
    );
    const b = bucket();
    const controller = makeController(b) as unknown as {
      rehostStockUrl: (
        tenantId: string,
        url: string,
      ) => Promise<string | undefined>;
    };
    const url = await controller.rehostStockUrl('tenant-st', src);
    expect(url).toMatch(/\/ai-stock\/tenant-st\/[0-9a-f]{16}\.jpg$/);
    expect(safeFetchMock).toHaveBeenCalledWith(src, {
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 8000,
    });
    expect(b.uploads[0].buf.equals(body)).toBe(true);
  });
});
