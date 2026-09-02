/**
 * Regression tests for /screens/register security hardening.
 *
 * P0 #7 defenses (Round 1 — still present):
 *   Defense 1: @Throttle 5/hr per IP + per-fingerprint 15-min cooldown.
 *   Defense 2: Unpaired token TTL = 15 min.
 *
 * P0 #5 defenses (Round 2 — graduated trust for paired re-registration):
 *   Defense 1: Paired re-registration requires proof of prior device JWT
 *              (priorDeviceToken) to mint a full-lifetime token.
 *
 * DT-02 / DT-04 (2026-08-03 security wave) changed three things here, and
 * the assertions below were updated to match:
 *   • Full-lifetime is 180 days, not 365. Expiry used to be decorative
 *     because the credential renewed itself indefinitely; it is now a real
 *     ceiling, sized to clear a ~100-day school summer break.
 *   • STRICT_REPAIR_AUTH is GONE. The `false` default meant a bare device
 *     FINGERPRINT — readable by CONTRIBUTOR and RESTRICTED_VIEWER — minted
 *     a full-lifetime credential for any screen in the tenant. Strict is
 *     now unconditional; P5-5 asserts the old legacy branch is dead.
 *   • Proving possession ROTATES the credential epoch, so the presented
 *     token is retired as the new one is issued.
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
    // DT-02: renewal now writes a SCREEN_TOKEN_RENEWED / _DOWNGRADED row so
    // a self-renewal chain is visible in forensics.
    auditLog: { create: jest.fn().mockResolvedValue({}) },
    // 2026-08-31: register also writes a per-screen timeline row when the
    // credential verdict TRANSITIONS. Mocked here so the real path runs in
    // these suites instead of being swallowed by its best-effort guard.
    screenEvent: { create: jest.fn().mockResolvedValue({}) },
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
// `ep` defaults to 0 — the grandfathering value that a token minted before
// the credential-epoch column existed resolves to.
function mintTestToken(screenId: string, expiresIn: string = '180d', ep = 0): string {
  return jwt.sign(
    { sub: screenId, kind: 'device', ep },
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
    status: 'ONLINE',
    credentialEpoch: 0,
    credentialEpochRotatedAt: null,
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

// ── Test P5-1: valid priorDeviceToken → full-lifetime (180d) token ─────────
it('P5-1: paired re-register with valid priorDeviceToken → 180-day token issued', async () => {
  const screenId = 'screen-paired-001';
  const validPrior = mintTestToken(screenId, '180d');

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
  // DT-02: bounded at 180 days, and — critically — NOT 365. A regression
  // back to a year would restore the "expiry is decorative" posture.
  expect(ttlDays).toBeGreaterThanOrEqual(179);
  expect(ttlDays).toBeLessThanOrEqual(181);
});

// ── Test P5-1b: DT-02 — the token carries the rotated credential epoch ─────
it('P5-1b: DT-02 — proving possession ROTATES the credential epoch and the new token carries it', async () => {
  const screenId = 'screen-paired-001';
  const validPrior = mintTestToken(screenId, '180d', 4);

  mockPrisma.client.screen.findUnique.mockResolvedValue(
    pairedScreen({ id: screenId, credentialEpoch: 4 }),
  );
  mockPrisma.client.screen.update
    .mockResolvedValueOnce(pairedUpdated({ id: screenId })) // the metadata write
    .mockResolvedValueOnce({ credentialEpoch: 5 });         // the rotation write

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: validPrior },
    makeReq(),
  );

  const decoded = jwt.decode(res.deviceToken) as any;
  expect(decoded.ep).toBe(5);
  // The presented (epoch-4) credential is retired by the bump; only the
  // rotation-grace window keeps it alive, and only briefly.
  const rotationCall = mockPrisma.client.screen.update.mock.calls[1][0];
  expect(rotationCall.data.credentialEpoch).toEqual({ increment: 1 });
});

// ── Test P5-1c: DT-02 — a STALE-epoch token cannot renew itself ────────────
it('P5-1c: DT-02 — a superseded/revoked credential is downgraded, never renewed', async () => {
  const screenId = 'screen-paired-001';
  // Token from epoch 1; the screen has since moved to epoch 7 (an operator
  // revoke, an unpair, or a rotation the thief lost the race on), and the
  // grace window is long past.
  const stalePrior = mintTestToken(screenId, '180d', 1);

  mockPrisma.client.screen.findUnique.mockResolvedValue(
    pairedScreen({
      id: screenId,
      credentialEpoch: 7,
      credentialEpochRotatedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
    }),
  );
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated({ id: screenId }));

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: stalePrior },
    makeReq(),
  );

  // Downgraded, not 401'd: a hard reject would let whoever rotates FIRST
  // deliberately black out a real screen, and a dark screen is the failure
  // mode this product exists to prevent.
  expect(res.requiresRePair).toBe(true);
  const decoded = jwt.decode(res.deviceToken) as { iat: number; exp: number };
  expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(3630);
  // And it must NOT have rotated the epoch — otherwise an attacker could
  // force a screen out of its own credential just by spamming /register.
  const rotationCalls = mockPrisma.client.screen.update.mock.calls.filter(
    (c: any[]) => c[0]?.data?.credentialEpoch,
  );
  expect(rotationCalls).toHaveLength(0);
});

// ── Test P5-1d: DT-01 — a REVOKED screen cannot re-register itself back ────
it('P5-1d: DT-01 — a REVOKED screen is refused, credential or not', async () => {
  const screenId = 'screen-paired-001';
  const validPrior = mintTestToken(screenId, '180d');
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    pairedScreen({ id: screenId, status: 'REVOKED' }),
  );

  await expect(
    controller.register(
      { deviceFingerprint: 'fp-paired-001', priorDeviceToken: validPrior },
      makeReq(),
    ),
  ).rejects.toMatchObject({ status: 403 });
});

// ── Test P5-2: absent priorDeviceToken → 1h + requiresRePair ───────────────
it('P5-2: paired re-register without priorDeviceToken → 1h token + requiresRePair', async () => {
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

// ── DEVAUTH-01: the unproven credential is not proof of possession ─────────
//
// A bare `{deviceFingerprint}` register mints a short-lived credential and
// flags `requiresRePair`. That flag lived only in the RESPONSE — the token was
// byte-identical to a fully paired one apart from `exp`, so replaying it as
// `priorDeviceToken` was accepted as proof and upgraded to 180 days. Two
// anonymous requests turned a known fingerprint into a long-lived device
// credential (and rotated the epoch, locking the real screen out).
it('DEVAUTH-01: the unproven token is marked as such', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue(pairedScreen());
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated());

  const res = await controller.register({ deviceFingerprint: 'fp-paired-001' }, makeReq());

  expect(res.requiresRePair).toBe(true);
  expect((jwt.decode(res.deviceToken) as any).unproven).toBe(true);
});

it('DEVAUTH-01: replaying the unproven token as priorDeviceToken does NOT mint a 180-day credential', async () => {
  mockPrisma.client.screen.findUnique.mockResolvedValue(pairedScreen());
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated());

  // Step 1 — anonymous, fingerprint only.
  const step1 = await controller.register({ deviceFingerprint: 'fp-paired-001' }, makeReq());

  // Step 2 — present it back as proof of possession. This was the escalation.
  mockPrisma.client.screen.findUnique.mockResolvedValue(pairedScreen());
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated());
  const step2 = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: step1.deviceToken },
    makeReq(),
  );

  // Still unproven: no upgrade, and the caller is told to re-pair.
  expect(step2.requiresRePair).toBe(true);
  const decoded = jwt.decode(step2.deviceToken) as { iat: number; exp: number; unproven?: boolean };
  expect(decoded.unproven).toBe(true);
  expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(3630); // ≤ 1h, not 180d
});

it('DEVAUTH-01: a genuine paired token is still accepted (fix is not over-broad)', async () => {
  const validPrior = mintTestToken('screen-paired-001');
  mockPrisma.client.screen.findUnique.mockResolvedValue(pairedScreen({ id: 'screen-paired-001' }));
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated({ id: 'screen-paired-001' }));

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: validPrior },
    makeReq(),
  );

  expect(res.requiresRePair).toBeFalsy();
  const decoded = jwt.decode(res.deviceToken) as { iat: number; exp: number; unproven?: boolean };
  expect(decoded.unproven).toBeUndefined();
  expect(decoded.exp - decoded.iat).toBeGreaterThan(3630); // the long-lived one
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

// ── Test P5-5: DT-04 — the STRICT_REPAIR_AUTH legacy branch is DEAD ────────
it('P5-5: DT-04 — fingerprint-only re-registration NEVER mints a full-lifetime token, flag or no flag', async () => {
  // This test used to assert the OPPOSITE: that with STRICT_REPAIR_AUTH
  // unset (the DEFAULT, and absent from .env.example and the CLAUDE.md env
  // table) a bare fingerprint minted a 365-day credential. A fingerprint is
  // not a secret — `GET /screens` handed it to every CONTRIBUTOR, and
  // RESTRICTED_VIEWER reached the same route through the RBAC GET
  // pass-through — so that default handed the two lowest-privilege roles
  // device-level control of every screen in the tenant, including a
  // destructive tenant-wide unpair. Explicitly pin the flag ON *and* OFF to
  // prove the branch cannot come back.
  for (const flag of ['true', 'false', undefined]) {
    jest.clearAllMocks();
    _registerFpCooldown.clear();
    if (flag === undefined) delete process.env.STRICT_REPAIR_AUTH;
    else process.env.STRICT_REPAIR_AUTH = flag;
    controller = new ScreensController(mockPrisma, mockRedis, mockSigner, mockLicense, {} as any, {} as any);

    mockPrisma.client.screen.findUnique.mockResolvedValue(pairedScreen());
    mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated());

    const res = await controller.register(
      { deviceFingerprint: 'fp-paired-001' },
      makeReq(),
    );

    expect(res.paired).toBe(true);
    expect(res.requiresRePair).toBe(true);
    const decoded = jwt.decode(res.deviceToken) as { iat: number; exp: number };
    const ttlSeconds = decoded.exp - decoded.iat;
    expect(ttlSeconds).toBeLessThanOrEqual(3630);
  }
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
it('P7-2: rejects a second registration of the same fingerprint inside the per-fingerprint cooldown (HTTP 429)', async () => {
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

// ── 2026-08-30 deep-audit B-P1-6 / B-P1-7 — fork convergence + operator-repair restore ──

function mintUnprovenTestToken(screenId: string, ep: number, expiresIn: string = '1h'): string {
  return jwt.sign(
    { sub: screenId, kind: 'device', ep, unproven: true },
    TEST_JWT_SECRET,
    { expiresIn: expiresIn as any },
  );
}

it('B-P1-6: a grace-window (current-1) token renews to 180d WITHOUT rotating again — the concurrent-register fork converges', async () => {
  const screenId = 'screen-paired-001';
  // The device raced its own register: this response's loser presents the
  // pre-rotation (epoch 4) token while the row is already at epoch 5,
  // rotated seconds ago.
  const gracePrior = mintTestToken(screenId, '180d', 4);
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    pairedScreen({
      id: screenId,
      credentialEpoch: 5,
      credentialEpochRotatedAt: new Date(Date.now() - 60_000),
    }),
  );
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated({ id: screenId }));

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: gracePrior },
    makeReq(),
  );

  expect(res.requiresRePair).toBeUndefined();
  const decoded = jwt.decode(res.deviceToken) as any;
  // Full-lifetime renewal…
  expect(decoded.exp - decoded.iat).toBeGreaterThan(100 * 24 * 3600);
  // …minted on the CURRENT epoch (converged), not a fresh bump (forked).
  expect(decoded.ep).toBe(5);
  const rotationCalls = mockPrisma.client.screen.update.mock.calls.filter(
    (c: any[]) => c[0]?.data?.credentialEpoch,
  );
  expect(rotationCalls).toHaveLength(0);
});

it('B-P1-7: OPERATOR-REPAIR RESTORE — an unproven current-1 token becomes a proven 180d credential right after the operator pairs', async () => {
  const screenId = 'screen-paired-001';
  // The G43 shape: screen living on 1h unproven tokens (minted at epoch 4),
  // operator just re-paired from the dashboard (pair bumped epoch to 5,
  // stamped authState PROVEN, rotatedAt seconds old).
  const unprovenPrior = mintUnprovenTestToken(screenId, 4);
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    pairedScreen({
      id: screenId,
      credentialEpoch: 5,
      credentialEpochRotatedAt: new Date(Date.now() - 60_000),
      authState: 'PROVEN',
    }),
  );
  mockPrisma.client.screen.update
    .mockResolvedValueOnce(pairedUpdated({ id: screenId }))
    .mockResolvedValueOnce({ credentialEpoch: 6 });

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: unprovenPrior },
    makeReq(),
  );

  expect(res.requiresRePair).toBeUndefined();
  const decoded = jwt.decode(res.deviceToken) as any;
  expect(decoded.exp - decoded.iat).toBeGreaterThan(100 * 24 * 3600);
  expect(decoded.unproven).toBeUndefined(); // trust restored, not carried over
  // The unproven credential is retired by a real rotation.
  expect(decoded.ep).toBe(6);
  const rotationCall = mockPrisma.client.screen.update.mock.calls[1][0];
  expect(rotationCall.data.credentialEpoch).toEqual({ increment: 1 });
});

it('B-P1-7 guard: WITHOUT a fresh operator pair, the unproven token stays downgraded (DEVAUTH-01 intact)', async () => {
  const screenId = 'screen-paired-001';
  const unprovenPrior = mintUnprovenTestToken(screenId, 4);
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    pairedScreen({
      id: screenId,
      credentialEpoch: 5,
      credentialEpochRotatedAt: new Date(Date.now() - 60_000),
      authState: null, // no operator action recorded
    }),
  );
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated({ id: screenId }));

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: unprovenPrior },
    makeReq(),
  );
  expect(res.requiresRePair).toBe(true);
  const decoded = jwt.decode(res.deviceToken) as any;
  expect(decoded.exp - decoded.iat).toBeLessThanOrEqual(3630);
});

it('B-P1-7 guard: an unproven token at the CURRENT epoch cannot restore — a post-pair anonymous mint gains nothing', async () => {
  const screenId = 'screen-paired-001';
  // Minted AFTER the operator's pair (downgrades mint at the current
  // epoch): restore must refuse, or anyone could farm a proven credential
  // by registering the fingerprint right after every pair.
  const unprovenPrior = mintUnprovenTestToken(screenId, 5);
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    pairedScreen({
      id: screenId,
      credentialEpoch: 5,
      credentialEpochRotatedAt: new Date(Date.now() - 60_000),
      authState: 'PROVEN',
    }),
  );
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated({ id: screenId }));

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: unprovenPrior },
    makeReq(),
  );
  expect(res.requiresRePair).toBe(true);
});

it('B-P1-7 guard: outside the grace window the restore door is closed', async () => {
  const screenId = 'screen-paired-001';
  const unprovenPrior = mintUnprovenTestToken(screenId, 4);
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    pairedScreen({
      id: screenId,
      credentialEpoch: 5,
      credentialEpochRotatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // grace is 24h
      authState: 'PROVEN',
    }),
  );
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated({ id: screenId }));

  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: unprovenPrior },
    makeReq(),
  );
  expect(res.requiresRePair).toBe(true);
});

// ════════════════════════════════════════════════════════════════════════════
// Credential timeline (2026-08-31, Fleet Command Phase 2)
//
// The dashboard needs to show WHEN a screen lost or regained proven trust.
// The trap is cadence: every screen re-registers on a 10-minute timer, so a
// row per register would bury those two moments under a fleet-wide flood —
// and that flood is the steady state, not the exception. Hence transitions
// only, which is what the third case below is really guarding.
// ════════════════════════════════════════════════════════════════════════════

/** The `data` of the screenEvent.create call, or null if none was made. */
const credentialEvent = () =>
  (mockPrisma.client.screenEvent.create as jest.Mock).mock.calls[0]?.[0]?.data ?? null;

