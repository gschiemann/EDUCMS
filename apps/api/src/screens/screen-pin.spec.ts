/**
 * Screen PIN for the on-device unpair (2026-11-09, player stability gap 6).
 *
 * Covers: the PIN rules and the slow salted hash; the per-screen limiter; the
 * device-initiated unpair route across TWO tenants (PIN unset = unchanged,
 * missing / wrong / correct PIN, the lock, the rate-limited audit rows); the
 * dashboard's DELETE /screens/:id still removing a PIN-protected screen (the
 * forgotten-PIN recovery path); the admin lifecycle (set, change, clear, audit
 * rows, never the PIN or hash in a response or an audit row); and the
 * manifest flag (absent when unset).
 */
jest.mock('../security/required-secret', () => ({
  requireSecret: (_n: string, o?: { devFallback?: string }) => o?.devFallback ?? 'test_secret',
}));

import 'reflect-metadata';
import { ScreensController } from './screens.controller';
import { invalidateDeviceCredentialCache } from './device-auth';
import {
  SCREEN_PIN_ATTEMPTS_PER_LOCK,
  SCREEN_PIN_AUDIT_WINDOW_MS,
  SCREEN_PIN_FIRST_LOCK_MS,
  SCREEN_PIN_MAX_LOCK_MS,
  ScreenPinAttemptLimiter,
  hashScreenPin,
  manifestUnpairPin,
  normalizeScreenPin,
  screenPinAttempts,
  verifyScreenPin,
} from './screen-pin';
import { ScreenPinController } from '../tenants/screen-pin.controller';
import { ROLES_KEY } from '../auth/roles.decorator';

const PIN_A = '4821';
let HASH_A = '';

beforeAll(async () => {
  HASH_A = await hashScreenPin(PIN_A);
});

beforeEach(() => {
  invalidateDeviceCredentialCache();
  screenPinAttempts.reset();
});

describe('PIN rules and hashing', () => {
  it('accepts 4 to 8 ASCII digits only', () => {
    expect(normalizeScreenPin('1234')).toBe('1234');
    expect(normalizeScreenPin(' 12345678 ')).toBe('12345678');
    for (const bad of ['123', '123456789', '12a4', '', '１２３４', 1234, null, undefined, {}]) {
      expect(normalizeScreenPin(bad as any)).toBeNull();
    }
  });

  it('stores a salted Argon2id hash, never the PIN', async () => {
    const again = await hashScreenPin(PIN_A);
    expect(HASH_A.startsWith('$argon2id$')).toBe(true);
    expect(HASH_A).not.toContain(PIN_A);
    expect(again).not.toBe(HASH_A); // salted
    expect(await verifyScreenPin(HASH_A, PIN_A)).toBe(true);
    expect(await verifyScreenPin(HASH_A, '4822')).toBe(false);
  });

  it('fails closed on an absent or malformed hash', async () => {
    expect(await verifyScreenPin(null, PIN_A)).toBe(false);
    expect(await verifyScreenPin('not-a-hash', PIN_A)).toBe(false);
  });
});

