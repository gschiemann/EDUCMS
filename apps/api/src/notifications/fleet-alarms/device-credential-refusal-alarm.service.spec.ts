/**
 * The device-credential refusal alarm end to end (2026-10-23): the recorder on
 * the two refusal paths, the shared per-minute Redis sets, the leader's
 * evaluator, its Redis-held state across a leader change, and the owner emails.
 * The 2026-10-23 incident is replayed with fixtures: 14 screens at 5
 * organisations whose tokens were signed by a key the server no longer holds.
 */
import * as jwt from 'jsonwebtoken';
import { DeviceCredentialRefusalAlarmService, type RefusalAlarmTickResult } from './device-credential-refusal-alarm.service';
import { CustomerAlertEmailsService } from '../customer-alerts/customer-alert-emails.service';
import {
  __resetDeviceCredentialRefusalsForTests,
  noteRegisterDeviceCredentialRefusal,
  noteWsDeviceCredentialRefusal,
  readDeviceCredentialRefusals,
  recordDeviceCredentialRefusal,
  screenIdOfRefusedDeviceToken,
} from './device-credential-refusals';

const MIN = 60_000;
const SEC = 1_000;
const BOOT = Date.parse('2026-10-23T05:42:00Z');
const RETIRED_KEY = 'a-key-this-server-no-longer-holds-0123456789abcdef';
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tokenFor = (id: string, key = RETIRED_KEY) => jwt.sign({ sub: id, deviceId: id, kind: 'device', ep: 3 }, key, { expiresIn: '180d' });

type Row = Record<string, any>;

/** Redis as the two files use it: per-minute sets + the alarm's state string. */
class FakeRedis {
  sets = new Map<string, Set<string>>();
  strings = new Map<string, string>();
  ttls = new Map<string, number>();
  connected = true;
  publisher = {
    sadd: jest.fn(async (k: string, m: string) => {
      const s = this.sets.get(k) ?? new Set<string>();
      s.add(m);
      this.sets.set(k, s);
      return 1;
    }),
    pexpire: jest.fn(async (k: string, ms: number) => (this.ttls.set(k, ms), 1)),
    smembers: jest.fn(async (k: string) => [...(this.sets.get(k) ?? [])]),
  };
  isConnected = () => this.connected;
  getString = jest.fn(async (k: string) => (this.connected ? (this.strings.get(k) ?? null) : null));
  setString = jest.fn(async (k: string, v: string) => (this.connected ? (this.strings.set(k, v), true) : false));
}

function makeWorld() {
  const tenants = new Map<string, Row>();
  const screens = new Map<string, Row>();
  const t = (id: string, name: string, parentId: string | null = null) =>
    tenants.set(id, { id, name, slug: id, parentId, archivedAt: null, otaWindowStart: null, otaWindowEnd: null, otaWindowTimezone: null });
  t('district', 'Fixture District');
  t('school-a', 'Fixture School A', 'district');
  t('gym', 'Fixture Gym');
  t('cafe', 'Fixture Cafe');
  t('arena', 'Fixture Arena');
  t('office', 'Fixture Office');
  const homes = ['school-a', 'gym', 'cafe', 'arena', 'office'];
  for (let n = 1; n <= 34; n++) {
    screens.set(uuid(n), {
      id: uuid(n),
      name: `Fixture Screen ${n}`,
      tenantId: homes[n % homes.length],
      status: 'ONLINE',
      deviceFingerprint: `fixture-fingerprint-${n}`,
      lastPingAt: new Date(BOOT + 70 * SEC),
      lastPushConnectedAt: new Date(BOOT - 40 * SEC),
    });
  }
  const client: Row = {
    tenant: { findMany: jest.fn(async ({ where }: any) => [...tenants.values()].filter((x) => where.id.in.includes(x.id))) },
    screen: {
      findMany: jest.fn(async ({ where }: any) =>
        [...screens.values()]
          .filter((s) => where.id.in.includes(s.id))
          .map((s) => ({ ...s, tenant: { archivedAt: tenants.get(s.tenantId)?.archivedAt ?? null } })),
      ),
    },
  };
  return { client, tenants, screens };
}

let world: ReturnType<typeof makeWorld>;

function build(redis?: FakeRedis) {
  const mailer = { sendAlert: jest.fn(async () => undefined) };
  const alerts = new CustomerAlertEmailsService({ client: world.client } as any);
  const svc = new DeviceCredentialRefusalAlarmService({ client: world.client } as any, redis as any, undefined, mailer as any, alerts);
  const clock = { now: BOOT };
  svc.now = () => clock.now;
  return { svc, mailer, clock };
}

const dark = Array.from({ length: 14 }, (_, i) => uuid(i + 1));

