/**
 * Trust-wave D (2026-08-06) — POST /auth/refresh: sliding session with a cap.
 *
 * The defect: a scorekeeper who logged in during warm-ups held a 1h JWT
 * (auth.module signOptions) and was bounced to /login in the third quarter.
 * The fix is a refresh endpoint guarded by the SAME JwtAuthGuard as every
 * authed route — a still-valid token is required, so an expired or revoked
 * token can never refresh — plus an `origIat` anchor minted at login so a
 * token can slide but a session cannot outlive its window (12h for plain
 * sessions, the existing 30d for rememberMe).
 *
 * These tests pin, in order:
 *   1. the login mint stamps `origIat` (+ `rm` for rememberMe);
 *   2. refreshSession re-mints ALL claims from the LIVE user row (role /
 *      canTriggerPanic staleness narrows), carries origIat unchanged, and
 *      enforces the sliding cap + live-account gates;
 *   3. the guard refuses revoked and expired tokens ON the refresh route
 *      (refresh can never resurrect a dead session);
 *   4. the controller endpoint audits AUTH_TOKEN_REFRESH and refuses
 *      machine identities.
 */
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';

const HOUR = 60 * 60;
const DAY = 24 * HOUR;
const SESSION_WINDOW = 12 * HOUR;
const REMEMBER_WINDOW = 30 * DAY;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ─── 1. Login mint stamps the sliding-refresh anchor ────────────────────────

describe('login mints origIat (+ rm for rememberMe)', () => {
  function makeLoginService() {
    const sign = jest.fn().mockReturnValue('tok');
    const prisma = {
      client: {
        tenant: {
          findUnique: jest.fn(async () => ({ slug: 'acme', vertical: 'K12', name: 'Acme' })),
        },
        user: { findUnique: jest.fn() },
      },
    };
    return { service: new AuthService(prisma as any, { sign } as any), sign };
  }
  // SEC-008 — SCHOOL_ADMIN AND canTriggerPanic: this fixture is exactly the
  // identity the MFA policy exists for, so it only gets a full session (and
  // therefore an `origIat`/`rm` claim to assert on) once it holds a second
  // factor. Enrolling the fixture keeps these tests about origIat/rm, which
  // is what they are for, and states the MFA precondition out loud.
  const user = {
    id: 'u1', email: 'op@acme.edu', tenantId: 't1', role: 'SCHOOL_ADMIN', canTriggerPanic: true,
    mfaTotpVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
  };

  it('plain session: numeric origIat ≈ now, no rm claim, default (1h) expiry', async () => {
    const { service, sign } = makeLoginService();
    const before = nowSec();
    await service.login(user, undefined, { mfaAlreadySatisfied: true });
    const [payload, opts] = sign.mock.calls[0];
    expect(typeof payload.origIat).toBe('number');
    expect(payload.origIat).toBeGreaterThanOrEqual(before);
    expect(payload.origIat).toBeLessThanOrEqual(nowSec() + 1);
    expect(payload.rm).toBeUndefined();
    expect(opts).toBeUndefined(); // module default '1h' applies
  });

  it('rememberMe: origIat + rm:true + the existing 30d expiry', async () => {
    const { service, sign } = makeLoginService();
    await service.login(user, true, { mfaAlreadySatisfied: true });
    const [payload, opts] = sign.mock.calls[0];
    expect(typeof payload.origIat).toBe('number');
    expect(payload.rm).toBe(true);
    expect(opts).toEqual({ expiresIn: '30d' });
  });
});

// ─── 2. refreshSession — live-row re-mint + sliding cap ─────────────────────

function liveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    email: 'op@acme.edu',
    role: 'SCHOOL_ADMIN',
    tenantId: 't1',
    canTriggerPanic: true,
    status: 'ACTIVE',
    deletedAt: null,
    // SEC-008 — refreshSession refuses to EXTEND a privileged session whose
    // holder never enrolled (see the AUTH_MFA_ENROLLMENT_REQUIRED branch).
    // The base fixture is enrolled so these tests keep testing the sliding
    // window; the refusal has its own test below.
    mfaTotpVerifiedAt: new Date('2026-08-01T00:00:00.000Z'),
    firstName: 'Grace',
    lastName: 'Op',
    tenant: { slug: 'acme', vertical: 'K12', name: 'Acme', archivedAt: null },
    ...overrides,
  };
}

