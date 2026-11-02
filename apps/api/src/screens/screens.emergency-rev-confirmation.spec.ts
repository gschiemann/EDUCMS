/**
 * GET /api/v1/screens/:id/emergency-rev signs ONLY what the database confirms
 * (2026-11-01, emergency-rev.ts rule 6) — through the real controller, the
 * real device auth and the real signer call, and end to end against the real
 * trigger + the real manifest.
 *
 * Before this, a value planted in Redis (`venueos:emrev:t:<tenant>`, written
 * by anyone holding REDIS_URL — which was in the 2026-10-21 Railway
 * environment leak) came back from this endpoint as a correctly HMAC-signed
 * OVERRIDE for every screen of that tenant. The pure rule is pinned in
 * emergency-rev-confirm.spec.ts; this file proves the wiring:
 *
 *   1. a planted descriptor with no alert in the database is never signed,
 *      and `active` still sends the player to the manifest;
 *   2. a real alert is signed exactly as before (drill flag included);
 *   3. the 304 hot path still never touches Postgres, alert or not;
 *   4. an unreadable database costs the descriptor, never the response;
 *   5. a forgery signal mails the owner and writes one audit row, after the
 *      response and at most once per tenant per hour; a refusal of a
 *      descriptor this process minted (the trigger's own pre-commit window)
 *      is logged and nothing more;
 *   6. the confirmation and the manifest read the tenant the same way, so the
 *      rev poll can only sign what the next manifest asserts — live, drill,
 *      inherited from the district, and none;
 *   7. the writer order: the trigger bumps the epoch BEFORE its transaction
 *      commits; a poll in that window is refused (and is not a forgery
 *      signal) and the first poll after the commit is confirmed.
 */

import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import {
  TENANT_EPOCH_REDIS_PREFIX,
  bumpTenantEmergencyEpoch,
  localTenantEmergencyEpoch,
  noteScreenEmergencyState,
  resetEmergencyRevForTests,
  type EmergencyAlertDescriptor,
} from './emergency-rev';
import { confirmTenantWideAlert } from './tenant-emergency-state';
import { invalidateDeviceCredentialCache, setDeviceCredentialSharedStore } from './device-auth';
import { invalidateTenantState, resetManifestCacheForTests } from './manifest-hot-cache';
import { DISTRICT, SCHOOL, districtAdmin, makeWorld, schoolAdmin } from '../emergency/emergency.targeting.world';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const SCREEN_A = 'screen-a';
const TENANT_A = 'tenant-a';

/** What `triggerEmergency` mints for a tenant-scoped live lockdown. */
const MINTED_LOCKDOWN: EmergencyAlertDescriptor = {
  type: 'lockdown',
  severity: 'CRITICAL',
  scopeNote: null,
  scope: 'tenant',
  expiresAt: null,
};

const flush = async () => {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
};

// ── harness (same shapes as emergency-rev.spec.ts) ───────────────────────

function deviceToken(screenId: string): string {
  return jwt.sign({ sub: screenId, kind: 'device', ep: 0, fp: 'fp-test' }, DEVICE_JWT_SECRET, { expiresIn: '180d' });
}

function makeReq(screenId: string, ifNoneMatch?: string) {
  const headers: Record<string, string> = { authorization: `Bearer ${deviceToken(screenId)}` };
  if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;
  return { headers, ip: '10.0.0.1', socket: { remoteAddress: '10.0.0.1' } } as any;
}

function makeRes() {
  const res: any = { statusCode: null, body: undefined, headers: {} as Record<string, string> };
  res.setHeader = jest.fn((k: string, v: string) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  });
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn((payload: unknown) => {
    res.body = payload;
    return res;
  });
  res.end = jest.fn(() => res);
  return res;
}

function makeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    isConnected: () => true,
    getString: jest.fn(async (key: string) => store.get(key) ?? null),
    setString: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
      return true;
    }),
    delKey: jest.fn(async (key: string) => {
      store.delete(key);
      return true;
    }),
    sismember: jest.fn(async () => false),
    publish: jest.fn(async () => undefined),
  };
}

function plant(redis: ReturnType<typeof makeRedis>, tenantId: string, stamp: number, descriptor = MINTED_LOCKDOWN) {
  const encoded = Buffer.from(JSON.stringify(descriptor), 'utf8').toString('base64url');
  redis.store.set(`${TENANT_EPOCH_REDIS_PREFIX}${tenantId}`, `${Math.floor(stamp)}:1:${encoded}`);
}