/**
 * Minutes [fromMin, toMin) after BOOT: every dark screen retries the socket
 * every 30 s and re-registers once a minute (both refused); the leader
 * evaluates once a minute, at :30. Returns the evaluation results.
 */
async function replay(svc: DeviceCredentialRefusalAlarmService, clock: { now: number }, redis: FakeRedis | undefined, ids: string[], fromMin: number, toMin: number) {
  const results: Array<RefusalAlarmTickResult & { minute: number }> = [];
  for (let m = fromMin; m < toMin; m++) {
    for (const s of [5, 35]) {
      const t = BOOT + m * MIN + s * SEC;
      for (const id of ids) noteWsDeviceCredentialRefusal(redis, 'jwt_invalid:invalid signature', tokenFor(id), t);
    }
    for (const id of ids) noteRegisterDeviceCredentialRefusal(redis, id, BOOT + m * MIN + 50 * SEC);
    clock.now = BOOT + (m + 1) * MIN + 30 * SEC;
    results.push({ minute: m + 1, ...(await svc.evaluate()) });
  }
  return results;
}

/** Minutes [fromMin, toMin) with nobody refused, evaluated each minute. */
async function quiet(svc: DeviceCredentialRefusalAlarmService, clock: { now: number }, fromMin: number, toMin: number) {
  const results: Array<RefusalAlarmTickResult & { minute: number }> = [];
  for (let m = fromMin; m < toMin; m++) {
    clock.now = BOOT + (m + 1) * MIN + 30 * SEC;
    results.push({ minute: m + 1, ...(await svc.evaluate()) });
  }
  return results;
}

const ENV = { ...process.env };
beforeEach(() => {
  process.env = { ...ENV };
  delete process.env.DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED;
  __resetDeviceCredentialRefusalsForTests();
  world = makeWorld();
});
afterAll(() => {
  process.env = ENV;
});

describe('the recorder', () => {
  it('reads the screen a REFUSED token claims, only from a device token of ours', () => {
    expect(screenIdOfRefusedDeviceToken(tokenFor(uuid(1)))).toBe(uuid(1));
    expect(screenIdOfRefusedDeviceToken(jwt.sign({ sub: uuid(1), kind: 'user' }, RETIRED_KEY))).toBeNull();
    expect(screenIdOfRefusedDeviceToken(jwt.sign({ sub: uuid(1), deviceId: uuid(2), kind: 'device' }, RETIRED_KEY))).toBeNull();
    expect(screenIdOfRefusedDeviceToken(jwt.sign({ sub: 'x|y', kind: 'device' }, RETIRED_KEY))).toBeNull();
    expect(screenIdOfRefusedDeviceToken('not.a.jwt')).toBeNull();
    expect(screenIdOfRefusedDeviceToken('x'.repeat(10_000))).toBeNull();
    expect(screenIdOfRefusedDeviceToken(undefined)).toBeNull();
  });

  it('writes ONE member per screen per minute per process: `<id>|<source>|<category>` — never the token', async () => {
    const redis = new FakeRedis();
    const token = tokenFor(uuid(1));
    for (let i = 0; i < 6; i++) noteWsDeviceCredentialRefusal(redis, 'jwt_invalid:invalid signature', token, BOOT + i * 5 * SEC);
    noteRegisterDeviceCredentialRefusal(redis, uuid(1), BOOT + 40 * SEC);
    await new Promise((r) => setImmediate(r));
    expect(redis.publisher.sadd).toHaveBeenCalledTimes(2);
    const [[key, member]] = redis.publisher.sadd.mock.calls;
    expect(key).toBe(`venueos:devcred-refusals:v1:${Math.floor(BOOT / MIN)}`);
    expect(member).toBe(`${uuid(1)}|ws|signature`);
    expect(redis.ttls.get(key)).toBe(20 * MIN);
    expect(JSON.stringify([...redis.sets.values()].map((s) => [...s]))).not.toContain(token.split('.')[2]);
  });

  it('a bootstrap credential, an operator revoke, a garbage token: never recorded', async () => {
    const redis = new FakeRedis();
    for (const reason of ['credential_unproven', 'token_revoked', 'screen_revoked', 'screen_unpaired', 'revocation_check_unavailable', 'jwt_invalid:jwt malformed']) {
      noteWsDeviceCredentialRefusal(redis, reason, tokenFor(uuid(1)), BOOT);
    }
    noteRegisterDeviceCredentialRefusal(redis, 'bad id!', BOOT);
    await new Promise((r) => setImmediate(r));
    expect(redis.publisher.sadd).not.toHaveBeenCalled();
    expect((await readDeviceCredentialRefusals(redis, BOOT)).buckets.size).toBe(0);
  });

  it('DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED=1: nothing is recorded, not even in-process', async () => {
    process.env.DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED = '1';
    const redis = new FakeRedis();
    noteWsDeviceCredentialRefusal(redis, 'jwt_invalid:invalid signature', tokenFor(uuid(1)), BOOT);
    noteRegisterDeviceCredentialRefusal(redis, uuid(1), BOOT);
    expect(redis.publisher.sadd).not.toHaveBeenCalled();
    delete process.env.DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED;
    expect((await readDeviceCredentialRefusals(undefined, BOOT)).buckets.size).toBe(0);
  });

  it('never throws, whatever Redis does', () => {
    const angry = { isConnected: () => true, publisher: { sadd: () => { throw new Error('x'); }, pexpire: () => Promise.reject(new Error('y')), smembers: async () => [] } };
    expect(() => recordDeviceCredentialRefusal(angry, { screenId: uuid(1), source: 'ws', category: 'signature' }, BOOT)).not.toThrow();
  });

  it('the reader merges every replica’s writes (Redis) with this process’s own', async () => {
    const redis = new FakeRedis();
    noteRegisterDeviceCredentialRefusal(redis, uuid(1), BOOT);
    // Another replica's refusal of another screen, written straight to Redis.
    await redis.publisher.sadd(`venueos:devcred-refusals:v1:${Math.floor(BOOT / MIN)}`, `${uuid(2)}|ws|expired`);
    const { buckets, shared } = await readDeviceCredentialRefusals(redis, BOOT + 10 * SEC);
    expect(shared).toBe(true);
    expect([...buckets.get(Math.floor(BOOT / MIN))!].sort()).toEqual([`${uuid(1)}|register|register`, `${uuid(2)}|ws|expired`]);
  });
});