it('timeline: losing proven trust writes repair-required', async () => {
  const screenId = 'screen-paired-001';
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    pairedScreen({ id: screenId, authState: 'PROVEN' }),
  );
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated({ id: screenId }));

  // No prior token → downgraded to a 1-hour credential.
  const res = await controller.register({ deviceFingerprint: 'fp-paired-001' }, makeReq());
  expect(res.requiresRePair).toBe(true);

  expect(credentialEvent()).toMatchObject({
    screenId,
    tenantId: 'tenant-xyz',
    kind: 'repair-required',
    detail: { priorAuthState: 'PROVEN', authState: 'REPAIR_REQUIRED' },
  });
});

it('timeline: regaining proven trust writes credential-restored', async () => {
  const screenId = 'screen-paired-001';
  const validPrior = mintTestToken(screenId, '180d');
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    pairedScreen({ id: screenId, authState: 'REPAIR_REQUIRED' }),
  );
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated({ id: screenId }));

  await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: validPrior },
    makeReq(),
  );

  expect(credentialEvent()).toMatchObject({
    kind: 'credential-restored',
    detail: { priorAuthState: 'REPAIR_REQUIRED', authState: 'PROVEN' },
  });
});

it('timeline: a steady-state renewal writes NOTHING — transitions only', async () => {
  const screenId = 'screen-paired-001';
  const validPrior = mintTestToken(screenId, '180d');
  mockPrisma.client.screen.findUnique.mockResolvedValue(
    pairedScreen({ id: screenId, authState: 'PROVEN' }),
  );
  mockPrisma.client.screen.update.mockResolvedValue(pairedUpdated({ id: screenId }));

  // The 10-minute proactive re-register every healthy screen in the fleet
  // performs. Nothing changed, so nothing is recorded.
  const res = await controller.register(
    { deviceFingerprint: 'fp-paired-001', priorDeviceToken: validPrior },
    makeReq(),
  );
  expect(res.requiresRePair).toBeFalsy();
  expect(mockPrisma.client.screenEvent.create).not.toHaveBeenCalled();
});