describe('per-screen attempt limiter', () => {
  it('locks after five wrong PINs, doubles each lock, caps at 24 h, and a success resets it', () => {
    let now = 1_000_000;
    const lim = new ScreenPinAttemptLimiter(() => now);
    for (let i = 1; i < SCREEN_PIN_ATTEMPTS_PER_LOCK; i++) {
      expect(lim.recordFailure('s1')).toMatchObject({ locked: false, attemptsLeft: SCREEN_PIN_ATTEMPTS_PER_LOCK - i });
    }
    expect(lim.recordFailure('s1')).toMatchObject({ locked: true, lockMs: SCREEN_PIN_FIRST_LOCK_MS });
    expect(lim.check('s1').kind).toBe('locked');
    expect(lim.check('s2').kind).toBe('allowed'); // per screen
    now += SCREEN_PIN_FIRST_LOCK_MS + 1;
    expect(lim.check('s1').kind).toBe('allowed');
    for (let i = 0; i < SCREEN_PIN_ATTEMPTS_PER_LOCK - 1; i++) lim.recordFailure('s1');
    expect(lim.recordFailure('s1').lockMs).toBe(SCREEN_PIN_FIRST_LOCK_MS * 2);
    // Many more locks: capped.
    let last = 0;
    for (let n = 0; n < 12; n++) {
      now += SCREEN_PIN_MAX_LOCK_MS + 1;
      for (let i = 0; i < SCREEN_PIN_ATTEMPTS_PER_LOCK - 1; i++) lim.recordFailure('s1');
      last = lim.recordFailure('s1').lockMs;
    }
    expect(last).toBe(SCREEN_PIN_MAX_LOCK_MS);
    now += SCREEN_PIN_MAX_LOCK_MS + 1;
    lim.recordSuccess('s1');
    expect(lim.check('s1')).toEqual({ kind: 'allowed', attemptsLeft: SCREEN_PIN_ATTEMPTS_PER_LOCK });
  });

  it('allows one refusal audit row per screen per window', () => {
    let now = 5_000_000;
    const lim = new ScreenPinAttemptLimiter(() => now);
    expect(lim.shouldAuditRefusal('s1')).toBe(true);
    expect(lim.shouldAuditRefusal('s1')).toBe(false);
    expect(lim.shouldAuditRefusal('s2')).toBe(true);
    now += SCREEN_PIN_AUDIT_WINDOW_MS;
    expect(lim.shouldAuditRefusal('s1')).toBe(true);
  });
});

// ── The device-initiated unpair route ─────────────────────────────────────

interface World {
  screens: Record<string, any>;
  pins: Record<string, string>;
}

function harness(world: World) {
  const audit: any[] = [];
  const updates: any[] = [];
  const deletes: any[] = [];
  const client: any = {
    screen: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.deviceFingerprint) return Object.values(world.screens).find((s: any) => s.deviceFingerprint === where.deviceFingerprint) ?? null;
        return null; // pairing-code collision probe
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const s = world.screens[where.id];
        return s && s.tenantId === where.tenantId ? s : null;
      }),
      findMany: jest.fn(async () => []),
      update: jest.fn(async (args: any) => { updates.push(args); return { ...world.screens[args.where.id], ...args.data }; }),
      delete: jest.fn(async (args: any) => { deletes.push(args); return {}; }),
    },
    schedule: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    tenantScreenPin: {
      findUnique: jest.fn(async ({ where }: any) => (world.pins[where.tenantId] ? { pinHash: world.pins[where.tenantId] } : null)),
    },
    auditLog: { create: jest.fn(async (args: any) => { audit.push(args.data); return {}; }) },
  };
  client.$transaction = jest.fn(async (fn: any) => fn(client));
  const prisma: any = { client };
  const redis: any = { publish: jest.fn(), sismember: jest.fn().mockResolvedValue(false), mirrorRevokedTokenDurable: jest.fn().mockResolvedValue(undefined) };
  const controller = new ScreensController(prisma, redis, {} as any, {} as any, { syncSubscriptionQuantity: jest.fn().mockResolvedValue(undefined) } as any, {} as any);
  // Device auth is its own, separately tested gate (device-auth.spec.ts):
  // here the caller IS the screen's device.
  (controller as any).deviceAuth = jest.fn(async () => ({ ok: true, token: 'tok' }));
  (controller as any).notifySync = jest.fn();
  return { controller, prisma, audit, updates, deletes };
}

const screenRow = (id: string, tenantId: string | null) => ({
  id, tenantId, name: `Hall ${id}`, deviceFingerprint: `fp-${id}`, pairingCode: 'ABC123', credentialEpoch: 1,
});

function world(): World {
  return {
    screens: { a1: screenRow('a1', 'tenant-a'), b1: screenRow('b1', 'tenant-b') },
    pins: { 'tenant-a': HASH_A },
  };
}

const req = (ip = '10.0.0.9') => ({ ip, headers: {} }) as any;

async function refusal(p: Promise<unknown>) {
  try {
    await p;
  } catch (e: any) {
    return { status: e.getStatus(), body: e.getResponse() };
  }
  throw new Error('expected a refusal');
}

