/**
 * THE APPLIED-vs-SELECTED REGRESSION SUITE (2026-08-25).
 *
 * Operator report, with a screenshot I inspected: the branding wizard listed
 * 8 logo candidates and the CHECKED one was the real brand mark (a colored
 * lotus) — but the app's sidebar avatar, i.e. the ALREADY-APPLIED tenant
 * logo, was **Pinterest's** circular P.
 *
 * The verdict was (b): a real bug in the adopt path, and there were TWO of
 * them, both in `BrandingController.adopt`:
 *
 *   1. FIELD-WISE `??` FALL-THROUGH.
 *        const chosenLogo = body.logoOverride?.url       ?? body.logos?.[0]?.url;
 *        let   chosenSvg  = body.logoOverride?.svgInline ?? body.logos?.[0]?.svgInline;
 *      Those are two INDEPENDENT fallbacks. The wizard sends the operator's
 *      pick as `logoOverride` AND the whole score-sorted candidate list as
 *      `logos`. Pin a RASTER candidate — which has no `svgInline` — and
 *      `chosenSvg` silently fell through to candidate #0's inline SVG, a
 *      completely different mark. The inline-SVG branch runs FIRST and wins,
 *      so the pinned mark never got a chance.
 *
 *   2. THE VECTOR SCAN OUT-VOTED THE PIN.
 *      `pickVectorLogoCandidate(body.logos)` scans EVERY candidate for an
 *      inline SVG or a `.svg` URL, in score order, and ran BEFORE the pinned
 *      raster was tried. With any third-party `.svg` in the list, pinning
 *      the real mark still stored the other one.
 *
 * The fix: a pin is ONE candidate (both fields, or neither), and an explicit
 * pin is honored before the cross-candidate vector scan — which stays as the
 * FALLBACK, preserving the Domino's vector-preservation recovery (task #223).
 */

// Same jsdom-free DOMPurify stub the sibling storage suite uses — isomorphic
// -dompurify pulls an ESM-only transitive dep jest's CJS transform can't parse.
jest.mock('isomorphic-dompurify', () => ({
  __esModule: true,
  default: {
    sanitize: (raw: string) =>
      String(raw)
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/\son\w+="[^"]*"/gi, '')
        .replace(/\son\w+='[^']*'/gi, '')
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, ''),
  },
}));

