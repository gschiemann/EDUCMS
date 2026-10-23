/**
 * A prior device token signed by a RETIRED `DEVICE_JWT_SECRET` (2026-10-23).
 *
 * THE INCIDENT. A device-secret rotation opened a key-ring window
 * (`security/key-ring.ts`: verify with the new primary, then the previous) and
 * closed it a few hours later. Paired screens hold 180-day tokens and renew
 * only when they reload or when < 14 days remain, so every screen that did not
 * reload inside the window still held a token signed by the old key. When the
 * window closed, their manifest 401'd and the WebSocket said AUTH_FAIL, and the
 * player did exactly what it is built to do: re-register with that token as
 * `priorDeviceToken`. The server answered every one of those registers with a
 * hard `401 SCREEN_TOKEN_MISMATCH`, because `verifyPriorToken` sorted every
 * verification error that was not `TokenExpiredError` into `'invalid'` —
 * "wrong screen or tampered". A token signed by a key we no longer hold is
 * neither. So the documented fallback — a 1-hour unproven token +
 * `requiresRePair`, which keeps content and alerts flowing while the dashboard
 * says "re-pair required" — was unreachable, the player kept presenting the
 * same dead token once a minute forever, and the screens stayed dark.
 *
 * THE RULE THESE TESTS PIN. A prior token that (a) is shaped like a device
 * token we mint — HS256, `kind: 'device'`, naming THIS screen — but (b) whose
 * signature no key we hold can verify, is graded `'unverifiable'` and treated
 * exactly like an ABSENT prior: a 1-hour bootstrap credential, `requiresRePair`,
 * no epoch rotation, a `SCREEN_TOKEN_DOWNGRADED` audit row. It is never proof
 * of possession, never upgraded, never verified with a retired key. Knowing the
 * fingerprint already buys that same 1-hour token by sending no prior at all,
 * so this grants nothing new; DEVAUTH-01 and DT-04 hold. Anything else that
 * fails verification — a token for another screen, a different algorithm, a
 * malformed blob — stays a hard 401.
 */

import * as jwt from 'jsonwebtoken';
import { ScreensController, _registerFpCooldown } from './screens.controller';
import { keyIdOf } from '../security/key-ring';

const NEW_KEY = 'retired_key_spec_new_primary_0123456789abcdef0123456789abcdef';
const OLD_KEY = 'retired_key_spec_old_retired_0123456789abcdef0123456789abcdef';
const UNRELATED =
  'retired_key_spec_unrelated_00123456789abcdef0123456789abcdef';
const SCREEN = 'screen-retired-001';
const OTHER_SCREEN = 'screen-retired-999';
const FP = 'fp-retired-001';
const HOUR_S = 60 * 60;
const DAY_S = 24 * HOUR_S;

