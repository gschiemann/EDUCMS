/**
 * Storage-layer regression test for task #223 (the Domino's SVG-rasterization
 * bug) — round 2.
 *
 * The vector-preservation LOGIC (select-vector-logo.ts) was fixed and tested
 * in `branding-adopt-vector.spec.ts` on 2026-06-27 (a0048255). But a month
 * EARLIER (2026-05-29, e9cd7a2a), `image/svg+xml` was removed from the
 * general Supabase `assets` bucket's `allowedMimeTypes` as a stored-XSS
 * hardening for the media library's presign-upload path. Nobody noticed that
 * BrandingController's logo rehost ALSO wrote to that same bucket with
 * `image/svg+xml` — so every branding SVG upload started failing server-side
 * with Supabase's "mime type not allowed" and silently fell through to the
 * raster fallback (og:image / favicon). A logo scraped as a crisp SVG
 * (Domino's) still came out rasterized/blurry on adopt, DESPITE the
 * vector-preservation logic picking the right candidate — the bug moved one
 * layer down, from "which candidate do we pick" to "can we actually store
 * what we picked."
 *
 * Fix: give branding logos their own bucket (`branding-logos`, task #223)
 * that allows image/svg+xml — safe because that bucket is written ONLY by
 * server-mediated `storage.uploadLogo()` calls (never a presigned direct
 * browser→Supabase upload), so the stored-XSS threat model the media-library
 * hardening was defending against doesn't apply here.
 *
 * These tests exercise BrandingController.adopt() / manualAdopt() end-to-end
 * (real class, mocked collaborators) and assert:
 *   1. An inline-SVG adopt calls storage.uploadLogo (the SVG-capable bucket),
 *      NEVER storage.upload (the SVG-incapable general bucket), with
 *      content-type image/svg+xml.
 *   2. The persisted TenantBranding row's logoUrl is a `.svg` path — proof
 *      the SVG source survived adopt AS an SVG, not a rasterized fallback.
 *   3. The vector-preservation fallback path (rejected/unpinned SVG behind a
 *      raster candidate) ALSO routes through uploadLogo, not upload.
 *   4. A raster-only adopt (no vector anywhere) also uses uploadLogo, staying
 *      off the general assets bucket entirely.
 *   5. The manual-adopt (`/me/manual`) pasted-SVG-URL path routes through
 *      uploadLogo too — it shares the exact same regression class.
 */

// `isomorphic-dompurify` (via sanitize-svg.ts, imported by branding.controller.ts)
// pulls in jsdom -> an ESM-only transitive dep (@exodus/bytes) that jest's
// default CJS transform can't parse — a pre-existing gap, since no spec in
// this package has imported the full controller before. Stub it with a
// lightweight passthrough that strips the handful of dangerous constructs
// our own sanitizeLogoSvg() cares about, scoped to THIS test file only (no
// global jest config change, no effect on any other suite).
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

// manualAdopt's pasted-URL branch calls the real network via safeFetch.
// Mock it so the suite stays a pure, offline unit test; each test configures
// the resolved value it needs via `safeFetchMock.mockResolvedValueOnce(...)`.
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

// A minimal, valid wordmark SVG — passes the controller's isRealSvg gate
// (>=200 chars, has a shape primitive) without tripping DOMPurify.
const VALID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100">' +
  '<path d="M10 10 H 390 V 90 H 10 Z" fill="#e8112d"/>' +
  '<rect x="20" y="20" width="60" height="60" fill="#0b6efd"/>' +
  '</svg>' +
  '<!-- padding so the 200-char minimum-length validator passes -->';

interface StorageMock {
  upload: jest.Mock;
  uploadLogo: jest.Mock;
}

function makeStorageMock(): { storage: SupabaseStorageService; mock: StorageMock } {
  const mock: StorageMock = {
    // Both resolve to a URL so callers don't throw; the tests assert on
    // WHICH one was called + with what content-type, not on URL shape.
    upload: jest.fn().mockImplementation(async (path: string) => `https://supabase.test/storage/v1/object/public/assets/${path}`),
    uploadLogo: jest.fn().mockImplementation(async (path: string) => `https://supabase.test/storage/v1/object/public/branding-logos/${path}`),
  };
  return { storage: mock as unknown as SupabaseStorageService, mock };
}

function makePrismaMock() {
  const upsert = jest.fn().mockImplementation(async ({ create, update }: any) => ({
    tenantId: 'tenant-1',
    ...create,
    ...update,
  }));
  const findUnique = jest.fn().mockResolvedValue(null);
  const auditCreate = jest.fn().mockResolvedValue({});
  const prisma = {
    client: {
      tenantBranding: { upsert, findUnique, deleteMany: jest.fn() },
      auditLog: { create: auditCreate },
      template: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
    },
  };
  return { prisma: prisma as unknown as PrismaService, upsert, findUnique, auditCreate };
}

function makeController(storage: SupabaseStorageService, prisma: PrismaService) {
  const scraper = { scrape: jest.fn() } as unknown as BrandingScraperService;
  const limiter = { check: jest.fn() } as unknown as BrandingRateLimiter;
  return new BrandingController(prisma, scraper, limiter, storage);
}

const req = { user: { tenantId: 'tenant-1', id: 'user-1' } };

afterEach(() => {
  safeFetchMock.mockReset();
});