const LIVE_ROW = {
  id: SCREEN_A,
  tenantId: TENANT_A,
  screenGroupId: null,
  status: 'ONLINE',
  credentialEpoch: 0,
  credentialEpochRotatedAt: null,
};

function tenantRow(extra: Record<string, unknown> = {}) {
  return {
    id: TENANT_A,
    parentId: null,
    archivedAt: null,
    emergencyStatus: 'INACTIVE',
    emergencyType: null,
    emergencyPlaylistId: null,
    emergencyPortraitPlaylistId: null,
    emergencyIsDrill: false,
    locationBasedEmergencyEnabled: false,
    ...extra,
  };
}

function makeEndpoint(opts: { tenant?: Record<string, unknown> } = {}) {
  const redis = makeRedis();
  const tenants = new Map<string, Record<string, unknown>>([[TENANT_A, tenantRow(opts.tenant)]]);
  const screenFindUnique = jest.fn(async () => LIVE_ROW);
  const tenantFindUnique = jest.fn(async ({ where }: any) => {
    const t = tenants.get(where.id);
    return t ? { ...t } : null;
  });
  const auditCreate = jest.fn(async ({ data }: any) => data);
  const prisma = {
    client: {
      screen: { findUnique: screenFindUnique },
      tenant: { findUnique: tenantFindUnique },
      auditLog: { create: auditCreate },
    },
  } as any;
  let n = 0;
  const signer = {
    signMessage: jest.fn((type: string, payload: any) => ({
      type,
      payload,
      eventId: `evt-${++n}`,
      timestamp: Date.now(),
      signature: 'sig',
    })),
  };
  const mailer = { sendAlert: jest.fn(async () => undefined) };
  const controller = new ScreensController(
    prisma,
    redis as any,
    signer as any,
    {} as any,
    {} as any,
    {} as any,
    undefined,
    mailer as any,
  );
  return { controller, redis, tenants, screenFindUnique, tenantFindUnique, auditCreate, signer, mailer };
}

async function poll(e: ReturnType<typeof makeEndpoint>, ifNoneMatch?: string) {
  clearRateFloor();
  const res = makeRes();
  await e.controller.getEmergencyRev(SCREEN_A, makeReq(SCREEN_A, ifNoneMatch), res);
  return res;
}

function clearRateFloor(): void {
  (ScreensController as unknown as { emergencyRevLastServed: Map<string, number> }).emergencyRevLastServed.clear();
}

let warn: jest.SpyInstance;

beforeEach(() => {
  resetEmergencyRevForTests('origin-confirmation');
  resetManifestCacheForTests();
  invalidateDeviceCredentialCache();
  setDeviceCredentialSharedStore(null);
  clearRateFloor();
  delete process.env.EMERGENCY_REV_RAISE;
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  setDeviceCredentialSharedStore(null);
  warn.mockRestore();
});

// ── 1–5: the endpoint ────────────────────────────────────────────────────