function makeRefreshHarness(opts: {
  tokenPayload: Record<string, unknown>;
  userRow?: unknown;
}) {
  const sign = jest.fn().mockReturnValue('fresh_token');
  const decode = jest.fn().mockReturnValue(opts.tokenPayload);
  const findUnique = jest.fn(async () =>
    'userRow' in opts ? opts.userRow : liveRow(),
  );
  const prisma = { client: { user: { findUnique } } };
  const service = new AuthService(prisma as any, { sign, decode } as any);
  return { service, sign, decode, findUnique };
}

async function expectRefusal(
  p: Promise<unknown>,
  code: string,
): Promise<void> {
  let thrown: unknown;
  try {
    await p;
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(UnauthorizedException);
  expect((thrown as UnauthorizedException).getResponse()).toMatchObject({ code });
}

/**
 * SEC-008 — refresh is the SECOND checkpoint on the MFA policy.
 *
 * Enforcement lives at session ISSUANCE, which leaves one residual: sessions
 * minted before the deadline keep running (up to 12h, or 30d with
 * rememberMe). Refusing to EXTEND them bounds that residual — a privileged
 * user who never enrolled stops sliding and their current token drains to its
 * own `exp` instead of being renewed indefinitely.
 *
 * The refusal is a 401, which is what every client already does something
 * sensible with: send the user to /login, where the enrollment challenge is
 * waiting. No new client code, and no live admin is cut off mid-action.
 */
describe('SEC-008 - refreshSession will not extend a non-compliant privileged session', () => {
  const t = nowSec();
  const origIat = t - 30 * 60;
  const validPayload = {
    sub: 'u1', iat: origIat, exp: origIat + HOUR, origIat, tenantId: 't1',
    role: 'SCHOOL_ADMIN', canTriggerPanic: true,
  };

  it('refuses a privileged user who never enrolled', async () => {
    const { service } = makeRefreshHarness({
      tokenPayload: validPayload,
      userRow: liveRow({ mfaTotpVerifiedAt: null }),
    });
    await expectRefusal(
      service.refreshSession('u1', 'current.token.x'),
      'AUTH_MFA_ENROLLMENT_REQUIRED',
    );
  });

  it('refuses a panic-capable CONTRIBUTOR who never enrolled', async () => {
    const { service } = makeRefreshHarness({
      tokenPayload: validPayload,
      userRow: liveRow({ role: 'CONTRIBUTOR', canTriggerPanic: true, mfaTotpVerifiedAt: null }),
    });
    await expectRefusal(
      service.refreshSession('u1', 'current.token.x'),
      'AUTH_MFA_ENROLLMENT_REQUIRED',
    );
  });

  it('ALLOWS a non-privileged, non-panic user who never enrolled (no collateral damage)', async () => {
    const { service } = makeRefreshHarness({
      tokenPayload: validPayload,
      userRow: liveRow({ role: 'CONTRIBUTOR', canTriggerPanic: false, mfaTotpVerifiedAt: null }),
    });
    await expect(service.refreshSession('u1', 'current.token.x')).resolves.toMatchObject({
      access_token: 'fresh_token',
    });
  });

  it('ALLOWS a privileged user who IS enrolled', async () => {
    const { service } = makeRefreshHarness({ tokenPayload: validPayload });
    await expect(service.refreshSession('u1', 'current.token.x')).resolves.toMatchObject({
      access_token: 'fresh_token',
    });
  });

  it('reads the LIVE row, so a PROMOTION lands at the next refresh', async () => {
    // The token still says CONTRIBUTOR; the row says the operator was promoted
    // to DISTRICT_ADMIN since login and has no second factor. The stale claim
    // must not be what decides.
    const { service } = makeRefreshHarness({
      tokenPayload: { ...validPayload, role: 'CONTRIBUTOR', canTriggerPanic: false },
      userRow: liveRow({ role: 'DISTRICT_ADMIN', canTriggerPanic: false, mfaTotpVerifiedAt: null }),
    });
    await expectRefusal(
      service.refreshSession('u1', 'current.token.x'),
      'AUTH_MFA_ENROLLMENT_REQUIRED',
    );
  });

  it('still refuses BEFORE the account-state checks it cannot reach (ordering sanity)', async () => {
    // A deleted user must fail as a deleted user, not as an MFA problem —
    // the MFA check sits AFTER the live-row validity gates on purpose so the
    // opaque AUTH_REFRESH_INVALID_SESSION code keeps its no-oracle property.
    const { service } = makeRefreshHarness({
      tokenPayload: validPayload,
      userRow: liveRow({ deletedAt: new Date(), mfaTotpVerifiedAt: null }),
    });
    await expectRefusal(
      service.refreshSession('u1', 'current.token.x'),
      'AUTH_REFRESH_INVALID_SESSION',
    );
  });
});

describe('AuthService.refreshSession', () => {
  it('re-mints ALL claims from the LIVE row and keeps origIat (role-staleness narrows)', async () => {
    const t = nowSec();
    const origIat = t - 30 * 60;
    // Old token still carries the STALE claims a demotion would leave behind.
    const { service, sign, findUnique } = makeRefreshHarness({
      tokenPayload: {
        sub: 'u1', iat: origIat, exp: origIat + HOUR, origIat, tenantId: 't1',
        role: 'CONTRIBUTOR', canTriggerPanic: false,
      },
    });

    const res = await service.refreshSession('u1', 'current.token.x');

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u1' } }),
    );
    const [payload, signOpts] = sign.mock.calls[0];
    // Claims come from the DB row, not the old token.
    expect(payload).toMatchObject({
      sub: 'u1', role: 'SCHOOL_ADMIN', canTriggerPanic: true, tenantId: 't1', origIat,
    });
    expect(payload.rm).toBeUndefined();
    // 11.5h of window left → clamp picks the full 1h class TTL.
    expect(signOpts).toEqual({ expiresIn: HOUR });
    // Response mirrors login's shape.
    expect(res.access_token).toBe('fresh_token');
    expect(res.user).toMatchObject({
      id: 'u1', email: 'op@acme.edu', role: 'SCHOOL_ADMIN',
      tenantId: 't1', tenantSlug: 'acme', tenantVertical: 'K12', canTriggerPanic: true,
    });
  });

  it('refuses a plain-session refresh past the 12h origIat cap — WITHOUT touching the DB', async () => {
    const t = nowSec();
    const origIat = t - 13 * HOUR; // logged in 13h ago, slid ever since
    const { service, findUnique } = makeRefreshHarness({
      tokenPayload: { sub: 'u1', iat: t - 30 * 60, exp: t + 30 * 60, origIat },
    });
    await expectRefusal(
      service.refreshSession('u1', 'x.y.z'),
      'AUTH_REFRESH_WINDOW_EXCEEDED',
    );
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('clamps the final mint so exp never lands past origIat + 12h', async () => {
    const t = nowSec();
    const origIat = t - (SESSION_WINDOW - 30 * 60); // 30 min of window left
    const { service, sign } = makeRefreshHarness({
      // Token dies in 10 min (the realistic <15-min refresh shape); the mint
      // must be clamped to the ~30 min of WINDOW left, not the full 1h class.
      tokenPayload: { sub: 'u1', iat: t - 50 * 60, exp: t + 10 * 60, origIat },
    });
    await service.refreshSession('u1', 'x.y.z');
    const [, signOpts] = sign.mock.calls[0];
    expect(signOpts.expiresIn).toBeGreaterThan(25 * 60);
    expect(signOpts.expiresIn).toBeLessThanOrEqual(30 * 60);
  });

  it('refuses a NO-GAIN refresh (token already expires at the window cap) — WITHOUT touching the DB', async () => {
    const t = nowSec();
    const origIat = t - (SESSION_WINDOW - 10 * 60); // 10 min of window left
    const { service, findUnique } = makeRefreshHarness({
      // exp == origIat + 12h: a prior refresh already clamped this token to
      // the cap. Re-minting cannot extend it; a busy console would otherwise
      // fire a refresh (+ an audit row) on EVERY response for the final
      // minutes of the window.
      tokenPayload: { sub: 'u1', iat: t - 50 * 60, exp: origIat + SESSION_WINDOW, origIat },
    });
    await expectRefusal(service.refreshSession('u1', 'x.y.z'), 'AUTH_REFRESH_WINDOW_EXCEEDED');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('rememberMe (rm claim): refresh works, keeps the SAME class and the SAME origIat', async () => {
    const t = nowSec();
    const origIat = t - 20 * DAY;
    const { service, sign } = makeRefreshHarness({
      tokenPayload: { sub: 'u1', iat: t - DAY, exp: t + 9 * DAY, origIat, rm: true },
    });
    await service.refreshSession('u1', 'x.y.z');
    const [payload, signOpts] = sign.mock.calls[0];
    expect(payload.rm).toBe(true);
    expect(payload.origIat).toBe(origIat);
    // 10 days of the 30d window left → clamped to the remaining window.
    expect(signOpts.expiresIn).toBeGreaterThan(10 * DAY - 5);
    expect(signOpts.expiresIn).toBeLessThanOrEqual(10 * DAY);
  });

  it('rememberMe refresh is refused past 30d of origIat (a stolen token cannot slide forever)', async () => {
    const t = nowSec();
    const { service } = makeRefreshHarness({
      tokenPayload: { sub: 'u1', iat: t - DAY, exp: t + DAY, origIat: t - REMEMBER_WINDOW - HOUR, rm: true },
    });
    await expectRefusal(service.refreshSession('u1', 'x.y.z'), 'AUTH_REFRESH_WINDOW_EXCEEDED');
  });

  it('legacy token (no origIat / no rm): infers rememberMe from lifetime, anchors at its own iat', async () => {
    const t = nowSec();
    const iat = t - 20 * DAY;
    const { service, sign } = makeRefreshHarness({
      // 25d lifetime (a derived mint, e.g. switch-to-home off a rememberMe
      // original) — well past the 12h session shape → rememberMe class. Its
      // exp sits 5d short of the inferred iat+30d cap, so there is gain.
      tokenPayload: { sub: 'u1', iat, exp: t + 5 * DAY },
    });
    await service.refreshSession('u1', 'x.y.z');
    const [payload] = sign.mock.calls[0];
    expect(payload.rm).toBe(true);
    expect(payload.origIat).toBe(iat);
  });

  it('legacy LOGIN-minted rememberMe token (exp IS the 30d cap) is refused — no-gain tail guard', async () => {
    const t = nowSec();
    const iat = t - 20 * DAY;
    const { service, findUnique } = makeRefreshHarness({
      tokenPayload: { sub: 'u1', iat, exp: iat + REMEMBER_WINDOW },
    });
    await expectRefusal(service.refreshSession('u1', 'x.y.z'), 'AUTH_REFRESH_WINDOW_EXCEEDED');
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('refuses a switched-workspace token (payload tenantId ≠ live row) — scope must not silently flip', async () => {
    const t = nowSec();
    const origIat = t - 30 * 60;
    const { service, sign } = makeRefreshHarness({
      // Minted by tenants.controller switchTenant: carries the TARGET
      // tenant's id, which the live user row (tenantId 't1') cannot vouch
      // for. A re-mint from the row would flip the operator's acting tenant
      // back to home mid-session — refuse instead (the switched token stays
      // valid until natural expiry, exactly as before this wave).
      tokenPayload: { sub: 'u1', iat: origIat, exp: t + 30 * 60, origIat, tenantId: 't-child' },
    });
    await expectRefusal(service.refreshSession('u1', 'x.y.z'), 'AUTH_REFRESH_SCOPE_CHANGED');
    expect(sign).not.toHaveBeenCalled();
  });

  // Mid-life session shape for the account-state gates: 30 min old, 30 min of
  // token left, so the window + no-gain pre-checks pass and the DB gate is the
  // one under test.
  const midLifeToken = (t: number) => ({
    sub: 'u1', iat: t - 30 * 60, exp: t + 30 * 60, origIat: t - 30 * 60,
  });

  it('401 for a DELETED user (refresh never extends a dead account)', async () => {
    const t = nowSec();
    const { service } = makeRefreshHarness({
      tokenPayload: midLifeToken(t),
      userRow: liveRow({ deletedAt: new Date() }),
    });
    await expectRefusal(service.refreshSession('u1', 'x.y.z'), 'AUTH_REFRESH_INVALID_SESSION');
  });

  it('401 for a DISABLED (non-ACTIVE) user', async () => {
    const t = nowSec();
    const { service } = makeRefreshHarness({
      tokenPayload: midLifeToken(t),
      userRow: liveRow({ status: 'SUSPENDED' }),
    });
    await expectRefusal(service.refreshSession('u1', 'x.y.z'), 'AUTH_REFRESH_INVALID_SESSION');
  });

  it('401 when the user row no longer exists', async () => {
    const t = nowSec();
    const { service } = makeRefreshHarness({
      tokenPayload: midLifeToken(t),
      userRow: null,
    });
    await expectRefusal(service.refreshSession('u1', 'x.y.z'), 'AUTH_REFRESH_INVALID_SESSION');
  });

  it('401 when the tenant was archived since login (ACC-05 parity)', async () => {
    const t = nowSec();
    const { service } = makeRefreshHarness({
      tokenPayload: midLifeToken(t),
      userRow: liveRow({
        tenant: { slug: 'acme', vertical: 'K12', name: 'Acme', archivedAt: new Date() },
      }),
    });
    await expectRefusal(service.refreshSession('u1', 'x.y.z'), 'AUTH_REFRESH_INVALID_SESSION');
  });
});

// ─── 3. The guard in front of /auth/refresh — no resurrection ───────────────

describe('JwtAuthGuard on the refresh route — revoked/expired tokens cannot refresh', () => {
  const TEST_SECRET = 'dev_only_jwt_secret_CHANGE_ME';
  const jwt = new JwtService({ secret: TEST_SECRET });
  const prevSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = TEST_SECRET;
  });
  afterAll(() => {
    if (prevSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = prevSecret;
  });

  function refreshCtx(token: string) {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: `Bearer ${token}` },
          originalUrl: '/api/v1/auth/refresh',
          method: 'POST',
          user: undefined as any,
        }),
      }),
    } as any;
  }

  it('REVOKED token (jwt_revoked_list) → 401 before the handler runs', async () => {
    const token = jwt.sign({ sub: 'u1', role: 'SCHOOL_ADMIN', tenantId: 't1' });
    const redis = {
      sismember: jest.fn(async () => true), // in the revocation set
      getTokenInvalidBefore: jest.fn(async () => null),
    };
    const guard = new JwtAuthGuard(jwt, redis as any);
    await expect(guard.canActivate(refreshCtx(token))).rejects.toThrow('Session revoked');
  });

  it('EXPIRED token → 401 (an expired session cannot mint its own successor)', async () => {
    const token = jwt.sign(
      { sub: 'u1', role: 'SCHOOL_ADMIN', tenantId: 't1' },
      { expiresIn: '-10s' },
    );
    const redis = {
      sismember: jest.fn(async () => false),
      getTokenInvalidBefore: jest.fn(async () => null),
    };
    const guard = new JwtAuthGuard(jwt, redis as any);
    await expect(guard.canActivate(refreshCtx(token))).rejects.toThrow(
      'Invalid or expired authentication token',
    );
  });
});

