/**
 * POST /screens/pair — per-user limit on wrong pairing codes (2026-11-16).
 *
 * At PAIR_FAIL_LIMIT (10) wrong codes inside 15 minutes the user's pairing is
 * refused with 429 — a correct code included — until the window lapses; the
 * failure that trips the limit writes one SCREEN_PAIRING_ATTEMPTS_LIMITED
 * audit row (never the code). Other users are unaffected; a success does not
 * reset the count; a Redis outage falls back to an in-process count.
 */
jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

import { HttpException } from '@nestjs/common';
import { ScreensController } from './screens.controller';
import {
  PAIR_FAIL_LIMIT,
  PAIR_FAIL_WINDOW_MS,
  PAIRING_TOO_MANY_ATTEMPTS,
  PairingAttemptLimiter,
} from './pairing-attempt-limiter';

const T = 'tenant-1';
const GOOD = 'GOOD42';

/** In-memory Redis with real PX expiry against an injectable clock. */
function fakeRedis(clock: () => number) {
  const store = new Map<string, { v: number; exp: number | null }>();
  const live = (k: string) => {
    const row = store.get(k);
    if (!row) return null;
    if (row.exp !== null && clock() >= row.exp) {
      store.delete(k);
      return null;
    }
    return row;
  };
  return {
    store,
    incr: jest.fn(async (k: string) => {
      const row = live(k) ?? { v: 0, exp: null };
      row.v += 1;
      store.set(k, row);
      return row.v;
    }),
    pexpire: jest.fn(async (k: string, ms: number) => {
      const row = live(k);
      if (row) row.exp = clock() + ms;
      return row ? 1 : 0;
    }),
    get: jest.fn(async (k: string) => {
      const row = live(k);
      return row ? String(row.v) : null;
    }),
    pttl: jest.fn(async (k: string) => {
      const row = live(k);
      if (!row) return -2;
      return row.exp === null ? -1 : row.exp - clock();
    }),
  };
}