const safeFetchMock = jest.fn();
jest.mock('./safe-fetch', () => ({
  ...jest.requireActual('./safe-fetch'),
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

import { BrandingController } from './branding.controller';
import type { PrismaService } from '../prisma/prisma.service';
import type { BrandingScraperService } from './branding-scraper.service';
import type { BrandingRateLimiter } from './branding-rate-limiter';
import type { SupabaseStorageService } from '../storage/supabase-storage.service';

/** A DIFFERENT mark from the one the operator pins — stands in for the
 *  Pinterest glyph that kept winning. Padded past the 200-char isRealSvg floor. */
const OTHER_MARK_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" data-mark="not-the-one-they-picked">' +
  '<circle cx="32" cy="32" r="30" fill="#e60023"/>' +
  '<path d="M20 44 L32 12 L44 44 Z" fill="#ffffff"/>' +
  '</svg>' +
  '<!-- padding so the 200-char minimum-length validator passes, twice over -->';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

function makeStorageMock() {
  const mock = {
    upload: jest.fn(async (path: string) => `https://sb.test/assets/${path}`),
    uploadLogo: jest.fn(async (path: string) => `https://sb.test/branding-logos/${path}`),
  };
  return { storage: mock as unknown as SupabaseStorageService, mock };
}

function makePrismaMock(existingPalette?: unknown) {
  const upsert = jest.fn(async ({ create, update }: any) => ({ tenantId: 'tenant-1', ...create, ...update }));
  const findUnique = jest.fn(async () => (existingPalette ? { palette: existingPalette } : null));
  const prisma = {
    client: {
      tenantBranding: { upsert, findUnique, deleteMany: jest.fn() },
      auditLog: { create: jest.fn(async () => ({})) },
      template: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    },
  };
  return { prisma: prisma as unknown as PrismaService, upsert, findUnique };
}

function makeController(storage: SupabaseStorageService, prisma: PrismaService) {
  const scraper = { scrape: jest.fn() } as unknown as BrandingScraperService;
  const limiter = { check: jest.fn() } as unknown as BrandingRateLimiter;
  return new BrandingController(prisma, scraper, limiter, storage);
}

/** Make every raster fetch succeed with real PNG magic bytes. */
function mockRasterFetchOk() {
  safeFetchMock.mockImplementation(async (url: string) => ({
    status: 200,
    body: PNG_BYTES,
    contentType: 'image/png',
    finalUrl: url,
  }));
}

const req = { user: { tenantId: 'tenant-1', id: 'user-1' } };

afterEach(() => {
  safeFetchMock.mockReset();
});

describe('adopt — BUG 1: a pinned raster must not inherit candidate #0\'s inline SVG', () => {
  it('stores the PINNED lotus, not the inline SVG sitting at candidate #0', async () => {
    mockRasterFetchOk();
    const { storage, mock } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const result = await controller.adopt(req, {
      sourceUrl: 'https://acmelotus.com',
      logos: [
        // Candidate #0 — a DIFFERENT mark, carrying an inline SVG.
        { url: '', kind: 'svg-inline', score: 95, isSvg: true, svgInline: OTHER_MARK_SVG },
        // Candidate #1 — the real brand mark, a raster. THIS is what the
        // operator checked in the wizard.
        { url: 'https://acmelotus.com/img/lotus-mark.png', kind: 'img-logo', score: 70 },
      ],
      // The wizard sends the pick as logoOverride; a raster pick has no
      // svgInline, which is exactly what used to trigger the fall-through.
      logoOverride: { url: 'https://acmelotus.com/img/lotus-mark.png' },
      palette: { primary: '#c2185b' },
    } as any);

    // THE ASSERTION THAT WOULD HAVE CAUGHT THE OPERATOR'S BUG:
    // nothing from the OTHER mark may be persisted.
    expect(result.branding.logoSvgInline ?? null).toBeNull();
    expect(result.branding.logoUrl).not.toMatch(/\.svg$/);
    // …and the stored object came from the pinned raster's bytes.
    expect(mock.uploadLogo).toHaveBeenCalledTimes(1);
    expect(safeFetchMock).toHaveBeenCalledWith(
      'https://acmelotus.com/img/lotus-mark.png',
      expect.anything(),
    );
  });

  it('still stores the pinned INLINE SVG when the operator pins a vector', async () => {
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const PINNED_SVG = OTHER_MARK_SVG.replace('not-the-one-they-picked', 'the-pinned-one');
    const result = await controller.adopt(req, {
      sourceUrl: 'https://acmelotus.com',
      logos: [
        { url: 'https://acmelotus.com/other.png', kind: 'img-logo', score: 95 },
        { url: '', kind: 'svg-inline', score: 70, isSvg: true, svgInline: PINNED_SVG },
      ],
      logoOverride: { url: '', svgInline: PINNED_SVG },
      palette: { primary: '#c2185b' },
    } as any);

    expect(result.branding.logoSvgInline).toContain('the-pinned-one');
    expect(result.branding.logoUrl).toMatch(/\.svg$/);
  });
});

describe('adopt — BUG 2: the cross-candidate vector scan must not out-vote a pin', () => {
  it('honors a pinned raster even when a foreign `.svg` sits higher in the list', async () => {
    mockRasterFetchOk();
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const result = await controller.adopt(req, {
      sourceUrl: 'https://acmelotus.com',
      logos: [
        // A `.svg` the vector scan used to grab unconditionally.
        { url: 'https://cdn.example.com/social/pinterest-badge.svg', kind: 'img-logo', score: 99, isSvg: true },
        { url: 'https://acmelotus.com/img/lotus-mark.png', kind: 'img-logo', score: 70 },
      ],
      logoOverride: { url: 'https://acmelotus.com/img/lotus-mark.png' },
      palette: { primary: '#c2185b' },
    } as any);

    expect(result.branding.logoUrl).toContain('/branding-logos/');
    expect(result.branding.logoUrl).not.toMatch(/\.svg$/);
    // The foreign vector was never even fetched.
    expect(safeFetchMock).toHaveBeenCalledTimes(1);
    expect(safeFetchMock).toHaveBeenCalledWith('https://acmelotus.com/img/lotus-mark.png', expect.anything());
  });

  it('WITH NO PIN, the vector-first order is preserved (Domino\'s task #223 unchanged)', async () => {
    const { storage, mock } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    // No logoOverride at all — the template-adopt path, and "adopt what you
    // found". A raster leads the list; the vector behind it must still win.
    const result = await controller.adopt(req, {
      sourceUrl: 'https://dominos.com',
      logos: [
        { url: 'https://dominos.com/og-image.png', kind: 'og', score: 60 },
        { url: '', kind: 'svg-inline', score: 55, isSvg: true, svgInline: OTHER_MARK_SVG },
      ],
      palette: { primary: '#e8112d' },
    } as any);

    expect(result.branding.logoUrl).toMatch(/\.svg$/);
    expect(mock.uploadLogo).toHaveBeenCalledTimes(1);
  });

  it('falls back to the vector scan when the PIN cannot be rehosted (recovery preserved)', async () => {
    // Cloudflare-style block on the pinned URL.
    safeFetchMock.mockResolvedValue({ status: 403, body: Buffer.from('nope'), contentType: 'text/html', finalUrl: 'x' });
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const result = await controller.adopt(req, {
      sourceUrl: 'https://acmelotus.com',
      logos: [
        { url: 'https://acmelotus.com/blocked.png', kind: 'img-logo', score: 90 },
        { url: '', kind: 'svg-inline', score: 55, isSvg: true, svgInline: OTHER_MARK_SVG },
      ],
      logoOverride: { url: 'https://acmelotus.com/blocked.png' },
      palette: { primary: '#c2185b' },
    } as any);

    // The operator still ends up with a working logo rather than none.
    expect(result.branding.logoUrl).toMatch(/\.svg$/);
  });

  it('an uploaded file still beats every scraped candidate AND the pin', async () => {
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const result = await controller.adopt(req, {
      sourceUrl: 'https://acmelotus.com',
      logos: [{ url: '', kind: 'svg-inline', score: 99, isSvg: true, svgInline: OTHER_MARK_SVG }],
      logoOverride: { url: 'https://acmelotus.com/lotus.png' },
      logoDataUrl: `data:image/png;base64,${PNG_BYTES.toString('base64')}`,
      palette: { primary: '#c2185b' },
    } as any);

    expect(result.branding.logoUrl).toMatch(/\.png$/);
    expect(result.branding.logoSvgInline ?? null).toBeNull();
    expect(safeFetchMock).not.toHaveBeenCalled();
  });
});

describe('adopt — the logo BACKGROUND persists inside the palette Json (no migration)', () => {
  it('stores a valid choice', async () => {
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const result = await controller.adopt(req, {
      sourceUrl: 'https://acmelotus.com',
      logos: [],
      palette: { primary: '#c2185b', logoBackground: 'white' },
    } as any);

    expect((result.branding.palette as any).logoBackground).toBe('white');
  });

  it('accepts it at the top level too (what the wizard sends alongside the palette)', async () => {
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const result = await controller.adopt(req, {
      sourceUrl: 'https://acmelotus.com',
      logos: [],
      palette: { primary: '#c2185b' },
      logoBackground: 'dark',
    } as any);

    expect((result.branding.palette as any).logoBackground).toBe('dark');
  });

  it('DROPS an invalid value — the adopt body is an untrusted client round-trip', async () => {
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const result = await controller.adopt(req, {
      sourceUrl: 'https://acmelotus.com',
      logos: [],
      palette: { primary: '#c2185b', logoBackground: 'url(javascript:alert(1))' },
    } as any);

    expect((result.branding.palette as any).logoBackground).toBeUndefined();
  });

  it('does not disturb the WCAG contrast contract', async () => {
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    // A pale yellow primary is the classic sub-AA case the contrast
    // enforcement exists for; adding the backdrop key must not change it.
    const result = await controller.adopt(req, {
      sourceUrl: 'https://acmelotus.com',
      logos: [],
      palette: { primary: '#ffe082', logoBackground: 'tile' },
    } as any);

    const p = result.branding.palette as any;
    expect(p.logoBackground).toBe('tile');
    expect(p.contrastReport).toBeTruthy();
    expect(Array.isArray(p.contrastReport.adjustments)).toBe(true);
    expect(p.primaryInk).toBeTruthy();
    expect(p.primaryStrong).toBeTruthy(); // VisionCore workhorse shades intact
  });
});

describe('manualAdopt — a color tweak must not wipe the logo-background choice', () => {
  it('carries the stored choice forward', async () => {
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock({ logoBackground: 'dark', primary: '#c2185b' });
    const controller = makeController(storage, prisma);

    const result: any = await controller.manualAdopt(req, { primaryHex: '#0f2d52' } as any);
    expect(result.branding.palette.logoBackground).toBe('dark');
  });

  it('an explicit new choice in the request wins over the stored one', async () => {
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock({ logoBackground: 'dark' });
    const controller = makeController(storage, prisma);

    const result: any = await controller.manualAdopt(req, { primaryHex: '#0f2d52', logoBackground: 'white' } as any);
    expect(result.branding.palette.logoBackground).toBe('white');
  });

  it('leaves the key absent when nothing was ever chosen', async () => {
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const result: any = await controller.manualAdopt(req, { primaryHex: '#0f2d52' } as any);
    expect(result.branding.palette.logoBackground).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────
describe('adopt — a logo it could not fetch must NOT be reported as success', () => {
  // Greg, 2026-09-16, four times: "still wont replace the fucking logo".
  //
  // The Railway logs for every one of his adopts read, identically:
  //   [adopt] ... overrideUrl=https://cdn.nba.com/... logos.count=1 chosenSvgLen=0
  //   [adopt] pinned logo rehost failed ...: Fetch timed out
  //   Primary logo rehost failed ...: Fetch timed out
  //   [adopt] preserving existing logoUrl ...
  //   RequestLog ... "status":"SUCCESS"
  //
  // He picked the right mark; the wizard sent it; the fetch died inside our
  // SSRF-pinned request; we kept the OLD file and answered SUCCESS. The server
  // knew exactly what happened and the operator could not. Preserving is the
  // right BEHAVIOUR — silence was the bug.
  it('preserves the old logo AND says why', async () => {
    // The fetch fails the way it failed in production.
    safeFetchMock.mockImplementation(async () => {
      throw new Error('Fetch timed out');
    });

    const { storage, mock } = makeStorageMock();
    const { prisma } = makePrismaMock();
    // The preserve branch reads logoUrl/logoSvgInline, which the shared mock
    // does not return — give it a tenant that already HAS a logo.
    (prisma as any).client.tenantBranding.findUnique = jest.fn(async () => ({
      palette: null,
      logoUrl: 'https://sb.test/branding-logos/branding/tenant-1/logo-upload-deadbeef.svg',
      logoSvgInline: null,
    }));

    const controller = makeController(storage, prisma);
    const result = await controller.adopt(req, {
      sourceUrl: 'https://www.nba.com/kings/',
      logos: [{ url: 'https://cdn.nba.com/teams/uploads/Kings-Primary.png', kind: 'img-logo', score: 80 }],
      logoOverride: { url: 'https://cdn.nba.com/teams/uploads/Kings-Primary.png' },
      palette: { primary: '#7d298e' },
    } as any);

    // 1. The old logo survives — losing it would be worse than keeping it.
    expect(result.branding.logoUrl).toContain('logo-upload-deadbeef.svg');
    expect(mock.uploadLogo).not.toHaveBeenCalled();

    // 2. THE ASSERTION THAT WOULD HAVE CAUGHT GREG'S BUG. Without this the
    //    call above is indistinguishable from a successful replacement.
    expect(result.logoWarning).toBeTruthy();
    expect(String(result.logoWarning)).toMatch(/could not fetch/i);
  });

  it('says nothing when the logo really was replaced', async () => {
    mockRasterFetchOk();
    const { storage } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const result = await controller.adopt(req, {
      sourceUrl: 'https://acmelotus.com',
      logos: [{ url: 'https://acmelotus.com/img/lotus-mark.png', kind: 'img-logo', score: 80 }],
      logoOverride: { url: 'https://acmelotus.com/img/lotus-mark.png' },
      palette: { primary: '#c2185b' },
    } as any);

    expect(result.branding.logoUrl).toContain('sb.test');
    expect(result.logoWarning ?? null).toBeNull();
  });
});
