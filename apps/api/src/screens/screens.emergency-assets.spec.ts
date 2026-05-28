/**
 * Regression tests for GET /screens/:id/emergency-assets — cache-hash
 * correctness (P0-1, 2026-05-28).
 *
 * The bug: the endpoint shipped the service worker a SHA-256 computed from
 * the asset URL STRING, not the file body. The SW (sw-player.js
 * `fetchAndStore`) recomputes the digest from the downloaded bytes and
 * refuses to cache on mismatch — and a URL-derived hash can NEVER equal the
 * body's real SHA-256. So:
 *   - per-screen emergency assets (Sprint 8b scoped media) UNCONDITIONALLY
 *     synthesized `${url}:screen-emergency` → never cached.
 *   - playlist assets with Asset.fileHash=null synthesized
 *     `${url}:${fileSize}` → never cached.
 * Both degraded the screen to text-only AND re-attempted the full precache
 * every 5 min forever (the set-hash never committed).
 *
 * The fix: ship the real Asset.fileHash, or `sha256: null` when genuinely
 * unhashed (the SW then skips integrity verification rather than rejecting a
 * fabricated hash). NEVER a URL-derived digest.
 *
 * These tests assert the endpoint NEVER emits a synthesized hash and always
 * emits either the real fileHash or null.
 */

import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { ScreensController } from './screens.controller';

// Stub requireSecret so tests don't need real env vars (matches the device
// JWT secret the controller verifies device tokens against).
jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

// Audit logging is debounced through manifest-hot-cache helpers; force the
// write path off so the test doesn't touch the (mocked) auditLog.create.
jest.mock('./manifest-hot-cache', () => {
  const actual = jest.requireActual('./manifest-hot-cache');
  return {
    ...actual,
    shouldSkipEmergencyAudit: () => true, // skip the audit write in tests
    markEmergencyAuditWritten: () => undefined,
  };
});

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';

function deviceToken(screenId: string): string {
  return jwt.sign({ sub: screenId, kind: 'device', fp: 'fp-test' }, DEVICE_JWT_SECRET, {
    expiresIn: '365d',
  });
}

function makeReq(screenId: string) {
  return {
    headers: { authorization: `Bearer ${deviceToken(screenId)}` },
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
  } as any;
}

const mockPrisma: any = {
  client: {
    screen: { findUnique: jest.fn() },
    playlist: { findMany: jest.fn() },
    asset: { findMany: jest.fn() },
    auditLog: { create: jest.fn() },
  },
};
const mockRedis: any = { publish: jest.fn() };
const mockSigner: any = { signMessage: jest.fn() };
const mockLicense: any = { assertSeatAvailable: jest.fn() };
const mockStripe: any = {};

let controller: ScreensController;

// A screen row with NO per-screen asset URLs and NO playlist pointers by
// default; individual tests fill in what they exercise. The select in the
// controller pulls ~36 nullable columns — default them all to null via a Proxy
// so we don't have to enumerate every one.
function screenRow(overrides: Record<string, any> = {}) {
  const base: Record<string, any> = { tenantId: 'tenant-1', tenant: { id: 'tenant-1' } };
  return new Proxy(
    { ...base, ...overrides },
    {
      get(target, prop: string) {
        if (prop in target) return (target as any)[prop];
        // Unknown emergency*PlaylistId / emergency*AssetUrl columns → null.
        return null;
      },
      has() {
        return true;
      },
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockPrisma.client.playlist.findMany.mockResolvedValue([]);
  mockPrisma.client.asset.findMany.mockResolvedValue([]);
  mockPrisma.client.auditLog.create.mockResolvedValue({});
  controller = new ScreensController(mockPrisma, mockRedis, mockSigner, mockLicense, mockStripe);
});

// Helper: the forbidden synthesized hashes the old code produced.
function urlDerivedPlaylistHash(url: string, size: number) {
  return crypto.createHash('sha256').update(`${url}:${size}`).digest('hex');
}
function urlDerivedScreenHash(url: string) {
  return crypto.createHash('sha256').update(`${url}:screen-emergency`).digest('hex');
}

it('ships the real Asset.fileHash for playlist emergency assets (never URL-derived)', async () => {
  const realHash = 'a'.repeat(64);
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    screenRow({ emergencyLockdownPlaylistId: 'pl-1' }),
  );
  mockPrisma.client.playlist.findMany.mockResolvedValue([
    {
      id: 'pl-1',
      items: [
        {
          asset: {
            fileUrl: 'https://cdn.example.com/lockdown.mp4',
            fileSize: 12345,
            mimeType: 'video/mp4',
            fileHash: realHash,
          },
        },
      ],
    },
  ]);

  const res = await controller.getEmergencyAssets('screen-1', makeReq('screen-1'));

  expect(res.assets).toHaveLength(1);
  expect(res.assets[0].sha256).toBe(realHash);
  // Must NOT be the old synthesized digest.
  expect(res.assets[0].sha256).not.toBe(
    urlDerivedPlaylistHash('https://cdn.example.com/lockdown.mp4', 12345),
  );
});