function harness(publisher: unknown) {
  const unpaired = { id: 'scr-1', tenantId: null, name: 'Lobby', pairingCode: GOOD };
  const tx: any = {
    screen: { update: jest.fn(async () => ({ ...unpaired, tenantId: T, screenGroup: null })) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const prisma: any = {
    client: {
      screen: { findUnique: jest.fn(async (a: any) => (a?.where?.pairingCode === GOOD ? unpaired : null)) },
      auditLog: { create: jest.fn(async () => ({})) },
      $transaction: jest.fn(async (fn: (t: any) => unknown) => fn(tx)),
    },
  };
  const redis: any = { publisher, publish: jest.fn(async () => 1) };
  const controller = new ScreensController(
    prisma,
    redis,
    { signMessage: jest.fn(() => 'signed') } as any,
    { assertSeatAvailable: jest.fn() } as any,
    { syncSubscriptionQuantity: jest.fn(async () => undefined) } as any,
    {} as any,
  );
  return { controller, prisma };
}

const req = (userId = 'u1') => ({ user: { id: userId, userId, tenantId: T, role: 'SCHOOL_ADMIN' } }) as any;

async function statusOf(p: Promise<unknown>): Promise<{ status: number; body: any }> {
  try {
    await p;
    return { status: 200, body: null };
  } catch (e) {
    if (e instanceof HttpException) return { status: e.getStatus(), body: e.getResponse() };
    throw e;
  }
}

const limitRows = (prisma: any) =>
  prisma.client.auditLog.create.mock.calls.map((c: any) => c[0].data).filter((d: any) => d.action === 'SCREEN_PAIRING_ATTEMPTS_LIMITED');

describe('POST /screens/pair — wrong-code limit per user', () => {
  let now = Date.UTC(2026, 10, 16, 12, 0);
  beforeEach(() => {
    now = Date.UTC(2026, 10, 16, 12, 0);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it('allows 10 wrong codes (404 each), then refuses the user with 429 — a correct code included — and audits once', async () => {
    const r = fakeRedis(() => now);
    const h = harness(r);
    for (let i = 0; i < PAIR_FAIL_LIMIT; i++) {
      expect((await statusOf(h.controller.pair(req(), { pairingCode: `BAD${i}` }))).status).toBe(404);
    }
    const blocked = await statusOf(h.controller.pair(req(), { pairingCode: GOOD }));
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe(PAIRING_TOO_MANY_ATTEMPTS);
    expect(blocked.body.retryAfterSeconds).toBeGreaterThan(0);
    // The refused attempt never reached the lookup.
    expect(h.prisma.client.screen.findUnique).toHaveBeenCalledTimes(PAIR_FAIL_LIMIT);

    const rows = limitRows(h.prisma);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: T, userId: 'u1', targetType: 'User', targetId: 'u1' });
    expect(JSON.parse(rows[0].details)).toMatchObject({ failures: PAIR_FAIL_LIMIT, limit: PAIR_FAIL_LIMIT, windowMinutes: 15 });
    expect(rows[0].details).not.toContain('BAD');
    expect(rows[0].details).not.toContain(GOOD);
  });

  it('nine wrong codes still let the correct code pair', async () => {
    const h = harness(fakeRedis(() => now));
    for (let i = 0; i < PAIR_FAIL_LIMIT - 1; i++) await statusOf(h.controller.pair(req(), { pairingCode: `BAD${i}` }));
    expect((await statusOf(h.controller.pair(req(), { pairingCode: GOOD }))).status).toBe(200);
    expect(limitRows(h.prisma)).toHaveLength(0);
  });

  it('is per user: another admin of the same tenant is unaffected', async () => {
    const h = harness(fakeRedis(() => now));
    for (let i = 0; i < PAIR_FAIL_LIMIT; i++) await statusOf(h.controller.pair(req('u1'), { pairingCode: `BAD${i}` }));
    expect((await statusOf(h.controller.pair(req('u1'), { pairingCode: GOOD }))).status).toBe(429);
    expect((await statusOf(h.controller.pair(req('u2'), { pairingCode: GOOD }))).status).toBe(200);
  });

  it('a code owned by another organisation counts as a wrong code too', async () => {
    const h = harness(fakeRedis(() => now));
    h.prisma.client.screen.findUnique.mockImplementation(async () => ({ id: 'x', tenantId: 'tenant-other', name: 'X' }));
    for (let i = 0; i < PAIR_FAIL_LIMIT; i++) {
      expect((await statusOf(h.controller.pair(req(), { pairingCode: 'THEIRS' }))).status).toBe(409);
    }
    expect((await statusOf(h.controller.pair(req(), { pairingCode: 'THEIRS' }))).status).toBe(429);
  });

  it('the window lapses: after 15 minutes the user may pair again', async () => {
    const h = harness(fakeRedis(() => now));
    for (let i = 0; i < PAIR_FAIL_LIMIT; i++) await statusOf(h.controller.pair(req(), { pairingCode: `BAD${i}` }));
    expect((await statusOf(h.controller.pair(req(), { pairingCode: GOOD }))).status).toBe(429);
    now += PAIR_FAIL_WINDOW_MS + 1;
    expect((await statusOf(h.controller.pair(req(), { pairingCode: GOOD }))).status).toBe(200);
  });

  it('Redis unavailable: the limit still holds, counted in process', async () => {
    const h = harness(null);
    for (let i = 0; i < PAIR_FAIL_LIMIT; i++) await statusOf(h.controller.pair(req(), { pairingCode: `BAD${i}` }));
    expect((await statusOf(h.controller.pair(req(), { pairingCode: GOOD }))).status).toBe(429);
    expect(limitRows(h.prisma)).toHaveLength(1);
  });
});

describe('PairingAttemptLimiter', () => {
  it('a Redis error falls back to the in-process count rather than dropping the limit', async () => {
    let t = 0;
    const broken = {
      incr: jest.fn(async () => {
        throw new Error('down');
      }),
      pexpire: jest.fn(),
      get: jest.fn(async () => {
        throw new Error('down');
      }),
      pttl: jest.fn(async () => {
        throw new Error('down');
      }),
    };
    const l = new PairingAttemptLimiter(() => broken as any, () => t);
    jest.spyOn((l as any).logger, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < PAIR_FAIL_LIMIT - 1; i++) expect((await l.recordFailure('u')).tripped).toBe(false);
    await expect(l.check('u')).resolves.toBeUndefined();
    expect(await l.recordFailure('u')).toEqual({ failures: PAIR_FAIL_LIMIT, tripped: true });
    await expect(l.check('u')).rejects.toMatchObject({ status: 429 });
    t += PAIR_FAIL_WINDOW_MS;
    await expect(l.check('u')).resolves.toBeUndefined();
  });
});
