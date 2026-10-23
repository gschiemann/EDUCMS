/**
 * JwtAuthGuard's DEVICE leg during a DEVICE_JWT_SECRET rotation window
 * (2026-10-22, security/key-ring.ts).
 *
 * Screens hold 1-hour device tokens and renew every ~10 min. Between "deploy
 * with the new primary" and "every screen has renewed", a request carrying a
 * token minted on the OLD key must still pass the guard — or the whole fleet
 * 401s until re-pair. User tokens (JWT_SECRET) are untouched by the ring.
 */
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from './jwt-auth.guard';

const USER_SECRET = 'guard_ring_user_secret_0123456789abcdef0123456789';
const NEW_KEY = 'guard_ring_new_device_key_0123456789abcdef01234567';
const OLD_KEY = 'guard_ring_old_device_key_0123456789abcdef01234567';
const UNRELATED = 'guard_ring_unrelated_key_0123456789abcdef012345678';

const VARS = ['JWT_SECRET', 'DEVICE_JWT_SECRET', 'DEVICE_JWT_SECRET_PREVIOUS', 'NODE_ENV'] as const;
const saved: Record<string, string | undefined> = {};

function ctxFor(token: string) {
  const request = { headers: { authorization: `Bearer ${token}` }, user: undefined as any };
  return {
    request,
    ctx: { switchToHttp: () => ({ getRequest: () => request }) } as any,
  };
}

/** No revocations, no invalid-before markers. */
const redis = {
  sismember: jest.fn(async () => false),
  getTokenInvalidBefore: jest.fn(async () => null),
};

const deviceToken = (key: string) =>
  new JwtService({ secret: key }).sign({ sub: 'screen-1', deviceId: 'screen-1', kind: 'device', tenantId: 't1' }, { expiresIn: '1h' });

describe('JwtAuthGuard — device leg + DEVICE_JWT_SECRET ring', () => {
  beforeAll(() => {
    for (const k of VARS) saved[k] = process.env[k];
    process.env.NODE_ENV = 'test';
    process.env.JWT_SECRET = USER_SECRET;
    process.env.DEVICE_JWT_SECRET = NEW_KEY;
  });
  beforeEach(() => {
    delete process.env.DEVICE_JWT_SECRET_PREVIOUS;
  });
  afterAll(() => {
    for (const k of VARS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const guard = () => new JwtAuthGuard(new JwtService({ secret: USER_SECRET }), redis as any);

  it('(a) previous unset: a primary token passes, an old-key token is 401 (unchanged)', async () => {
    const ok = ctxFor(deviceToken(NEW_KEY));
    await expect(guard().canActivate(ok.ctx)).resolves.toBe(true);
    expect(ok.request.user?.sub).toBe('screen-1');
    await expect(guard().canActivate(ctxFor(deviceToken(OLD_KEY)).ctx)).rejects.toThrow(/Invalid or expired/);
  });

  it('(b) during the window: a token minted on the OLD key passes with the same identity', async () => {
    process.env.DEVICE_JWT_SECRET_PREVIOUS = OLD_KEY;
    const old = ctxFor(deviceToken(OLD_KEY));
    await expect(guard().canActivate(old.ctx)).resolves.toBe(true);
    expect(old.request.user?.sub).toBe('screen-1');
    expect(old.request.user?.kind).toBe('device');
    await expect(guard().canActivate(ctxFor(deviceToken(NEW_KEY)).ctx)).resolves.toBe(true);
  });

  it('(d) a token from an unrelated key is 401 with and without a window', async () => {
    await expect(guard().canActivate(ctxFor(deviceToken(UNRELATED)).ctx)).rejects.toThrow(/Invalid or expired/);
    process.env.DEVICE_JWT_SECRET_PREVIOUS = OLD_KEY;
    await expect(guard().canActivate(ctxFor(deviceToken(UNRELATED)).ctx)).rejects.toThrow(/Invalid or expired/);
  });

  it('the device window never widens USER token verification', async () => {
    process.env.DEVICE_JWT_SECRET_PREVIOUS = OLD_KEY;
    // A user-shaped token (no kind:'device') signed with the device previous key.
    const userShaped = new JwtService({ secret: OLD_KEY }).sign({ sub: 'user-1', role: 'SCHOOL_ADMIN', tenantId: 't1' });
    await expect(guard().canActivate(ctxFor(userShaped).ctx)).rejects.toThrow(/Invalid or expired/);
    // A real user token still passes.
    const real = new JwtService({ secret: USER_SECRET }).sign({ sub: 'user-1', role: 'SCHOOL_ADMIN', tenantId: 't1' });
    const { ctx, request } = ctxFor(real);
    await expect(guard().canActivate(ctx)).resolves.toBe(true);
    expect(request.user).toBeTruthy();
    expect(request.user?.kind).not.toBe('device');
  });
});