// ─── 4. Controller endpoint — audit + machine-identity refusal ──────────────

describe('AuthController.refresh', () => {
  function makeController(refreshResult?: any, auditRejects = false) {
    const refreshSession = jest.fn(async () => {
      if (!refreshResult) throw new UnauthorizedException({ code: 'AUTH_REFRESH_INVALID_SESSION' });
      return refreshResult;
    });
    const auditCreate = jest.fn(async () => {
      if (auditRejects) throw new Error('db down');
      return {};
    });
    const prisma = { client: { auditLog: { create: auditCreate } } };
    const controller = new AuthController(
      { refreshSession } as any,
      {} as any,
      prisma as any,
    );
    return { controller, refreshSession, auditCreate };
  }

  const okResult = {
    access_token: 'fresh_token',
    rememberClass: false,
    user: { id: 'u1', tenantId: 't1', email: 'op@acme.edu', role: 'SCHOOL_ADMIN' },
  };

  function reqFor(user: any) {
    return {
      headers: { authorization: 'Bearer current.tok.x', 'user-agent': 'jest' },
      user,
      ip: '127.0.0.1',
    } as any;
  }

  it('returns login-shaped { access_token, user } and writes an AUTH_TOKEN_REFRESH audit row', async () => {
    const { controller, refreshSession, auditCreate } = makeController(okResult);
    const res = await controller.refresh(reqFor({ userId: 'u1', tenantId: 't1' }));
    expect(refreshSession).toHaveBeenCalledWith('u1', 'current.tok.x');
    expect(res).toEqual({ access_token: 'fresh_token', user: okResult.user });
    // rememberClass is internal — never leaks into the response.
    expect((res as any).rememberClass).toBeUndefined();
    expect(auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: 't1',
        userId: 'u1',
        action: 'AUTH_TOKEN_REFRESH',
        targetType: 'User',
        targetId: 'u1',
      }),
    });
  });

  it('a failed audit write never fails the refresh (best-effort, §16 pattern)', async () => {
    const { controller } = makeController(okResult, true);
    await expect(
      controller.refresh(reqFor({ userId: 'u1', tenantId: 't1' })),
    ).resolves.toMatchObject({ access_token: 'fresh_token' });
  });

  it('refuses API-key and device identities (machine credentials never slide)', async () => {
    const { controller, refreshSession } = makeController(okResult);
    await expect(
      controller.refresh(reqFor({ userId: null, id: null, kind: 'api-key', tenantId: 't1' })),
    ).rejects.toThrow(UnauthorizedException);
    await expect(
      controller.refresh(reqFor({ id: 'screen-1', kind: 'device', tenantId: 't1' })),
    ).rejects.toThrow(UnauthorizedException);
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('no bearer token → 401 without touching the service', async () => {
    const { controller, refreshSession } = makeController(okResult);
    await expect(
      controller.refresh({ headers: {}, user: { userId: 'u1' } } as any),
    ).rejects.toThrow('No bearer token');
    expect(refreshSession).not.toHaveBeenCalled();
  });
});