describe('POST /screens/unpair/:fp — device-initiated, PIN-gated', () => {
  it('PIN UNSET (tenant B): unchanged — unpairs with no body at all, no extra audit row', async () => {
    const h = harness(world());
    const res = await h.controller.deviceInitiatedUnpair('fp-b1', req());
    expect(res).toMatchObject({ ok: true, screenId: 'b1' });
    expect(h.updates[0].data).toMatchObject({ tenantId: null, status: 'PENDING' });
    expect(h.audit.map((a) => a.action)).toEqual(['SCREEN_UNPAIRED_BY_DEVICE']);
  });

  it('PIN UNSET: a stray pin in the body changes nothing', async () => {
    const h = harness(world());
    await expect(h.controller.deviceInitiatedUnpair('fp-b1', req(), { pin: '0000' })).resolves.toMatchObject({ ok: true });
  });

  it('an already-unpaired screen stays idempotent even in a PIN tenant world', async () => {
    const w = world();
    w.screens.a1.tenantId = null;
    const h = harness(w);
    await expect(h.controller.deviceInitiatedUnpair('fp-a1', req())).resolves.toMatchObject({ ok: true });
  });

  it('PIN SET (tenant A), no PIN sent: 403 SCREEN_UNPAIR_PIN_REQUIRED, nothing written, one audit row', async () => {
    const h = harness(world());
    const r = await refusal(h.controller.deviceInitiatedUnpair('fp-a1', req()));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'SCREEN_UNPAIR_PIN_REQUIRED' });
    expect(h.updates).toHaveLength(0);
    expect(h.prisma.client.schedule.deleteMany).not.toHaveBeenCalled();
    expect(h.audit).toHaveLength(1);
    expect(h.audit[0]).toMatchObject({ tenantId: 'tenant-a', action: 'SCREEN_UNPAIR_PIN_REFUSED', targetId: 'a1', userId: null });
    expect(JSON.parse(h.audit[0].details)).toMatchObject({ reason: 'missing', ip: '10.0.0.9' });
  });

  it('wrong PIN: 403 SCREEN_UNPAIR_PIN_WRONG with attempts left; never echoes the PIN or hash', async () => {
    const h = harness(world());
    const r = await refusal(h.controller.deviceInitiatedUnpair('fp-a1', req(), { pin: '9999' }));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: 'SCREEN_UNPAIR_PIN_WRONG', attemptsLeft: SCREEN_PIN_ATTEMPTS_PER_LOCK - 1 });
    const everything = JSON.stringify([r.body, h.audit]);
    expect(everything).not.toContain('9999');
    expect(everything).not.toContain(PIN_A);
    expect(everything).not.toContain('$argon2');
    expect(h.updates).toHaveLength(0);
  });

  it('correct PIN: unpairs exactly as before', async () => {
    const h = harness(world());
    const res = await h.controller.deviceInitiatedUnpair('fp-a1', req(), { pin: PIN_A });
    expect(res).toMatchObject({ ok: true, screenId: 'a1' });
    expect(h.updates[0].data).toMatchObject({ tenantId: null, credentialEpoch: { increment: 1 } });
    expect(h.audit.map((a) => a.action)).toEqual(['SCREEN_UNPAIRED_BY_DEVICE']);
  });

  it("tenant A's PIN never gates tenant B, and B's screen cannot be unpaired with A's PIN gate state", async () => {
    const h = harness(world());
    for (let i = 0; i < SCREEN_PIN_ATTEMPTS_PER_LOCK; i++) {
      await refusal(h.controller.deviceInitiatedUnpair('fp-a1', req(), { pin: '0000' }));
    }
    await expect(h.controller.deviceInitiatedUnpair('fp-b1', req())).resolves.toMatchObject({ ok: true, screenId: 'b1' });
    expect(h.prisma.client.tenantScreenPin.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'tenant-b' } }));
  });

  it('five wrong PINs lock the screen (429, retry-after); the correct PIN is refused during the lock; audit is rate-limited', async () => {
    const h = harness(world());
    for (let i = 0; i < SCREEN_PIN_ATTEMPTS_PER_LOCK - 1; i++) {
      expect((await refusal(h.controller.deviceInitiatedUnpair('fp-a1', req(), { pin: '0000' }))).status).toBe(403);
    }
    const locked = await refusal(h.controller.deviceInitiatedUnpair('fp-a1', req(), { pin: '0000' }));
    expect(locked.status).toBe(429);
    expect(locked.body).toMatchObject({ code: 'SCREEN_UNPAIR_PIN_LOCKED', retryAfterSeconds: SCREEN_PIN_FIRST_LOCK_MS / 1000 });
    const during = await refusal(h.controller.deviceInitiatedUnpair('fp-a1', req(), { pin: PIN_A }));
    expect(during.status).toBe(429);
    for (let i = 0; i < 20; i++) await refusal(h.controller.deviceInitiatedUnpair('fp-a1', req()));
    const actions = h.audit.map((a) => a.action);
    // One refusal row for the window + one row for the lock start — not 26.
    expect(actions.filter((a) => a === 'SCREEN_UNPAIR_PIN_REFUSED')).toHaveLength(1);
    expect(actions.filter((a) => a === 'SCREEN_UNPAIR_PIN_LOCKED')).toHaveLength(1);
    expect(h.updates).toHaveLength(0);
  });

  it('refuses before any write when device auth fails (unchanged 401, PIN never consulted)', async () => {
    const h = harness(world());
    (h.controller as any).deviceAuth = jest.fn(async () => ({ ok: false, reason: 'no_token' }));
    const r = await refusal(h.controller.deviceInitiatedUnpair('fp-a1', req(), { pin: PIN_A }));
    expect(r.status).toBe(401);
    expect(h.prisma.client.tenantScreenPin.findUnique).not.toHaveBeenCalled();
  });
});