describe('the incident, replayed: 14 screens at 5 organisations refused from the restart on', () => {
  it('ONE owner email ~10 minutes in, naming every screen; nothing more inside the hour; a reminder after it', async () => {
    const redis = new FakeRedis();
    const { svc, mailer, clock } = build(redis);
    const first = await replay(svc, clock, redis, dark, 0, 12);
    // First refusals at +0:05; the evaluation at +10:30 is the first to see 10 full minutes.
    expect(first.filter((r) => r.action === 'alert').map((r) => r.minute)).toEqual([10]);
    expect(first.find((r) => r.minute === 9)!.qualifying).toHaveLength(0);
    expect(mailer.sendAlert).toHaveBeenCalledTimes(1);
    const [subject, body, kind] = mailer.sendAlert.mock.calls[0] as unknown as [string, string, string];
    expect(kind).toBe('ALERT_DEVICE_CREDENTIAL_REFUSALS');
    expect(subject).toBe('[VenueOS] Device credentials refused — 14 screens at 5 organisations for 10+ minutes');
    for (const id of dark) expect(body).toContain(id);
    expect(body).toContain(`Fixture District › Fixture School A › Fixture Screen 5 [${uuid(5)}] — refused via register + websocket`);
    expect(body).toContain('signature no current key verifies');
    expect(body).toContain('since 2026-10-23 05:42Z');
    expect(body).not.toMatch(/fixture-fingerprint|eyJ|no-longer-holds/);
    expect(body).not.toContain('Fixture Screen 15 [');

    const hour = await replay(svc, clock, redis, dark, 12, 71);
    expect(hour.filter((r) => r.action !== 'none').map((r) => [r.minute, r.action])).toEqual([[70, 'alert']]);
    expect(mailer.sendAlert).toHaveBeenCalledTimes(2);
    expect((mailer.sendAlert.mock.calls[1] as unknown as [string])[0]).toMatch(/^\[VenueOS\] STILL refusing device credentials — 14 screens/);
  });

  it('the refusals stop → a recovery note once it has been clear for 5 minutes, and nothing after', async () => {
    const redis = new FakeRedis();
    const { svc, mailer, clock } = build(redis);
    await replay(svc, clock, redis, dark, 0, 15);
    // 12 screens get back in; 2 are still refused — below the threshold.
    const after = await replay(svc, clock, redis, dark.slice(0, 2), 15, 30);
    const recovered = after.filter((r) => r.action === 'recovered');
    expect(recovered).toHaveLength(1);
    expect(recovered[0].minute).toBeGreaterThanOrEqual(21);
    expect(recovered[0].minute).toBeLessThanOrEqual(23);
    expect(mailer.sendAlert).toHaveBeenCalledTimes(2);
    const [subject, body, kind] = mailer.sendAlert.mock.calls[1] as unknown as [string, string, string];
    expect(kind).toBe('ALERT_DEVICE_CREDENTIAL_REFUSALS_RECOVERED');
    expect(subject).toBe('[VenueOS] Recovered: device credentials no longer refused (12 screens)');
    expect(body).toContain('Still refused (below the alarm threshold');
    expect(body).toContain(uuid(1));
    expect((await quiet(svc, clock, 30, 45)).every((r) => r.action === 'none')).toBe(true);
    expect(mailer.sendAlert).toHaveBeenCalledTimes(2);
  });

  it('a DEPLOY in the middle (a new leader) neither re-sends nor forgets: the state is in Redis', async () => {
    const redis = new FakeRedis();
    const a = build(redis);
    await replay(a.svc, a.clock, redis, dark, 0, 14);
    expect(a.mailer.sendAlert).toHaveBeenCalledTimes(1);
    // New process: its own in-process copy is empty; Redis carries the sets and the state.
    __resetDeviceCredentialRefusalsForTests();
    const b = build(redis);
    const more = await replay(b.svc, b.clock, redis, dark, 14, 30);
    expect(more.every((r) => r.action === 'none')).toBe(true);
    expect(b.mailer.sendAlert).not.toHaveBeenCalled();
    const calm = await quiet(b.svc, b.clock, 30, 40);
    expect(calm.filter((r) => r.action === 'recovered')).toHaveLength(1);
    expect((b.mailer.sendAlert.mock.calls[0] as unknown as [string])[0]).toMatch(/^\[VenueOS\] Recovered/);
  });

  it('with Redis down a single replica still alarms, from its own in-process count, and says so', async () => {
    const redis = new FakeRedis();
    redis.connected = false;
    const { svc, mailer, clock } = build(redis);
    const r = await replay(svc, clock, redis, dark, 0, 12);
    expect(r.find((x) => x.action === 'alert')).toMatchObject({ minute: 10, shared: false });
    expect((mailer.sendAlert.mock.calls[0] as unknown as [string, string])[1]).toContain('Redis could not be read');
  });
});