describe('GET /screens/:id/emergency-rev — signs only what the database confirms', () => {
  it('a descriptor PLANTED in Redis with no alert in the database is never signed; `active` still sends the player to the manifest', async () => {
    const e = makeEndpoint(); // the tenant row is INACTIVE
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });
    plant(e.redis, TENANT_A, Date.now() - 120_000);

    // The attack is "repeatedly": every poll asks again, none is signed.
    for (let i = 0; i < 3; i++) {
      const res = await poll(e);
      expect(res.statusCode).toBe(200);
      expect(res.body.active).toBe(true);
      expect(res.body).not.toHaveProperty('alert');
    }
    expect(e.signer.signMessage).not.toHaveBeenCalled();
    expect(e.tenantFindUnique).toHaveBeenCalled(); // the confirmation read happened
  });

  it('a real tenant-wide alert the database confirms is signed exactly as before', async () => {
    const e = makeEndpoint({ tenant: { emergencyStatus: 'CRITICAL', emergencyType: 'LOCKDOWN' } });
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });
    bumpTenantEmergencyEpoch({ redis: e.redis as any }, TENANT_A, { active: true, alert: MINTED_LOCKDOWN });

    const res = await poll(e);

    expect(res.statusCode).toBe(200);
    expect(res.body.active).toBe(true);
    expect(e.signer.signMessage).toHaveBeenCalledTimes(1);
    const [type, payload] = e.signer.signMessage.mock.calls[0];
    expect(type).toBe('OVERRIDE');
    // The payload the player has always received from this path, key for key.
    expect(payload).toEqual({
      type: 'lockdown',
      severity: 'CRITICAL',
      scopeNote: null,
      scope: 'tenant',
      expiresAt: null,
      active: true,
      screenId: SCREEN_A,
      via: 'emergency-rev',
    });
    expect(res.body.alert).toEqual(e.signer.signMessage.mock.results[0].value);
  });

  it('a confirmed DRILL is signed with its drill flag', async () => {
    const e = makeEndpoint({ tenant: { emergencyStatus: 'CRITICAL', emergencyType: 'LOCKDOWN', emergencyIsDrill: true } });
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });
    bumpTenantEmergencyEpoch({ redis: e.redis as any }, TENANT_A, {
      active: true,
      alert: { ...MINTED_LOCKDOWN, isDrill: true },
    });

    const res = await poll(e);

    expect(e.signer.signMessage.mock.calls[0][1]).toMatchObject({ type: 'lockdown', isDrill: true, via: 'emergency-rev' });
    expect(res.body.alert.payload.isDrill).toBe(true);
  });

  it('the 304 hot path still performs ZERO Postgres reads — even while an alert is up and not yet applied', async () => {
    const e = makeEndpoint({ tenant: { emergencyStatus: 'CRITICAL', emergencyType: 'LOCKDOWN' } });
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });
    bumpTenantEmergencyEpoch({ redis: e.redis as any }, TENANT_A, { active: true, alert: MINTED_LOCKDOWN });

    const first = await poll(e);
    expect(first.statusCode).toBe(200);
    const rev = first.body.rev;

    // Cold confirmation cache (and cold tenant-state cache): nothing warm may
    // mask a read on the way to the 304. The revision does not depend on it.
    invalidateTenantState(TENANT_A);
    e.tenantFindUnique.mockClear();
    e.screenFindUnique.mockClear();
    const unchanged = await poll(e, rev);

    expect(unchanged.statusCode).toBe(304);
    expect(e.tenantFindUnique).not.toHaveBeenCalled();
    expect(e.screenFindUnique).not.toHaveBeenCalled();
  });

  it('a database that cannot be read costs the descriptor, never the response', async () => {
    const e = makeEndpoint();
    e.tenantFindUnique.mockRejectedValue(new Error('P1001: Can\'t reach database server'));
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });
    bumpTenantEmergencyEpoch({ redis: e.redis as any }, TENANT_A, { active: true, alert: MINTED_LOCKDOWN });

    const res = await poll(e);

    expect(res.statusCode).toBe(200);
    expect(res.body.active).toBe(true);
    expect(res.body).not.toHaveProperty('alert');
    expect(e.signer.signMessage).not.toHaveBeenCalled();
    await flush();
    expect(e.mailer.sendAlert).not.toHaveBeenCalled(); // an unknown is not a forgery signal
  });

  it('a forgery signal mails the owner and writes one audit row — AFTER the response, once per tenant per hour', async () => {
    const e = makeEndpoint();
    // A mail that never completes must not hold the poll.
    e.mailer.sendAlert.mockImplementation(() => new Promise<undefined>(() => undefined));
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });
    plant(e.redis, TENANT_A, Date.now() - 120_000);

    const res = await poll(e);
    expect(res.statusCode).toBe(200);
    // Nothing slow ran on the request path.
    expect(e.mailer.sendAlert).not.toHaveBeenCalled();
    expect(e.auditCreate).not.toHaveBeenCalled();

    await flush();
    expect(e.mailer.sendAlert).toHaveBeenCalledTimes(1);
    const [subject, body, kind] = e.mailer.sendAlert.mock.calls[0] as unknown as [string, string, string];
    expect(kind).toBe('emergency-rev-descriptor-refused');
    expect(subject).toContain(TENANT_A);
    expect(body).toContain(`venueos:emrev:t:${TENANT_A}`);

    expect(e.auditCreate).toHaveBeenCalledTimes(1);
    const row = e.auditCreate.mock.calls[0][0].data;
    expect(row).toMatchObject({
      tenantId: TENANT_A,
      userId: null,
      action: 'EMERGENCY_REV_DESCRIPTOR_REFUSED',
      targetType: 'tenant',
      targetId: TENANT_A,
    });
    expect(JSON.parse(row.details)).toMatchObject({
      reason: 'no-alert',
      source: 'redis',
      descriptor: { type: 'lockdown', severity: 'CRITICAL', isDrill: false },
      database: null,
      screenId: SCREEN_A,
    });
    expect(warn.mock.calls.some((c) => String(c[0]).startsWith('[emergency-rev] descriptor refused: not confirmed by the database'))).toBe(true);

    // The plant keeps being asked about; the owner is not mailed again.
    await poll(e);
    await poll(e);
    await flush();
    expect(e.mailer.sendAlert).toHaveBeenCalledTimes(1);
    expect(e.auditCreate).toHaveBeenCalledTimes(1);
  });

  it('a mailer that throws and an audit write that rejects never fail the poll', async () => {
    const e = makeEndpoint();
    e.mailer.sendAlert.mockImplementation(() => {
      throw new Error('resend down');
    });
    e.auditCreate.mockRejectedValue(new Error('append-only trigger said no'));
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });
    plant(e.redis, TENANT_A, Date.now() - 120_000);

    const res = await poll(e);
    expect(res.statusCode).toBe(200);
    await flush();
    expect(e.mailer.sendAlert).toHaveBeenCalledTimes(1);
    expect(e.auditCreate).toHaveBeenCalledTimes(1);
  });

  it("a refusal of a descriptor THIS process minted (the trigger's pre-commit window) is logged, never mailed", async () => {
    const e = makeEndpoint(); // the row is still INACTIVE: the trigger has not committed
    noteScreenEmergencyState(SCREEN_A, { tenantId: TENANT_A, sig: 'calm', active: false });
    bumpTenantEmergencyEpoch({ redis: e.redis as any }, TENANT_A, { active: true, alert: MINTED_LOCKDOWN });

    const res = await poll(e);
    expect(res.body.active).toBe(true);
    expect(res.body).not.toHaveProperty('alert');
    await flush();
    expect(e.mailer.sendAlert).not.toHaveBeenCalled();
    expect(e.auditCreate).not.toHaveBeenCalled();
    const line = warn.mock.calls.map((c) => String(c[0])).find((l) => l.startsWith('[emergency-rev] descriptor refused'));
    expect(line).toContain('source=local');
    expect(line).toContain('forgery-signal=no');
  });
});

