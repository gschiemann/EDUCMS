/**
 * Regression tests for the shared device-credential verifier.
 *
 * Covers findings DT-01 (revocation exists at all), DT-02 (rotation +
 * grace), DT-03 (identity from the live row, never a claim), DT-05 (one
 * code path — the checks the JwtAuthGuard path enforced and the nine
 * `verifyDeviceForScreen` routes skipped) and DT-12 (explicit algorithm
 * allowlist), from
 * docs/research/2026-08-01-player-security-audit/05-DEVICE-TOKEN-AUTH.md
 */

import * as jwt from 'jsonwebtoken';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

import {
  verifyDeviceForScreen,
  invalidateDeviceCredentialCache,
  isEpochAcceptable,
  epochFromClaim,
  CREDENTIAL_EPOCH_GRACE_MS,
  DEVICE_TOKEN_TTL_PAIRED,
} from './device-auth';

const DEVICE_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_ID = 'screen-aaa-111';

function token(overrides: Record<string, unknown> = {}, expiresIn = '180d'): string {
  return jwt.sign(
    { sub: SCREEN_ID, deviceId: SCREEN_ID, kind: 'device', ep: 0, ...overrides },
    DEVICE_SECRET,
    { expiresIn: expiresIn as any },
  );
}

function req(tok?: string, headers: Record<string, string> = {}) {
  return { headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...headers } } as any;
}

function screenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SCREEN_ID,
    tenantId: 'tenant-live',
    screenGroupId: 'group-live',
    status: 'ONLINE',
    credentialEpoch: 0,
    credentialEpochRotatedAt: null,
    ...overrides,
  };
}

function deps(row: any, redis?: any) {
  return {
    prisma: { client: { screen: { findUnique: jest.fn().mockResolvedValue(row) } } } as any,
    redis,
  };
}

beforeEach(() => invalidateDeviceCredentialCache());

describe('epoch arithmetic (DT-01/DT-02)', () => {
  it('grandfathers a token minted before the `ep` claim existed as epoch 0', () => {
    // THE fleet-safety hinge: every already-deployed device token has no
    // `ep`, and Screen.credentialEpoch defaults to 0, so they match. If this
    // ever stops being true the entire installed base loses its credential
    // the moment the change deploys.
    expect(epochFromClaim({ sub: SCREEN_ID, kind: 'device' })).toBe(0);
    expect(isEpochAcceptable(0, { credentialEpoch: 0, credentialEpochRotatedAt: null })).toBe(true);
  });

  it('accepts the current epoch and refuses an older one outside the grace window', () => {
    const old = new Date(Date.now() - CREDENTIAL_EPOCH_GRACE_MS - 60_000);
    expect(isEpochAcceptable(3, { credentialEpoch: 3, credentialEpochRotatedAt: old })).toBe(true);
    expect(isEpochAcceptable(2, { credentialEpoch: 3, credentialEpochRotatedAt: old })).toBe(false);
    expect(isEpochAcceptable(1, { credentialEpoch: 3, credentialEpochRotatedAt: null })).toBe(false);
  });

  it('accepts the immediately-previous epoch INSIDE the grace window', () => {
    // Without this window, a register response lost in flight (or two
    // register calls racing on boot) would lock a legitimate kiosk out of
    // its own credential. Rotation must never be able to dark a screen.
    const justNow = new Date(Date.now() - 1_000);
    expect(isEpochAcceptable(2, { credentialEpoch: 3, credentialEpochRotatedAt: justNow })).toBe(true);
    // …but only the immediately-previous one, not the whole history.
    expect(isEpochAcceptable(1, { credentialEpoch: 3, credentialEpochRotatedAt: justNow })).toBe(false);
  });
});