const VARS = [
  'NODE_ENV',
  'DEVICE_JWT_SECRET',
  'DEVICE_JWT_SECRET_PREVIOUS',
] as const;
const saved: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of VARS) saved[k] = process.env[k];
  process.env.NODE_ENV = 'test';
  process.env.DEVICE_JWT_SECRET = NEW_KEY;
});
afterAll(() => {
  for (const k of VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
beforeEach(() => {
  jest.clearAllMocks();
  _registerFpCooldown.clear();
  // Default: the window is CLOSED — the state the incident screens met.
  delete process.env.DEVICE_JWT_SECRET_PREVIOUS;
});

type Row = {
  id: string;
  deviceFingerprint: string;
  pairingCode: null;
  tenantId: string;
  status: string;
  name: string;
  credentialEpoch: number;
  credentialEpochRotatedAt: Date | null;
  authState: string | null;
  resolution: null;
  osInfo: null;
  browserInfo: null;
  userAgent: null;
};

/** One stateful screen row: register reads it, rotation and verdicts write it. */
function setup(row: Partial<Row> = {}) {
  const state: Row = {
    id: SCREEN,
    deviceFingerprint: FP,
    pairingCode: null,
    tenantId: 'tenant-retired',
    status: 'ONLINE',
    name: 'Retired key spec screen',
    credentialEpoch: 3,
    credentialEpochRotatedAt: new Date(Date.now() - 30 * DAY_S * 1000),
    authState: 'PROVEN',
    resolution: null,
    osInfo: null,
    browserInfo: null,
    userAgent: null,
    ...row,
  };
  const audit: Array<Record<string, unknown>> = [];
  type UpdateData = {
    credentialEpoch?: { increment: number };
    credentialEpochRotatedAt?: Date;
    authState?: string;
    status?: string;
  };
  const prisma = {
    client: {
      screen: {
        findUnique: jest.fn(() => Promise.resolve({ ...state })),
        update: jest.fn(({ data }: { data: UpdateData }) => {
          if (data.credentialEpoch?.increment) {
            state.credentialEpoch += data.credentialEpoch.increment;
            state.credentialEpochRotatedAt =
              data.credentialEpochRotatedAt ?? null;
            return Promise.resolve({ credentialEpoch: state.credentialEpoch });
          }
          if (data.authState !== undefined) state.authState = data.authState;
          if (data.status !== undefined) state.status = data.status;
          return Promise.resolve({ ...state });
        }),
      },
      auditLog: {
        create: jest.fn(
          ({ data }: { data: { action: string; details: string } }) => {
            audit.push({
              action: data.action,
              ...(JSON.parse(data.details) as Record<string, unknown>),
            });
            return Promise.resolve({});
          },
        ),
      },
      screenEvent: { create: jest.fn().mockResolvedValue({}) },
    },
  };
  Object.assign(prisma.client, {
    $transaction: jest.fn((fn: (tx: any) => Promise<unknown>) =>
      fn(prisma.client),
    ),
    $queryRaw: jest.fn().mockResolvedValue([{ id: SCREEN }]),
  });
  const controller = new ScreensController(
    ...([
      prisma,
      { publish: jest.fn() },
      { signMessage: jest.fn() },
      { assertSeatAvailable: jest.fn() },
      {},
      {},
    ] as unknown as ConstructorParameters<typeof ScreensController>),
  );
  const register = async (prior?: string) => {
    const res = (await controller.register(
      { deviceFingerprint: FP, ...(prior ? { priorDeviceToken: prior } : {}) },
      {
        ip: '10.0.0.1',
        socket: { remoteAddress: '10.0.0.1' },
        headers: {},
      } as unknown as Parameters<ScreensController['register']>[1],
    )) as {
      deviceToken: string;
      requiresRePair?: boolean;
      paired: boolean;
      screenId: string;
    };
    await new Promise((resolve) => setImmediate(resolve));
    return res;
  };
  return { state, audit, prisma, register };
}

/** A paired screen's token as the API mints it (180 d, HS256, epoch claim). */
function mintUnder(
  key: string,
  claims: Record<string, unknown> = {},
  opts: jwt.SignOptions = { expiresIn: '180d' },
): string {
  return jwt.sign(
    {
      sub: SCREEN,
      deviceId: SCREEN,
      kind: 'device',
      tenantId: 'tenant-retired',
      ep: 3,
      ...claims,
    },
    key,
    { algorithm: 'HS256', ...opts },
  );
}

const ttlSeconds = (token: string) => {
  const d = jwt.decode(token) as { iat: number; exp: number };
  return d.exp - d.iat;
};
const claimsOf = (token: string) =>
  jwt.decode(token) as Record<string, unknown>;

describe('register with a prior signed by a RETIRED key (window closed)', () => {
  it('lands on the 1-hour unproven credential + requiresRePair — never a 401', async () => {
    const t = setup();
    const retired = mintUnder(OLD_KEY);

    const res = await t.register(retired);

    expect(res.paired).toBe(true);
    expect(res.screenId).toBe(SCREEN);
    expect(res.requiresRePair).toBe(true);
    expect(ttlSeconds(res.deviceToken)).toBeLessThanOrEqual(HOUR_S + 30);
    expect(ttlSeconds(res.deviceToken)).toBeGreaterThan(0);
  });

  it('the new credential is minted on the CURRENT primary and is a bootstrap (unproven) credential', async () => {
    const t = setup();
    const res = await t.register(mintUnder(OLD_KEY));

    // Verifies with the new primary ALONE — no window needed afterwards.
    const decoded = jwt.verify(res.deviceToken, NEW_KEY, {
      algorithms: ['HS256'],
    }) as Record<string, unknown>;
    expect(decoded.sub).toBe(SCREEN);
    expect(decoded.kind).toBe('device');
    // DEVAUTH-01 / SEC-001: fingerprint-grade, so marked on both axes and tenantless.
    expect(decoded.unproven).toBe(true);
    expect(decoded.aud).toBe('venueos:device-bootstrap');
    expect(decoded.tenantId).toBeUndefined();
    // Minted at the LIVE epoch — a downgrade never rotates.
    expect(decoded.ep).toBe(3);
    // The retired key never signs anything again.
    expect(() =>
      jwt.verify(res.deviceToken, OLD_KEY, { algorithms: ['HS256'] }),
    ).toThrow();
  });

  it('never rotates the epoch, stamps REPAIR_REQUIRED, and audits the downgrade without trusting any claim', async () => {
    const t = setup();
    await t.register(mintUnder(OLD_KEY));

    expect(t.state.credentialEpoch).toBe(3);
    const rotations = (
      t.prisma.client.screen.update.mock.calls as Array<
        [{ data?: { credentialEpoch?: unknown } }]
      >
    ).filter(([arg]) => arg?.data?.credentialEpoch !== undefined);
    expect(rotations).toHaveLength(0);
    expect(t.state.authState).toBe('REPAIR_REQUIRED');
    expect(t.audit).toEqual([
      expect.objectContaining({
        action: 'SCREEN_TOKEN_DOWNGRADED',
        priorTokenStatus: 'unverifiable',
        issuedTtl: '1h',
        requiresRePair: true,
        credentialEpoch: 3,
        // Nothing from an unverifiable token is recorded as fact.
        presentedCredentialEpoch: null,
        presentedCredentialUnproven: null,
        // The issued token is on the CURRENT key, and the row says so.
        mintKeyId: keyIdOf(NEW_KEY),
      }),
    ]);
  });

  it('an EXPIRED token from the retired key is graded the same (the signature is checked before exp)', async () => {
    const t = setup();
    const expiredRetired = mintUnder(OLD_KEY, {}, { expiresIn: -60 });

    const res = await t.register(expiredRetired);

    expect(res.requiresRePair).toBe(true);
    expect(ttlSeconds(res.deviceToken)).toBeLessThanOrEqual(HOUR_S + 30);
    expect(t.audit[0]).toMatchObject({ priorTokenStatus: 'unverifiable' });
  });

  it('a token from a key we NEVER held is graded the same — we cannot tell "retired" from "unknown", and neither is proof', async () => {
    const t = setup();
    const res = await t.register(mintUnder(UNRELATED));
    expect(res.requiresRePair).toBe(true);
    expect(ttlSeconds(res.deviceToken)).toBeLessThanOrEqual(HOUR_S + 30);
    expect(claimsOf(res.deviceToken).unproven).toBe(true);
  });

  it('grants nothing a bare fingerprint does not already get', async () => {
    const withRetired = setup();
    const a = await withRetired.register(mintUnder(OLD_KEY));
    const fingerprintOnly = setup();
    const b = await fingerprintOnly.register();

    // Everything but the clock claims must be identical.
    const strip = (tok: string) => {
      const rest = { ...claimsOf(tok) };
      delete rest.iat;
      delete rest.exp;
      return rest;
    };
    expect(strip(a.deviceToken)).toEqual(strip(b.deviceToken));
    expect(ttlSeconds(a.deviceToken)).toBe(ttlSeconds(b.deviceToken));
    expect(a.requiresRePair).toBe(b.requiresRePair);
  });

  it('DEVAUTH-01: replaying the downgraded token never upgrades itself to 180 days', async () => {
    const t = setup();
    const first = await t.register(mintUnder(OLD_KEY));
    const second = await t.register(first.deviceToken);

    expect(second.requiresRePair).toBe(true);
    expect(ttlSeconds(second.deviceToken)).toBeLessThanOrEqual(HOUR_S + 30);
    expect(claimsOf(second.deviceToken).unproven).toBe(true);
    expect(t.state.credentialEpoch).toBe(3);
  });

  it("the operator's Restore trust then heals it through the EXISTING one-shot path (unproven-restorable → 180 d on the new key)", async () => {
    const t = setup();
    const downgraded = await t.register(mintUnder(OLD_KEY));

    // POST /screens/:id/restore-trust — exactly its credential writes.
    t.state.credentialEpoch += 1;
    t.state.credentialEpochRotatedAt = new Date();
    t.state.authState = 'PROVEN';

    const healed = await t.register(downgraded.deviceToken);
    expect(healed.requiresRePair).toBeUndefined();
    expect(ttlSeconds(healed.deviceToken)).toBeGreaterThan(170 * DAY_S);
    const decoded = jwt.verify(healed.deviceToken, NEW_KEY, {
      algorithms: ['HS256'],
    }) as Record<string, unknown>;
    expect(decoded.unproven).toBeUndefined();
    expect(t.audit.map((a) => a.priorTokenStatus)).toEqual([
      'unverifiable',
      'unproven-restorable',
    ]);
  });
});

describe('what stays a hard 401 (the closed set)', () => {
  it('a retired-key token naming a DIFFERENT screen', async () => {
    const t = setup();
    const other = mintUnder(OLD_KEY, {
      sub: OTHER_SCREEN,
      deviceId: OTHER_SCREEN,
    });
    await expect(t.register(other)).rejects.toMatchObject({ status: 401 });
    expect(t.audit).toHaveLength(0);
  });

  it('a retired-key token whose two subject claims disagree', async () => {
    const t = setup();
    const split = mintUnder(OLD_KEY, { deviceId: OTHER_SCREEN });
    await expect(t.register(split)).rejects.toMatchObject({ status: 401 });
  });

  it('a retired-key token that is not a device token', async () => {
    const t = setup();
    const userToken = mintUnder(OLD_KEY, {
      kind: undefined,
      role: 'SUPER_ADMIN',
    });
    await expect(t.register(userToken)).rejects.toMatchObject({ status: 401 });
  });

  it('an algorithm we do not mint (HS512), even with our own key', async () => {
    const t = setup();
    const hs512 = mintUnder(
      NEW_KEY,
      {},
      { expiresIn: '180d', algorithm: 'HS512' },
    );
    await expect(t.register(hs512)).rejects.toMatchObject({ status: 401 });
  });

  it('an unsigned (alg:none) token, with or without a signature segment', async () => {
    const t = setup();
    const b64 = (o: unknown) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const body = b64({
      sub: SCREEN,
      deviceId: SCREEN,
      kind: 'device',
      ep: 3,
      iat: now,
      exp: now + 180 * DAY_S,
    });
    const header = b64({ alg: 'none', typ: 'JWT' });
    await expect(t.register(`${header}.${body}.`)).rejects.toMatchObject({
      status: 401,
    });
    await expect(t.register(`${header}.${body}.c2ln`)).rejects.toMatchObject({
      status: 401,
    });
    // An HS256 header with the signature stripped is "tampered", not "retired".
    const hs = b64({ alg: 'HS256', typ: 'JWT' });
    await expect(t.register(`${hs}.${body}.`)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('a malformed blob', async () => {
    const t = setup();
    await expect(t.register('not.a.jwt')).rejects.toMatchObject({
      status: 401,
    });
    await expect(t.register('garbage')).rejects.toMatchObject({ status: 401 });
  });

  it('a VERIFIED token for a different screen (P5-3, unchanged)', async () => {
    const t = setup();
    const other = mintUnder(NEW_KEY, {
      sub: OTHER_SCREEN,
      deviceId: OTHER_SCREEN,
    });
    await expect(t.register(other)).rejects.toMatchObject({ status: 401 });
  });

  it('a REVOKED screen is still refused before any token is graded (403)', async () => {
    const t = setup({ status: 'REVOKED' });
    await expect(t.register(mintUnder(OLD_KEY))).rejects.toMatchObject({
      status: 403,
    });
  });
});

describe('inside the window nothing changes', () => {
  it('a retired-key prior is still PROOF while the old key is DEVICE_JWT_SECRET_PREVIOUS → 180 d on the new key', async () => {
    process.env.DEVICE_JWT_SECRET_PREVIOUS = OLD_KEY;
    const t = setup();

    const res = await t.register(mintUnder(OLD_KEY));

    expect(res.requiresRePair).toBeUndefined();
    expect(ttlSeconds(res.deviceToken)).toBeGreaterThan(170 * DAY_S);
    // Renewed onto the primary: it survives the window closing.
    expect(() =>
      jwt.verify(res.deviceToken, NEW_KEY, { algorithms: ['HS256'] }),
    ).not.toThrow();
    // …and the audit row proves it by naming the NEW key — never the one the
    // presented token was signed with. This is the fact the rotation `finish`
    // guard (scripts/rotation-renewal-guard.cjs) counts.
    expect(t.audit[0]).toMatchObject({
      action: 'SCREEN_TOKEN_RENEWED',
      priorTokenStatus: 'valid',
      mintKeyId: keyIdOf(NEW_KEY),
    });
    expect(t.audit[0].mintKeyId).not.toBe(keyIdOf(OLD_KEY));
  });

  it('a current-key prior renews exactly as before', async () => {
    const t = setup();
    const res = await t.register(mintUnder(NEW_KEY));
    expect(res.requiresRePair).toBeUndefined();
    expect(t.audit[0]).toMatchObject({
      action: 'SCREEN_TOKEN_RENEWED',
      priorTokenStatus: 'valid',
    });
  });
});