describe('the dashboard unpair is never PIN-gated (the forgotten-PIN recovery path)', () => {
  it('DELETE /screens/:id removes a screen of a PIN tenant with no PIN at all', async () => {
    const h = harness(world());
    const res = await h.controller.remove({ user: { tenantId: 'tenant-a', role: 'SCHOOL_ADMIN', id: 'u1' } } as any, 'a1');
    expect(res).toEqual({ deleted: true });
    expect(h.deletes[0]).toMatchObject({ where: { id: 'a1', tenantId: 'tenant-a' } });
    expect(h.prisma.client.tenantScreenPin.findUnique).not.toHaveBeenCalled();
  });

  it('…and still cannot reach another tenant’s screen', async () => {
    const h = harness(world());
    await expect(h.controller.remove({ user: { tenantId: 'tenant-b', role: 'SCHOOL_ADMIN', id: 'u1' } } as any, 'a1')).rejects.toMatchObject({ status: 404 });
  });
});

describe('the manifest flag', () => {
  it('is ABSENT when no PIN is set (byte-identical payload) and a static true when one is', () => {
    expect(manifestUnpairPin(null)).toEqual({});
    expect(manifestUnpairPin({ screenPinSetAt: null })).toEqual({});
    expect(Object.keys({ a: 1, ...manifestUnpairPin({ screenPinSetAt: null }) })).toEqual(['a']);
    expect(manifestUnpairPin({ screenPinSetAt: new Date('2026-11-09T00:00:00Z') })).toEqual({ unpairPinRequired: true });
  });

  it('the manifest tenant projection selects the timestamp, never the hash', () => {
    const select = (ScreensController as any).MANIFEST_TENANT_SELECT;
    expect(select.screenPinSetAt).toBe(true);
    expect(JSON.stringify(select)).not.toMatch(/pinHash|pin_hash|screenPin\b/);
  });
});

// ── The admin lifecycle ───────────────────────────────────────────────────

