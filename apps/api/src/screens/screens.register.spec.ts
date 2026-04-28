/**
 * Regression tests for P0 #7: /screens/register security hardening.
 *
 * Defense 1: @Throttle({ default: { limit: 5, ttl: 3_600_000 } })  (IP-based)
 *            + per-fingerprint 15-min cooldown (in-memory Map in handler).
 * Defense 2: Unpaired token TTL = 15 min.
 *            Paired (existing.tenantId set) token TTL = 365 days.
 */

import * as jwt from 'jsonwebtoken';
import {
  ScreensController,
  _registerFpCooldown,
  REGISTER_FP_COOLDOWN_MS,
} from './screens.controller';

// Stub requireSecret so tests don't need real env vars.
jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

// Minimal Prisma mock.
const mockPrisma: any = {
  client: {
    screen: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
  },
};

const mockRedis: any = { publish: jest.fn() };
const mockSigner: any = { signMessage: jest.fn() };
const mockLicense: any = { assertSeatAvailable: jest.fn() };

let controller: ScreensController;

beforeEach(() => {
  jest.clearAllMocks();
  _registerFpCooldown.clear();
  controller = new ScreensController(mockPrisma, mockRedis, mockSigner, mockLicense);
});

// Helper: minimal Express-like request object.
const makeReq = (ip = '10.0.0.1') => ({
  ip,
  socket: { remoteAddress: ip },
  headers: {},
});

// ── Test 1: Happy-path — new device registers successfully ──────────────────
it('returns screenId and deviceToken for a brand-new fingerprint', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue(null);
  mockPrisma.client.screen.create.mockResolvedValue({
    id: 'screen-001',
    name: 'Screen-ABC',
    pairingCode: 'ABC123',
    tenantId: null,
  });

  const res = await controller.register(
    { deviceFingerprint: 'fp-happy-path-001' },
    makeReq(),
  );

  expect(res.screenId).toBe('screen-001');
  expect(typeof res.deviceToken).toBe('string');
  expect(res.paired).toBe(false);
});

// ── Test 2: Fingerprint cooldown — second call within 15 min throws 429 ──────
it('rejects a second registration of the same fingerprint within 15 minutes (HTTP 429)', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue(null);
  mockPrisma.client.screen.create.mockResolvedValue({
    id: 'screen-002',
    name: 'Screen-RTL',
    pairingCode: 'RTL456',
    tenantId: null,
  });

  const fp = 'fp-cooldown-test-002';

  // First call succeeds and sets the cooldown timestamp.
  await controller.register({ deviceFingerprint: fp }, makeReq());

  // Second immediate call must throw 429.
  await expect(
    controller.register({ deviceFingerprint: fp }, makeReq()),
  ).rejects.toMatchObject({ status: 429 });
});

// ── Test 3: Unpaired token TTL ≤ 16 minutes ──────────────────────────────────
it('mints an unpaired token with TTL ≤ 16 minutes (Defense 2)', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue(null);
  mockPrisma.client.screen.create.mockResolvedValue({
    id: 'screen-ttl-003',
    name: 'Screen-TTL',
    pairingCode: 'TTL789',
    tenantId: null,
  });

  const res = await controller.register(
    { deviceFingerprint: 'fp-ttl-test-003' },
    makeReq(),
  );

  const decoded = jwt.decode(res.deviceToken) as { iat: number; exp: number };
  expect(decoded).not.toBeNull();
  const ttlSeconds = decoded.exp - decoded.iat;
  // 15 min = 900 s; allow 1 min slack for test timing noise.
  expect(ttlSeconds).toBeLessThanOrEqual(960);
  expect(ttlSeconds).toBeGreaterThan(0);
});

// ── Test 4: Already-paired device re-registers and gets a 365-day token ──────
it('mints a 365-day token when re-registering a paired screen (Defense 2)', async () => {
  // Simulate an existing paired screen (tenantId set).
  const existingPairedScreen = {
    id: 'screen-paired-004',
    deviceFingerprint: 'fp-paired-004',
    pairingCode: null,
    tenantId: 'tenant-xyz',
    resolution: null,
    osInfo: null,
    browserInfo: null,
    userAgent: null,
    name: 'Screen-Paired',
  };
  mockPrisma.client.screen.findUnique.mockResolvedValue(existingPairedScreen);
  mockPrisma.client.screen.update.mockResolvedValue({
    id: 'screen-paired-004',
    pairingCode: null,
    tenantId: 'tenant-xyz',
    name: 'Screen-Paired',
  });

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-004' },
    makeReq(),
  );

  const decoded = jwt.decode(res.deviceToken) as { iat: number; exp: number };
  expect(decoded).not.toBeNull();
  const ttlDays = (decoded.exp - decoded.iat) / 86400;
  // Must be roughly 365 days (allow 1-day rounding slack).
  expect(ttlDays).toBeGreaterThanOrEqual(364);
});