// ── 6–7: the real trigger and the real manifest ──────────────────────────

const live = (scopeId: string) =>
  ({ scopeType: 'tenant', scopeId, overridePayload: { type: 'lockdown', severity: 'CRITICAL' } }) as any;
const drill = (scopeId: string) =>
  ({ scopeType: 'tenant', scopeId, overridePayload: { type: 'lockdown', severity: 'CRITICAL', isDrill: true } }) as any;

/** The manifest's tenant-wide alert, in the confirmation's terms. */
const manifestFacts = (m: any) => ({ type: m.emergencyType, severity: m.emergencySeverity, isDrill: m.isDrill === true });

describe('the confirmation and the manifest can never disagree (real trigger, real manifest)', () => {
  beforeEach(() => {
    for (const id of [DISTRICT, SCHOOL, 'sibling', 'other']) invalidateTenantState(id);
  });

  it('a live tenant lockdown: the database answer IS what the manifest emits, and the confirmed rev raises it', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live(SCHOOL), schoolAdmin);

    const r = await w.rev('lobby'); // before lobby's own manifest build
    expect(r.alert).toEqual(MINTED_LOCKDOWN);

    const facts = await confirmTenantWideAlert(w.client.tenant, SCHOOL);
    const m = await w.manifest('lobby');
    expect(m).toMatchObject({ isEmergency: true, emergencyScope: 'tenant' });
    expect(facts).toEqual(manifestFacts(m));
    expect(facts).toEqual({ type: 'LOCKDOWN', severity: 'CRITICAL', isDrill: false });
  });

  it('a drill: same, with the drill flag on both', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(drill(SCHOOL), schoolAdmin);

    expect((await w.rev('office')).alert).toEqual({ ...MINTED_LOCKDOWN, isDrill: true });
    const facts = await confirmTenantWideAlert(w.client.tenant, SCHOOL);
    expect(facts).toEqual(manifestFacts(await w.manifest('office')));
    expect(facts?.isDrill).toBe(true);
  });

  it('an alert INHERITED from the district (the school row reset out of band): both inherit it', async () => {
    const w = makeWorld();
    await w.emergency.triggerEmergency(live(DISTRICT), districtAdmin);
    Object.assign(w.tenants.get(SCHOOL)!, { emergencyStatus: 'INACTIVE', emergencyType: null, emergencyIsDrill: false });
    invalidateTenantState(SCHOOL);

    const m = await w.manifest('lobby');
    expect(m.emergencyInheritedFromTenantId).toBe(DISTRICT);
    expect(await confirmTenantWideAlert(w.client.tenant, SCHOOL)).toEqual(manifestFacts(m));
    // The school's epoch still carries the district trigger's descriptor; the
    // inherited database answer confirms it.
    expect((await w.rev('office')).alert).toEqual(MINTED_LOCKDOWN);
  });

  it('no alert anywhere: the database says none and the manifest says none', async () => {
    const w = makeWorld();
    expect(await confirmTenantWideAlert(w.client.tenant, SCHOOL)).toBeNull();
    expect(await w.isEmergency('lobby')).toBe(false);
  });

  it('a Redis plant for a school with no alert: refused, a forgery signal, and the manifest agrees there is no alert', async () => {
    const w = makeWorld();
    const encoded = Buffer.from(JSON.stringify(MINTED_LOCKDOWN), 'utf8').toString('base64url');
    const planted = `${Date.now() - 120_000}:1:${encoded}`;
    w.redis.getString.mockImplementation(async (key: string) =>
      key === `${TENANT_EPOCH_REDIS_PREFIX}${SCHOOL}` ? planted : null,
    );

    const r = await w.rev('lobby');

    expect(r.active).toBe(true);
    expect(r.alert).toBeNull();
    expect(w.revRefusals[0]).toMatchObject({ origin: 'redis', reason: 'no-alert', forgerySignal: true, notifyOwner: true });
    expect(await w.isEmergency('lobby')).toBe(false);
  });

  it('WRITER ORDER: the trigger bumps the epoch before its commit — refused inside that window, confirmed on the first poll after', async () => {
    const w = makeWorld();
    // Hold the trigger right after its epoch bump + fan-out, before any of its
    // writes: its first select-less tenant read (the root tenant info) is the
    // step after the bump. The confirmation's own reads carry a `select` and
    // pass straight through, so the database is readable and says INACTIVE.
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const plainFindUnique = w.client.tenant.findUnique.getMockImplementation()!;
    let held = false;
    w.client.tenant.findUnique.mockImplementation(async (args: any) => {
      if (!args?.select && !held) {
        held = true;
        await gate;
      }
      return plainFindUnique(args);
    });

    const pending = w.emergency.triggerEmergency(live(SCHOOL), schoolAdmin);
    for (let i = 0; i < 100 && !held; i++) await new Promise((r) => setImmediate(r));
    expect(held).toBe(true);

    // The epoch already says LOCKDOWN; the database does not, yet.
    expect(localTenantEmergencyEpoch(SCHOOL)).toMatchObject({ active: true, alert: MINTED_LOCKDOWN });
    expect(w.tenants.get(SCHOOL)!.emergencyStatus).toBe('INACTIVE');

    const inWindow = await w.rev('lobby');
    expect(inWindow.active).toBe(true); // the player still fetches the manifest
    expect(inWindow.alert).toBeNull(); // …but nothing unconfirmed is offered for signing
    expect(w.revRefusals[0]).toMatchObject({ origin: 'local', reason: 'no-alert', forgerySignal: false, notifyOwner: false });

    release();
    await pending;
    expect(w.tenants.get(SCHOOL)!.emergencyStatus).toBe('CRITICAL');

    // Well inside the 500 ms negative window: the trigger's post-commit
    // invalidation is what lets this poll re-read and confirm at once.
    const afterCommit = await w.rev('office');
    expect(afterCommit.alert).toEqual(MINTED_LOCKDOWN);
  });
});