it('ships sha256: null (not a synthesized hash) for a playlist asset with fileHash=null', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    screenRow({ emergencyLockdownPlaylistId: 'pl-1' }),
  );
  mockPrisma.client.playlist.findMany.mockResolvedValue([
    {
      id: 'pl-1',
      items: [
        {
          asset: {
            fileUrl: 'https://cdn.example.com/legacy.jpg',
            fileSize: 999,
            mimeType: 'image/jpeg',
            fileHash: null,
          },
        },
      ],
    },
  ]);

  const res = await controller.getEmergencyAssets('screen-1', makeReq('screen-1'));

  expect(res.assets).toHaveLength(1);
  expect(res.assets[0].sha256).toBeNull();
  // The old bug emitted this; assert it's gone.
  expect(res.assets[0].sha256).not.toBe(
    urlDerivedPlaylistHash('https://cdn.example.com/legacy.jpg', 999),
  );
});

it('per-screen emergency asset URL: ships the owning Asset.fileHash, never a `:screen-emergency` digest', async () => {
  const realHash = 'b'.repeat(64);
  const url = 'https://cdn.example.com/north-exit-evacuate.png';
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    screenRow({ emergencyEvacuateAssetUrl: url }),
  );
  // The per-screen URL maps to a managed Asset row with a real body hash.
  mockPrisma.client.asset.findMany.mockResolvedValue([{ fileUrl: url, fileHash: realHash, fileSize: 4444 }]);

  const res = await controller.getEmergencyAssets('screen-1', makeReq('screen-1'));

  // findMany was called with the per-screen URL in the `in` filter.
  expect(mockPrisma.client.asset.findMany).toHaveBeenCalledTimes(1);
  const arg = mockPrisma.client.asset.findMany.mock.calls[0][0];
  expect(arg.where.fileUrl.in).toContain(url);

  expect(res.assets).toHaveLength(1);
  expect(res.assets[0].url).toBe(url);
  expect(res.assets[0].sha256).toBe(realHash);
  // The exact old bug — unconditional `${url}:screen-emergency`.
  expect(res.assets[0].sha256).not.toBe(urlDerivedScreenHash(url));
});

it('per-screen emergency asset URL with no managed Asset row → sha256: null (SW skips verify)', async () => {
  const url = 'https://external.example.org/manual-evacuate.png';
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    screenRow({ emergencyWeatherAssetUrl: url }),
  );
  // No matching Asset row.
  mockPrisma.client.asset.findMany.mockResolvedValue([]);

  const res = await controller.getEmergencyAssets('screen-1', makeReq('screen-1'));

  expect(res.assets).toHaveLength(1);
  expect(res.assets[0].sha256).toBeNull();
  expect(res.assets[0].sha256).not.toBe(urlDerivedScreenHash(url));
});

it('global invariant: no asset ever carries a synthesized hash; every sha256 is a real fileHash or null', async () => {
  const realPlaylistHash = 'c'.repeat(64);
  const realScreenHash = 'd'.repeat(64);
  const plUrl = 'https://cdn.example.com/lockdown-default.mp4';
  const screenUrl = 'https://cdn.example.com/screen-evacuate.png';
  const nullScreenUrl = 'https://cdn.example.com/screen-weather-unhashed.png';

  mockPrisma.client.screen.findUnique.mockResolvedValue(
    screenRow({
      emergencyLockdownPlaylistId: 'pl-1',
      emergencyEvacuateAssetUrl: screenUrl,
      emergencyWeatherAssetUrl: nullScreenUrl,
    }),
  );
  mockPrisma.client.playlist.findMany.mockResolvedValue([
    {
      id: 'pl-1',
      items: [
        { asset: { fileUrl: plUrl, fileSize: 1000, mimeType: 'video/mp4', fileHash: realPlaylistHash } },
        { asset: { fileUrl: 'https://cdn.example.com/nullhash.jpg', fileSize: 2000, mimeType: 'image/jpeg', fileHash: null } },
      ],
    },
  ]);
  mockPrisma.client.asset.findMany.mockResolvedValue([
    { fileUrl: screenUrl, fileHash: realScreenHash, fileSize: 3000 },
    // nullScreenUrl intentionally absent → null
  ]);

  const res = await controller.getEmergencyAssets('screen-1', makeReq('screen-1'));

  const forbidden = new Set<string>();
  for (const a of res.assets) {
    forbidden.add(urlDerivedScreenHash(a.url));
    forbidden.add(urlDerivedPlaylistHash(a.url, a.size));
  }
  for (const a of res.assets) {
    // sha256 is either a real 64-hex hash or null — and never a synthesized one.
    if (a.sha256 !== null) {
      expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(forbidden.has(a.sha256 as string)).toBe(false);
  }
  // Spot-check the specific expected values.
  const byUrl = Object.fromEntries(res.assets.map((a) => [a.url, a.sha256]));
  expect(byUrl[plUrl]).toBe(realPlaylistHash);
  expect(byUrl[screenUrl]).toBe(realScreenHash);
  expect(byUrl[nullScreenUrl]).toBeNull();
  expect(byUrl['https://cdn.example.com/nullhash.jpg']).toBeNull();
});

it('401s without a device JWT (auth unchanged)', async () => {
  await expect(
    controller.getEmergencyAssets('screen-1', { headers: {} } as any),
  ).rejects.toThrow(/Device auth required/);
});
