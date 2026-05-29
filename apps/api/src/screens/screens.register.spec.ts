/**
 * Regression tests for /screens/register security hardening.
 *
 * P0 #7 defenses (Round 1 — still present):
 *   Defense 1: @Throttle 5/hr per IP + per-fingerprint 15-min cooldown.
 *   Defense 2: Unpaired token TTL = 15 min.
 *
 * P0 #5 defenses (Round 2 — graduated trust for paired re-registration):
 *   Defense 1: Paired re-registration requires proof of prior device JWT
 *              (priorDeviceToken) to mint a full 365-day token.
 *   Feature flag: STRICT_REPAIR_AUTH=true → enforce; false/unset → legacy
 *              compat (365d issued even without priorDeviceToken so existing
 *              kiosks ≤ v1.0.33 keep working until fleet update).
 *
 * Tests (5 new P0 #5 cases + 4 existing P0 #7 cases retained):
 *  1. Paired screen with valid priorDeviceToken → 365-day token
 *  2. Paired screen WITHOUT priorDeviceToken + STRICT_REPAIR_AUTH=true → 1h + requiresRePair
 *  3. Paired screen with INVALID priorDeviceToken (different screenId) → 401
 *  4. Paired screen with EXPIRED priorDeviceToken → 1-hour fallback (no hard reject)
 *  5. Unpaired screen path (Round 1 fix) → 15-min token  [carried over]
 *  6. Brand-new fingerprint → screenId + short token
 *  7. Per-fingerprint cooldown → 429
 *  8. Unpaired token TTL ≤ 16 min
 *  9. STRICT_REPAIR_AUTH=false (default) + absent priorDeviceToken → legacy 365d
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

const TEST_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';

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
  // Default: STRICT_REPAIR_AUTH off (legacy compat mode).
  delete process.env.STRICT_REPAIR_AUTH;
  controller = new ScreensController(mockPrisma, mockRedis, mockSigner, mockLicense, {} as any, {} as any);
});

afterEach(() => {
  delete process.env.STRICT_REPAIR_AUTH;
});

// Helper: minimal Express-like request object.
const makeReq = (ip = '10.0.0.1') => ({
  ip,
  socket: { remoteAddress: ip },
  headers: {},
});

// Helper: mint a real JWT as if the API had previously issued it.
function mintTestToken(screenId: string, expiresIn: string = '365d'): string {
  return jwt.sign(
    { sub: screenId, kind: 'device', fp: 'fp-paired' },
    TEST_JWT_SECRET,
    { expiresIn: expiresIn as any },
  );
}

// Helper: a paired existing-screen mock record.
function pairedScreen(overrides: Record<string, any> = {}) {
  return {
    id: 'screen-paired-001',
    deviceFingerprint: 'fp-paired-001',
    pairingCode: null,
    tenantId: 'tenant-xyz',
    resolution: null,
    osInfo: null,
    browserInfo: null,
    userAgent: null,
    name: 'Screen-Paired',
    ...overrides,
  };
}

function pairedUpdated(overrides: Record<string, any> = {}) {
  return {
    id: 'screen-paired-001',
    pairingCode: null,
    tenantId: 'tenant-xyz',
    name: 'Screen-Paired',
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// P0 #5 — Paired re-registration graduated trust
// ════════════════════════════════════════════════════════════════════════════

// ── Test P5-1: valid priorDeviceToken → 365-day token ───────────────────────
it('P5-1: paired re-register with valid priorDeviceToken → 365-day token issued', async () => {
  const screenId = 'screen-paired-001';
  const validPrior = mintTestToken(screenId, '365d');

  mockPrisma.client.screen.findUnique.mockResolvedValue(pairedScreen({ id: screenId }));
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated({ id: screenId }));

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: validPrior },
    makeReq(),
  );

  expect(res.paired).toBe(true);
  expect(res.requiresRePair).toBeUndefined();
  const decoded = jwt.decode(res.deviceToken) as { iat: number; exp: number };
  const ttlDays = (decoded.exp - decoded.iat) / 86400;
  expect(ttlDays).toBeGreaterThanOrEqual(364);
});

// ── Test P5-2: absent priorDeviceToken + STRICT=true → 1h + requiresRePair ──
it('P5-2: paired re-register without priorDeviceToken + STRICT_REPAIR_AUTH=true → 1h token + requiresRePair', async () => {
  process.env.STRICT_REPAIR_AUTH = 'true';
  // Recreate controller so it reads the updated env.
  controller = new ScreensController(mockPrisma, mockRedis, mockSigner, mockLicense, {} as any, {} as any);

  mockPrisma.client.screen.findUnique.mockResolvedValue(pairedScreen());
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated());

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001' },
    makeReq(),
  );

  expect(res.requiresRePair).toBe(true);
  const decoded = jwt.decode(res.deviceToken) as { iat: number; exp: number };
  const ttlSeconds = decoded.exp - decoded.iat;
  // Must be ≤ 1h (3600s) + 30s slack for test timing.
  expect(ttlSeconds).toBeLessThanOrEqual(3630);
  expect(ttlSeconds).toBeGreaterThan(0);
});

// ── Test P5-3: INVALID priorDeviceToken (different screenId) → 401 ──────────
it('P5-3: paired re-register with priorDeviceToken for DIFFERENT screen → 401', async () => {
  const differentScreenToken = mintTestToken('screen-DIFFERENT-999');

  mockPrisma.client.screen.findUnique.mockResolvedValue(pairedScreen({ id: 'screen-paired-001' }));

  await expect(
    controller.register(
      { deviceFingerprint: 'fp-paired-001', priorDeviceToken: differentScreenToken },
      makeReq(),
    ),
  ).rejects.toMatchObject({ status: 401 });
});

// ── Test P5-4: EXPIRED priorDeviceToken (correct screenId) → 1h fallback ────
it('P5-4: paired re-register with EXPIRED priorDeviceToken → 1-hour fallback, not a hard 401', async () => {
  const screenId = 'screen-paired-001';
  // Sign a token that expired 2 seconds ago.
  const expiredToken = jwt.sign(
    { sub: screenId, kind: 'device', fp: 'fp-paired-001' },
    TEST_JWT_SECRET,
    { expiresIn: -2 }, // already expired
  );

  mockPrisma.client.screen.findUnique.mockResolvedValue(pairedScreen({ id: screenId }));
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated({ id: screenId }));

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: expiredToken },
    makeReq(),
  );

  // Must succeed (no 401), with a 1-hour TTL.
  expect(res.paired).toBe(true);
  const decoded = jwt.decode(res.deviceToken) as { iat: number; exp: number };
  const ttlSeconds = decoded.exp - decoded.iat;
  expect(ttlSeconds).toBeLessThanOrEqual(3630);
  expect(ttlSeconds).toBeGreaterThan(0);
  expect(res.requiresRePair).toBe(true);
});

// ── Test P5-5: STRICT=false + absent priorToken → legacy 365d (compat) ──────
it('P5-5: paired re-register without priorDeviceToken + STRICT_REPAIR_AUTH=false → legacy 365d (backward compat)', async () => {
  // STRICT_REPAIR_AUTH is unset (deleted in beforeEach) — legacy path.
  mockPrisma.client.screen.findUnique.mockResolvedValue(pairedScreen());
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated());

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001' },
    makeReq(),
  );

  expect(res.paired).toBe(true);
  expect(res.requiresRePair).toBeUndefined();
  const decoded = jwt.decode(res.deviceToken) as { iat: number; exp: number };
  const ttlDays = (decoded.exp - decoded.iat) / 86400;
  // Legacy behavior: 365-day token even without priorDeviceToken.
  expect(ttlDays).toBeGreaterThanOrEqual(364);
});

// ════════════════════════════════════════════════════════════════════════════
// P0 #7 — Round 1 regressions (must remain green)
// ════════════════════════════════════════════════════════════════════════════

// ── Test P7-1: Happy-path — new device registers successfully ────────────────
it('P7-1: returns screenId and deviceToken for a brand-new fingerprint', async () => {
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

// ── Test P7-2: Per-fingerprint cooldown → 429 ───────────────────────────────
it('P7-2: rejects a second registration of the same fingerprint within 15 minutes (HTTP 429)', async () => {
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

// ── Test P7-3: Unpaired token TTL ≤ 16 minutes ──────────────────────────────
it('P7-3: mints an unpaired token with TTL ≤ 16 minutes (Defense 2)', async () => {
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

// ── Test P7-4: Unpaired re-register (no tenantId) still issues 15-min token ─
it('P7-4: unpaired existing screen re-register → 15-min token (not a 365-day one)', async () => {
  const unpairedScreen = {
    id: 'screen-unpaired-004',
    deviceFingerprint: 'fp-unpaired-004',
    pairingCode: 'WAIT01',
    tenantId: null, // not yet paired
    resolution: null,
    osInfo: null,
    browserInfo: null,
    userAgent: null,
    name: 'Screen-Waiting',
  };
  mockPrisma.client.screen.findUnique.mockResolvedValue(unpairedScreen);
  mockPrisma.client.screen.update.mockResolvedValue({
    id: 'screen-unpaired-004',
    pairingCode: 'WAIT01',
    tenantId: null,
    name: 'Screen-Waiting',
  });

  const res = await controller.register(
    { deviceFingerprint: 'fp-unpaired-004' },
    makeReq(),
  );

  expect(res.paired).toBe(false);
  const decoded = jwt.decode(res.deviceToken) as { iat: number; exp: number };
  const ttlSeconds = decoded.exp - decoded.iat;
  // Must be a short token (≤ 16 min), not a 365-day one.
  expect(ttlSeconds).toBeLessThanOrEqual(960);
  expect(ttlSeconds).toBeGreaterThan(0);
});