describe('verifyDeviceForScreen (DT-05 — one code path, all the checks)', () => {
  it('accepts a well-formed token and returns identity from the LIVE row, not the claim', async () => {
    // DT-03: the token asserts a stale tenant; the live row is what counts.
    const t = token({ tenantId: 'tenant-STALE-from-claim' });
    const res = await verifyDeviceForScreen(deps(screenRow()), req(t), SCREEN_ID);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.tenantId).toBe('tenant-live');
    expect(res.screen.screenGroupId).toBe('group-live');
  });

  it('refuses a token whose sub names a different screen', async () => {
    const t = jwt.sign({ sub: 'screen-OTHER', kind: 'device', ep: 0 }, DEVICE_SECRET, { expiresIn: '1h' });
    const res = await verifyDeviceForScreen(deps(screenRow()), req(t), SCREEN_ID);
    expect(res).toMatchObject({ ok: false, reason: 'subject_mismatch' });
  });

  it('refuses a user token presented on a device route', async () => {
    const t = jwt.sign({ sub: SCREEN_ID, kind: 'user', role: 'SUPER_ADMIN' }, DEVICE_SECRET, { expiresIn: '1h' });
    const res = await verifyDeviceForScreen(deps(screenRow()), req(t), SCREEN_ID);
    expect(res).toMatchObject({ ok: false, reason: 'wrong_token_kind' });
  });

  it('DT-01: refuses a screen whose status is REVOKED', async () => {
    // The status the manifest endpoint has always checked and that nothing
    // in the product ever wrote. Now it is written, and now it bites here.
    const res = await verifyDeviceForScreen(deps(screenRow({ status: 'REVOKED' })), req(token()), SCREEN_ID);
    expect(res).toMatchObject({ ok: false, reason: 'screen_revoked' });
  });

  it('DT-01: refuses a credential whose epoch has been retired', async () => {
    const res = await verifyDeviceForScreen(
      deps(screenRow({ credentialEpoch: 4, credentialEpochRotatedAt: new Date(0) })),
      req(token({ ep: 1 })),
      SCREEN_ID,
    );
    expect(res).toMatchObject({ ok: false, reason: 'credential_epoch_stale' });
  });

  it('DT-01: a deleted screen row is a complete credential kill', async () => {
    const res = await verifyDeviceForScreen(deps(null), req(token()), SCREEN_ID);
    expect(res).toMatchObject({ ok: false, reason: 'screen_not_found' });
  });

  it('DT-05: consults the revocation list, which these routes previously skipped', async () => {
    const redis = { sismember: jest.fn().mockResolvedValue(true) };
    const res = await verifyDeviceForScreen(deps(screenRow(), redis), req(token()), SCREEN_ID);
    expect(redis.sismember).toHaveBeenCalledWith('jwt_revoked_list', expect.any(String));
    expect(res).toMatchObject({ ok: false, reason: 'token_revoked' });
  });

  it('fails CLOSED when the revocation store is wired but errors', async () => {
    // Same posture as JwtAuthGuard: if we cannot confirm a token is NOT
    // revoked, deny. A transient outage is an auth blip, not a bypass.
    const redis = { sismember: jest.fn().mockRejectedValue(new Error('ECONNRESET')) };
    const res = await verifyDeviceForScreen(deps(screenRow(), redis), req(token()), SCREEN_ID);
    expect(res).toMatchObject({ ok: false, reason: 'revocation_check_unavailable' });
  });

  it('refuses an unpaired screen when the route requires a tenant', async () => {
    const res = await verifyDeviceForScreen(
      deps(screenRow({ tenantId: null })),
      req(token()),
      SCREEN_ID,
      { allowUnpaired: false },
    );
    expect(res).toMatchObject({ ok: false, reason: 'screen_unpaired' });
  });

  it('still serves an unpaired screen on pre-claim routes (orientation splash)', async () => {
    const res = await verifyDeviceForScreen(deps(screenRow({ tenantId: null })), req(token()), SCREEN_ID);
    expect(res.ok).toBe(true);
  });

  it('DT-12: refuses an unsigned `alg:none` token', async () => {
    const unsigned = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: SCREEN_ID, kind: 'device', ep: 0 })).toString('base64url'),
      '',
    ].join('.');
    const res = await verifyDeviceForScreen(deps(screenRow()), req(unsigned), SCREEN_ID);
    expect(res.ok).toBe(false);
  });

  it('refuses a request with no credential at all', async () => {
    const res = await verifyDeviceForScreen(deps(screenRow()), req(), SCREEN_ID);
    expect(res).toMatchObject({ ok: false, reason: 'no_auth' });
  });

  it('memoises the live-row read so a 16 Hz route is not 16 DB round trips', async () => {
    const d = deps(screenRow());
    await verifyDeviceForScreen(d, req(token()), SCREEN_ID);
    await verifyDeviceForScreen(d, req(token()), SCREEN_ID);
    await verifyDeviceForScreen(d, req(token()), SCREEN_ID);
    expect(d.prisma.client.screen.findUnique).toHaveBeenCalledTimes(1);
  });

  it('invalidateDeviceCredentialCache makes a revoke bite immediately on this replica', async () => {
    const d = deps(screenRow());
    await verifyDeviceForScreen(d, req(token()), SCREEN_ID);
    d.prisma.client.screen.findUnique.mockResolvedValue(screenRow({ status: 'REVOKED' }));
    invalidateDeviceCredentialCache(SCREEN_ID);
    const res = await verifyDeviceForScreen(d, req(token()), SCREEN_ID);
    expect(res).toMatchObject({ ok: false, reason: 'screen_revoked' });
  });
});

describe('token lifetime (DT-02)', () => {
  it('is bounded at 180 days — long enough for a school summer break, not a year', () => {
    // Sized deliberately: a ~100-day summer shutdown must NOT strand a
    // fleet needing hand re-pairing in September.
    expect(DEVICE_TOKEN_TTL_PAIRED).toBe('180d');
  });
});