function adminHarness() {
  const state: { pins: Record<string, any>; setAt: Record<string, Date | null>; audit: any[] } = { pins: {}, setAt: {}, audit: [] };
  const client: any = {
    tenant: {
      findUnique: jest.fn(async ({ where }: any) => ({ screenPinSetAt: state.setAt[where.id] ?? null })),
      update: jest.fn(async ({ where, data }: any) => { state.setAt[where.id] = data.screenPinSetAt; return {}; }),
    },
    tenantScreenPin: {
      findUnique: jest.fn(async ({ where }: any) => (state.pins[where.tenantId] ? { tenantId: where.tenantId } : null)),
      upsert: jest.fn(async ({ where, create, update }: any) => { state.pins[where.tenantId] = state.pins[where.tenantId] ? { ...state.pins[where.tenantId], ...update } : create; return {}; }),
      deleteMany: jest.fn(async ({ where }: any) => { const had = !!state.pins[where.tenantId]; delete state.pins[where.tenantId]; return { count: had ? 1 : 0 }; }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => { state.audit.push(data); return {}; }) },
  };
  client.$transaction = jest.fn(async (fn: any) => fn(client));
  return { controller: new ScreenPinController({ client } as any), state, client };
}

const admin = (tenantId = 'tenant-a') => ({ user: { tenantId, userId: 'u-admin', role: 'DISTRICT_ADMIN' } });

describe('tenant screen PIN — set, change, clear', () => {
  it('set → change → clear, each with its audit row, scoped to the caller’s tenant; nothing secret leaves', async () => {
    const h = adminHarness();
    expect(await h.controller.get(admin())).toEqual({ set: false, setAt: null });

    const set = await h.controller.set(admin(), { pin: '135790' });
    expect(set).toMatchObject({ ok: true, set: true, changed: false });
    expect(h.state.pins['tenant-a'].pinHash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyScreenPin(h.state.pins['tenant-a'].pinHash, '135790')).toBe(true);
    expect(h.state.setAt['tenant-a']).toBeInstanceOf(Date);

    const change = await h.controller.set(admin(), { pin: '2468' });
    expect(change).toMatchObject({ changed: true });
    expect(await verifyScreenPin(h.state.pins['tenant-a'].pinHash, '2468')).toBe(true);

    const got = await h.controller.get(admin());
    expect(got.set).toBe(true);

    const cleared = await h.controller.clear(admin());
    expect(cleared).toEqual({ ok: true, set: false, setAt: null });
    expect(h.state.pins['tenant-a']).toBeUndefined();
    expect(h.state.setAt['tenant-a']).toBeNull();

    expect(h.state.audit.map((a) => a.action)).toEqual(['SCREEN_PIN_SET', 'SCREEN_PIN_CHANGED', 'SCREEN_PIN_CLEARED']);
    for (const row of h.state.audit) expect(row).toMatchObject({ tenantId: 'tenant-a', userId: 'u-admin', targetType: 'Tenant' });

    const leaked = JSON.stringify([set, change, got, cleared, h.state.audit]);
    for (const secret of ['135790', '2468', '$argon2']) expect(leaked).not.toContain(secret);
  });

  it('touches only the caller’s tenant (two tenants)', async () => {
    const h = adminHarness();
    await h.controller.set(admin('tenant-a'), { pin: '1111' });
    await h.controller.clear(admin('tenant-b'));
    expect(h.state.pins['tenant-a']).toBeDefined();
    for (const call of h.client.tenantScreenPin.deleteMany.mock.calls) expect(call[0].where).toEqual({ tenantId: 'tenant-b' });
    // Clearing a tenant that had no PIN writes no audit row.
    expect(h.state.audit.map((a) => a.tenantId)).toEqual(['tenant-a']);
  });

  it('refuses a PIN that is not 4 to 8 digits (400), writing nothing', async () => {
    const h = adminHarness();
    for (const pin of ['12', '123456789', 'abcd', undefined]) {
      await expect(h.controller.set(admin(), { pin })).rejects.toMatchObject({ status: 400 });
    }
    expect(h.client.$transaction).not.toHaveBeenCalled();
  });

  it('writes are org-admin only; reading is admin roles only', () => {
    const roles = (m: string) => Reflect.getMetadata(ROLES_KEY, (ScreenPinController.prototype as any)[m]);
    expect(roles('set')).toEqual(['SUPER_ADMIN', 'DISTRICT_ADMIN']);
    expect(roles('clear')).toEqual(['SUPER_ADMIN', 'DISTRICT_ADMIN']);
    expect(roles('get')).toEqual(['SUPER_ADMIN', 'DISTRICT_ADMIN', 'SCHOOL_ADMIN']);
  });
});
