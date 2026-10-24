/**
 * The WebSocket HELLO feeds the owner's device-credential refusal alarm
 * (2026-10-23, notifications/fleet-alarms/). Drives the REAL `processHello`:
 * a refused credential this API could have issued is counted against the
 * screen its token claims — a retired-key signature, an expired token — and
 * everything the alarm must not count (a valid token, a bootstrap credential,
 * an operator revoke, garbage) is not. The refusal itself is unchanged.
 */
import * as jwt from 'jsonwebtoken';
import { WebSocket } from 'ws';
import { RealtimeGateway } from './realtime.gateway';
import { DEVICE_TOKEN_AUD_BOOTSTRAP, invalidateDeviceCredentialCache } from '../screens/device-auth';
import {
  __resetDeviceCredentialRefusalsForTests,
  readDeviceCredentialRefusals,
} from '../notifications/fleet-alarms/device-credential-refusals';

const DEVICE_JWT_SECRET = 'refusal_alarm_device_jwt_secret_0123456789ab';
const RETIRED_KEY = 'refusal_alarm_retired_key_no_longer_held_0123';
const SCREEN_ID = '00000000-0000-4000-8000-00000000a001';
const TENANT_ID = 'tenant-refusal-alarm';

const prevJwt = process.env.DEVICE_JWT_SECRET;
const prevKey = process.env.DEVICE_SECRET_KEY;
beforeAll(() => {
  process.env.DEVICE_JWT_SECRET = DEVICE_JWT_SECRET;
  process.env.DEVICE_SECRET_KEY = 'refusal_alarm_device_secret_0123456789ab';
});
afterAll(() => {
  if (prevJwt === undefined) delete process.env.DEVICE_JWT_SECRET;
  else process.env.DEVICE_JWT_SECRET = prevJwt;
  if (prevKey === undefined) delete process.env.DEVICE_SECRET_KEY;
  else process.env.DEVICE_SECRET_KEY = prevKey;
});

function makeGateway(row: Record<string, unknown> = {}) {
  const redis: any = {
    publisher: { sadd: jest.fn().mockResolvedValue(1), hset: jest.fn().mockResolvedValue(1), publish: jest.fn().mockResolvedValue(1) },
    subscriber: {},
    setGateway: jest.fn(),
    publish: jest.fn().mockResolvedValue(undefined),
    sismember: jest.fn(async () => false),
  };
  const prisma: any = {
    client: {
      screen: {
        findUnique: jest.fn(async () => ({
          id: SCREEN_ID,
          tenantId: TENANT_ID,
          screenGroupId: null,
          status: 'ONLINE',
          credentialEpoch: 1,
          credentialEpochRotatedAt: null,
          ...row,
        })),
        updateMany: jest.fn(async () => ({ count: 1 })),
        update: jest.fn(async () => ({})),
      },
    },
  };
  const gateway = new RealtimeGateway(redis, prisma, {
    now: () => Date.now(),
    status: () => ({ offsetMs: 0, sampledAt: 0, rttMs: null, source: 'local' as const }),
  } as any);
  (gateway as any).logger = { log: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
  return gateway;
}

async function hello(gateway: RealtimeGateway, token: string) {
  const ws = { send: jest.fn(), close: jest.fn(), on: jest.fn(), readyState: WebSocket.OPEN } as unknown as WebSocket;
  gateway.handleConnection(ws);
  await (gateway as any).processHello(ws, { token });
  const ctx = (gateway as any).clients.get(ws);
  const clients = (gateway as any).clients as Map<unknown, { authTimeout?: NodeJS.Timeout }>;
  for (const c of clients.values()) if (c.authTimeout) clearTimeout(c.authTimeout);
  (gateway as any).onModuleDestroy();
  const sent = (ws.send as jest.Mock).mock.calls.map((c) => JSON.parse(c[0]).type);
  return { ctx, sent };
}

const sign = (key: string, claims: Record<string, unknown> = {}, opts: jwt.SignOptions = {}) =>
  jwt.sign({ sub: SCREEN_ID, deviceId: SCREEN_ID, kind: 'device', ep: 1, ...claims }, key, { algorithm: 'HS256', expiresIn: '180d', ...opts });

async function recorded(): Promise<string[]> {
  const { buckets } = await readDeviceCredentialRefusals(undefined, Date.now());
  return [...buckets.values()].flatMap((s) => [...s]).sort();
}

beforeEach(() => {
  invalidateDeviceCredentialCache();
  __resetDeviceCredentialRefusalsForTests();
  delete process.env.DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED;
});

describe('WebSocket HELLO → device-credential refusal alarm', () => {
  it('a token signed by a key we no longer hold: still refused, and counted for the screen it names', async () => {
    const { ctx, sent } = await hello(makeGateway(), sign(RETIRED_KEY));
    expect(ctx?.isAuthenticated).toBe(false);
    expect(sent).toEqual(['AUTH_FAIL']);
    expect(await recorded()).toEqual([`${SCREEN_ID}|ws|signature`]);
  });

  it('an expired token of ours: refused, counted as expired', async () => {
    const { sent } = await hello(makeGateway(), sign(DEVICE_JWT_SECRET, {}, { expiresIn: -60 }));
    expect(sent).toEqual(['AUTH_FAIL']);
    expect(await recorded()).toEqual([`${SCREEN_ID}|ws|expired`]);
  });

  it('a superseded credential epoch: refused, counted', async () => {
    const { sent } = await hello(makeGateway({ credentialEpoch: 5, credentialEpochRotatedAt: new Date(Date.now() - 24 * 3600_000) }), sign(DEVICE_JWT_SECRET, { ep: 2 }));
    expect(sent).toEqual(['AUTH_FAIL']);
    expect(await recorded()).toEqual([`${SCREEN_ID}|ws|superseded`]);
  });

  it('a valid token: authenticated, nothing counted', async () => {
    const { ctx, sent } = await hello(makeGateway(), sign(DEVICE_JWT_SECRET));
    expect(ctx?.isAuthenticated).toBe(true);
    expect(sent).toContain('AUTH_OK');
    expect(await recorded()).toEqual([]);
  });

  it('a bootstrap credential (refused at the socket by design), a revoked screen, garbage: refused, NOT counted', async () => {
    const bootstrap = sign(DEVICE_JWT_SECRET, { unproven: true, aud: DEVICE_TOKEN_AUD_BOOTSTRAP }, { expiresIn: '1h' });
    expect((await hello(makeGateway(), bootstrap)).sent).toEqual(['AUTH_FAIL']);
    expect((await hello(makeGateway({ status: 'REVOKED' }), sign(DEVICE_JWT_SECRET))).sent).toEqual(['AUTH_FAIL']);
    expect((await hello(makeGateway(), 'not-a-token')).sent).toEqual(['AUTH_FAIL']);
    expect(await recorded()).toEqual([]);
  });

  it('DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED=1: refused exactly as before, nothing counted', async () => {
    process.env.DEVICE_CREDENTIAL_REFUSAL_ALARM_DISABLED = '1';
    const { sent } = await hello(makeGateway(), sign(RETIRED_KEY));
    expect(sent).toEqual(['AUTH_FAIL']);
    expect(await recorded()).toEqual([]);
  });
});