describe('no false alarms', () => {
  it('a normal deploy: a minute of refusals while screens renew, then nothing → no email', async () => {
    const redis = new FakeRedis();
    const { svc, mailer, clock } = build(redis);
    for (const id of dark) noteWsDeviceCredentialRefusal(redis, 'jwt_invalid:jwt expired', tokenFor(id), BOOT + 20 * SEC);
    const r = [...(await quiet(svc, clock, 0, 30))];
    expect(r.every((x) => x.action === 'none' && x.qualifying.length === 0)).toBe(true);
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('two screens refused for an hour → no email (the floor is 3)', async () => {
    const redis = new FakeRedis();
    const { svc, mailer, clock } = build(redis);
    await replay(svc, clock, redis, dark.slice(0, 2), 0, 60);
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('screens refused for 9 minutes then fine → no email', async () => {
    const redis = new FakeRedis();
    const { svc, mailer, clock } = build(redis);
    await replay(svc, clock, redis, dark, 0, 9);
    await quiet(svc, clock, 9, 30);
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('forged tokens naming HEALTHY screens (live push channel) do not count', async () => {
    const redis = new FakeRedis();
    const { svc, mailer, clock } = build(redis);
    for (let m = 0; m < 15; m++) {
      for (const id of dark) world.screens.get(id)!.lastPushConnectedAt = new Date(BOOT + m * MIN + 10 * SEC);
      for (const id of dark) noteWsDeviceCredentialRefusal(redis, 'jwt_invalid:invalid signature', tokenFor(id), BOOT + m * MIN + 5 * SEC);
      clock.now = BOOT + (m + 1) * MIN + 30 * SEC;
      const r = await svc.evaluate();
      expect(r.qualifying).toHaveLength(0);
    }
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });

  it('ids that are not real, paired, live screens do not count', async () => {
    const redis = new FakeRedis();
    const { svc, mailer, clock } = build(redis);
    world.screens.get(uuid(1))!.status = 'REVOKED';
    world.screens.get(uuid(2))!.tenantId = null;
    world.tenants.get('arena')!.archivedAt = new Date(BOOT - MIN); // uuid(3)'s organisation
    const ids = [uuid(1), uuid(2), uuid(3), uuid(901), uuid(902)];
    const r = await replay(svc, clock, redis, ids, 0, 15);
    expect(r.every((x) => x.qualifying.length === 0)).toBe(true);
    expect(r[r.length - 1].continuous).toBe(5);
    expect(mailer.sendAlert).not.toHaveBeenCalled();
  });
});

describe('kill switch + timer', () => {
  it('DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED=1 arms nothing; otherwise one 60 s ticker', () => {
    process.env.NODE_ENV = 'production';
    process.env.DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED = '1';
    const off = build().svc;
    (off as any).logger = { log: jest.fn(), warn: jest.fn() };
    off.onModuleInit();
    expect((off as any).timer).toBeNull();
    delete process.env.DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED;
    const on = build().svc;
    on.onModuleInit();
    expect((on as any).timer).not.toBeNull();
    on.onModuleDestroy();
    expect((on as any).timer).toBeNull();
  });
});