describe('BrandingController.adopt — SVG survives adopt via the logo bucket (task #223, storage layer)', () => {
  it('routes a valid inline-SVG logo through storage.uploadLogo (never storage.upload), content-type image/svg+xml', async () => {
    const { storage, mock } = makeStorageMock();
    const { prisma, upsert } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const result = await controller.adopt(req, {
      sourceUrl: 'https://dominos.com',
      logos: [{ url: '', kind: 'svg-inline', score: 90, isSvg: true, svgInline: VALID_SVG }],
      palette: { primary: '#e8112d' },
    } as any);

    // The SVG-incapable general bucket must NEVER be used for this logo.
    expect(mock.upload).not.toHaveBeenCalled();

    // The SVG-capable branding-logos bucket gets the raw SVG + the correct
    // mime type — this is the exact call that used to be rejected by
    // Supabase's bucket policy once image/svg+xml left the general allowlist.
    expect(mock.uploadLogo).toHaveBeenCalledTimes(1);
    const [path, , contentType] = mock.uploadLogo.mock.calls[0];
    expect(contentType).toBe('image/svg+xml');
    expect(path).toMatch(/logo\.svg$/);

    // The persisted row's logoUrl must be the SVG object, not a raster.
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(result.branding.logoUrl).toMatch(/\.svg$/);
    expect(result.branding.logoSvgInline).toContain('<svg');
    expect(result.branding.logoSvgInline).toContain('<path');
  });

  it('vector-preservation fallback (raster pinned ahead of a real SVG) also routes through uploadLogo', async () => {
    const { storage, mock } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    // Operator/client pinned a raster og:image as candidate #0; the real
    // vector sits behind it. Adopt must still find + preserve the vector
    // (select-vector-logo.ts), and the rehost of that vector must go to the
    // SVG-capable bucket.
    const result = await controller.adopt(req, {
      sourceUrl: 'https://dominos.com',
      logos: [
        { url: 'https://dominos.com/og-image.png', kind: 'og', score: 60, isSvg: false },
        { url: '', kind: 'svg-inline', score: 90, isSvg: true, svgInline: VALID_SVG },
      ],
      logoOverride: { url: 'https://dominos.com/og-image.png' }, // client pinned the raster
      palette: { primary: '#e8112d' },
    } as any);

    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.uploadLogo).toHaveBeenCalledTimes(1);
    const [, , contentType] = mock.uploadLogo.mock.calls[0];
    expect(contentType).toBe('image/svg+xml');
    expect(result.branding.logoUrl).toMatch(/\.svg$/);
  });

  it('a raster-only adopt (no vector candidate anywhere) still uses uploadLogo, staying off the general assets bucket', async () => {
    const { storage, mock } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    safeFetchMock.mockResolvedValueOnce({
      status: 200,
      body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), // PNG magic bytes
      contentType: 'image/png',
      finalUrl: 'https://example.com/logo.png',
    });

    const result = await controller.adopt(req, {
      sourceUrl: 'https://example.com',
      logos: [{ url: 'https://example.com/logo.png', kind: 'img-logo', score: 60, isSvg: false }],
      palette: { primary: '#123456' },
    } as any);

    // Even the raster fallback should live in the branding-logos bucket now
    // (small, server-mediated, no reason to split raster vs vector storage).
    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.uploadLogo).toHaveBeenCalled();
    const [, , contentType] = mock.uploadLogo.mock.calls[0];
    expect(contentType).toBe('image/png');
    expect(result.branding.logoUrl).toMatch(/logo/);
  });
});

describe('BrandingController.manualAdopt — pasted SVG URL also routes through uploadLogo', () => {
  it('rehosts a pasted .svg URL through uploadLogo, not the general assets bucket', async () => {
    const { storage, mock } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    safeFetchMock.mockResolvedValueOnce({
      status: 200,
      body: Buffer.from(VALID_SVG, 'utf-8'),
      contentType: 'image/svg+xml',
      finalUrl: 'https://example.com/logo.svg',
    });

    await controller.manualAdopt(req, {
      displayName: 'Example Co',
      primaryHex: '#123456',
      logoUrl: 'https://example.com/logo.svg',
    });

    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.uploadLogo).toHaveBeenCalledTimes(1);
    const [path, , contentType] = mock.uploadLogo.mock.calls[0];
    expect(contentType).toBe('image/svg+xml');
    expect(path).toMatch(/\.svg$/);
  });

  it('rehosts an uploaded SVG data URL through uploadLogo, not the general assets bucket', async () => {
    const { storage, mock } = makeStorageMock();
    const { prisma } = makePrismaMock();
    const controller = makeController(storage, prisma);

    const dataUrl = `data:image/svg+xml;base64,${Buffer.from(VALID_SVG, 'utf-8').toString('base64')}`;

    await controller.manualAdopt(req, {
      displayName: 'Example Co',
      primaryHex: '#123456',
      logoDataUrl: dataUrl,
    });

    expect(mock.upload).not.toHaveBeenCalled();
    expect(mock.uploadLogo).toHaveBeenCalledTimes(1);
    const [path, , contentType] = mock.uploadLogo.mock.calls[0];
    expect(contentType).toBe('image/svg+xml');
    expect(path).toMatch(/\.svg$/);
  });
});
