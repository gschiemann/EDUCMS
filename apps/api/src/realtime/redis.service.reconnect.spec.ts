/**
 * EMG-03 (2026-11-21) — the push channel survives a Redis outage.
 *
 * Before the fix `retryStrategy` returned null after 3 attempts (ioredis then
 * ends the connection for good), and `connected` was written only at boot, so
 * after any Redis blip longer than about a second:
 *   • no screen got a WS/SSE push again until the API was restarted, and
 *   • `publish()` kept taking the Redis branch (connected still read true),
 *     so the in-process delivery that would have reached every screen on this
 *     single replica was never used.
 *
 * ioredis is replaced by a scripted fake: each test drives the connection
 * events ('ready', 'close', 'end') the real client emits.
 */
import { EventEmitter } from 'events';
import { Logger } from '@nestjs/common';
import { wsCanonicalString, wsHmacHex } from '../security/ws-signature';

const DEVICE_SECRET = 'test_device_secret_key_at_least_16_chars';

// ── A scripted stand-in for an ioredis client ──────────────────────────────
class MockRedisClient extends EventEmitter {
  status = 'wait';
  readonly opts: Record<string, any>;
  /** What connect() does; the default comes up at once. */
  connectImpl: () => Promise<void> = () => {
    this.goReady();
    return Promise.resolve();
  };
  readonly connect = jest.fn(() => this.connectImpl());
  /** Default: Redis answers "1 subscriber received it". */
  readonly publish = jest.fn<Promise<number>, [string, string]>(() =>
    Promise.resolve(1),
  );
  readonly psubscribe = jest.fn<Promise<number>, string[]>(() =>
    Promise.resolve(3),
  );
  readonly config = jest.fn(() =>
    Promise.resolve(['maxmemory-policy', 'noeviction']),
  );
  readonly exists = jest.fn(() => Promise.resolve(1));
  // Like ioredis with the offline queue off: QUIT on a connection that is not
  // ready is rejected, and the reconnect timer keeps running.
  readonly quit = jest.fn(() => {
    if (this.status !== 'ready') {
      return Promise.reject(
        new Error(
          "Stream isn't writeable and enableOfflineQueue options is false",
        ),
      );
    }
    this.status = 'end';
    this.emit('end');
    return Promise.resolve('OK');
  });
  readonly disconnect = jest.fn(() => {
    this.status = 'end';
    this.emit('close');
    this.emit('end');
  });

  constructor(_url: string, opts: Record<string, any>) {
    super();
    this.opts = opts;
  }

  goReady() {
    this.status = 'ready';
    this.emit('ready');
  }

  /** A dropped connection that ioredis will retry. */
  drop() {
    this.status = 'reconnecting';
    this.emit('close');
  }

  /** A connection ioredis has given up on (what retryStrategy → null did). */
  endForGood() {
    this.status = 'end';
    this.emit('close');
    this.emit('end');
  }
}

const mockClients: MockRedisClient[] = [];
jest.mock('ioredis', () => ({
  Redis: jest
    .fn()
    .mockImplementation((url: string, opts: Record<string, any>) => {
      const c = new MockRedisClient(url, opts);
      mockClients.push(c);
      return c;
    }),
}));

// Imported after the mock so the service builds the fake clients.
import {
  RedisService,
  FANOUT_PATTERNS,
  REDIS_BOOT_CAP_MS,
} from './redis.service';

/** A signed (unbound) envelope; publish() binds it to its channel. */
function signed(type: string, payload: unknown) {
  const eventId = 'evt-' + Math.random().toString(36).slice(2);
  const timestamp = Date.now();
  return {
    eventId,
    timestamp,
    type,
    payload,
    signature: wsHmacHex(
      wsCanonicalString({ eventId, timestamp, type, payload }),
      DEVICE_SECRET,
    ),
  };
}

/** The service's private Nest logger, to silence and observe it. */
function loggerOf(svc: RedisService): Logger {
  return (svc as unknown as { logger: Logger }).logger;
}

/** Let pending promise callbacks run. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function build() {
  mockClients.length = 0;
  const svc = new RedisService();
  const [pub, sub] = mockClients;
  const gateway = { broadcastToScope: jest.fn() };
  const sse = { broadcastToScope: jest.fn() };
  svc.setGateway(gateway);
  svc.setSseService(sse);
  const logger = loggerOf(svc);
  for (const level of ['log', 'warn', 'error', 'debug'] as const) {
    jest.spyOn(logger, level).mockImplementation(() => undefined);
  }
  return { svc, pub, sub, gateway, sse };
}

async function bootConnected() {
  const env = build();
  await env.svc.onModuleInit();
  await flush();
  expect(env.svc.isConnected()).toBe(true);
  return env;
}

const prev = {
  url: process.env.REDIS_URL,
  disabled: process.env.REDIS_DISABLED,
  secret: process.env.DEVICE_SECRET_KEY,
};
beforeAll(() => {
  process.env.REDIS_URL = 'redis://redis.invalid:6379';
  delete process.env.REDIS_DISABLED;
  process.env.DEVICE_SECRET_KEY = DEVICE_SECRET;
});
afterAll(() => {
  for (const [k, v] of [
    ['REDIS_URL', prev.url],
    ['REDIS_DISABLED', prev.disabled],
    ['DEVICE_SECRET_KEY', prev.secret],
  ] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('EMG-03 — reconnect forever, never give up', () => {
  it('retryStrategy always returns a capped delay (null would end the connection for good)', () => {
    const { pub, sub } = build();
    for (const client of [pub, sub]) {
      const retry = client.opts.retryStrategy as (n: number) => unknown;
      for (const times of [1, 2, 3, 4, 10, 100, 10_000]) {
        const delay = retry(times);
        expect(typeof delay).toBe('number');
        expect(delay as number).toBeGreaterThan(0);
        expect(delay as number).toBeLessThanOrEqual(5_000);
      }
    }
  });

  it('the offline queue is off on both connections: nothing waits to be replayed after a reconnect', () => {
    const { pub, sub } = build();
    expect(pub.opts.enableOfflineQueue).toBe(false);
    expect(sub.opts.enableOfflineQueue).toBe(false);
    // One owner of the re-subscribe: the service, on every 'ready'.
    expect(sub.opts.autoResubscribe).toBe(false);
  });
});

describe("EMG-03 (a) — after 'end' then 'ready' the channel is re-subscribed and connected flips back", () => {
  it('subscriber ends → not connected; back → psubscribe again → connected', async () => {
    const { svc, sub } = await bootConnected();
    expect(sub.psubscribe).toHaveBeenCalledTimes(1);
    expect(sub.psubscribe).toHaveBeenLastCalledWith(...FANOUT_PATTERNS);

    sub.endForGood();
    expect(svc.isConnected()).toBe(false);
    expect(svc.pushChannelState()).toMatchObject({
      configured: true,
      live: false,
      subscribed: false,
    });
    expect(svc.pushChannelState().reason).toMatch(
      /Instant push to screens is down/,
    );

    sub.goReady();
    await flush();
    expect(sub.psubscribe).toHaveBeenCalledTimes(2);
    expect(sub.psubscribe).toHaveBeenLastCalledWith(...FANOUT_PATTERNS);
    expect(svc.isConnected()).toBe(true);
    expect(svc.pushChannelState()).toMatchObject({
      live: true,
      reason: null,
      downSince: null,
    });
  });

  it('publisher ends → not connected; back → connected again', async () => {
    const { svc, pub } = await bootConnected();
    pub.endForGood();
    expect(svc.isConnected()).toBe(false);
    pub.goReady();
    await flush();
    expect(svc.isConnected()).toBe(true);
  });

  it("a connection that reached 'end' is dialled again (a connector fault must not end push for good)", async () => {
    const { svc, sub } = await bootConnected();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    sub.connectImpl = () => {
      sub.goReady();
      return Promise.resolve();
    };
    const dialsBefore = sub.connect.mock.calls.length;
    sub.endForGood();
    jest.advanceTimersByTime(5_000);
    await flush();
    expect(sub.connect.mock.calls.length).toBe(dialsBefore + 1);
    expect(svc.isConnected()).toBe(true);
  });

  it('a psubscribe reply from a connection that has since dropped does not mark the channel live', async () => {
    const { svc, sub } = await bootConnected();
    sub.drop();
    let answer!: () => void;
    sub.psubscribe.mockImplementationOnce(
      () => new Promise<number>((resolve) => (answer = () => resolve(3))),
    );
    sub.goReady(); // psubscribe in flight on this connection…
    sub.drop(); // …which drops before Redis confirms it
    answer();
    await flush();
    expect(svc.isConnected()).toBe(false);
  });
});

describe('EMG-03 (b) — publish while disconnected delivers locally exactly once, and nothing goes to Redis', () => {
  it('publisher connection lost → this replica delivers to its own WS + SSE once; no PUBLISH queued', async () => {
    const { svc, pub, gateway, sse } = await bootConnected();
    pub.drop();
    expect(svc.isConnected()).toBe(false);

    await svc.publish(
      'tenant:district-a',
      signed('OVERRIDE', { severity: 'LOCKDOWN' }),
    );

    expect(pub.publish).not.toHaveBeenCalled();
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(1);
    expect(gateway.broadcastToScope).toHaveBeenCalledWith(
      'tenant',
      'district-a',
      expect.objectContaining({
        type: 'OVERRIDE',
        payload: { severity: 'LOCKDOWN' },
      }),
    );
    expect(sse.broadcastToScope).toHaveBeenCalledTimes(1);

    // Redis comes back: nothing was queued, so nothing is replayed.
    pub.goReady();
    await flush();
    expect(pub.publish).not.toHaveBeenCalled();
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(1);
  });

  it('subscriber lost (publisher fine) → still delivered here, still not sent to Redis', async () => {
    const { svc, pub, sub, gateway } = await bootConnected();
    sub.drop();
    await svc.publish('device:scr_1', signed('SOS', { text: 'Room 12' }));
    expect(pub.publish).not.toHaveBeenCalled();
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(1);
  });

  it('a publish in flight when the publisher drops is delivered here at once, and the late re-sent copy is dropped', async () => {
    const { svc, pub, sub, gateway } = await bootConnected();
    pub.publish.mockImplementationOnce(
      () => new Promise<number>(() => undefined),
    ); // never answered
    const sending = svc.publish(
      'tenant:district-a',
      signed('OVERRIDE', { severity: 'LOCKDOWN' }),
    );
    await flush();
    const wireBody = pub.publish.mock.calls[0][1];
    expect(gateway.broadcastToScope).not.toHaveBeenCalled();

    pub.drop(); // in flight → 'lost' → local delivery now
    await sending;
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(1);

    // ioredis re-sends the unfulfilled PUBLISH after the reconnect; the
    // subscriber hears it. The gate must not deliver it a second time.
    pub.goReady();
    sub.emit('pmessage', 'tenant:*', 'tenant:district-a', wireBody);
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(1);
  });

  it('healthy path unchanged: Redis delivers it, this replica receives it once over the subscriber', async () => {
    const { svc, pub, sub, gateway } = await bootConnected();
    await svc.publish(
      'tenant:district-a',
      signed('OVERRIDE', { severity: 'LOCKDOWN' }),
    );
    expect(pub.publish).toHaveBeenCalledTimes(1);
    expect(gateway.broadcastToScope).not.toHaveBeenCalled(); // not delivered locally
    sub.emit(
      'pmessage',
      'tenant:*',
      'tenant:district-a',
      pub.publish.mock.calls[0][1],
    );
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(1);
  });

  it('a Redis that stops answering costs ONE wait: later publishes are delivered here first, and the copy is still sent', async () => {
    const { svc, pub, sub, gateway } = await bootConnected();
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    pub.publish.mockImplementationOnce(
      () => new Promise<number>(() => undefined),
    );

    const first = svc.publish(
      'tenant:school-1',
      signed('OVERRIDE', { severity: 'LOCKDOWN' }),
    );
    await flush();
    expect(gateway.broadcastToScope).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    await first;
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(1);
    expect(svc.isConnected()).toBe(false);
    expect(svc.pushChannelState().reason).toMatch(
      /Redis stopped confirming pushes/,
    );

    // The next school: no wait at all — delivered before publish() returns.
    let answer!: (n: number) => void;
    pub.publish.mockImplementationOnce(
      () => new Promise<number>((r) => (answer = r)),
    );
    await svc.publish(
      'tenant:school-2',
      signed('OVERRIDE', { severity: 'LOCKDOWN' }),
    );
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(2);
    expect(pub.publish).toHaveBeenCalledTimes(2); // the copy still went to Redis

    // Redis answers that copy: the channel is live again, and the copy the
    // subscriber hears is not delivered twice.
    answer(1);
    await flush();
    expect(svc.isConnected()).toBe(true);
    sub.emit(
      'pmessage',
      'tenant:*',
      'tenant:school-2',
      pub.publish.mock.calls[1][1],
    );
    expect(gateway.broadcastToScope).toHaveBeenCalledTimes(2);
  });

  it('a non-screen channel (metrics:ack telemetry) keeps its one plain PUBLISH — no local loop, no warning', async () => {
    const { svc, pub, gateway } = await bootConnected();
    pub.publish.mockResolvedValueOnce(0); // nothing subscribes to it
    const warn = jest.spyOn(loggerOf(svc), 'warn');
    await svc.publish('metrics:ack', {
      deviceId: 'scr_1',
      status: 'ok',
      timestamp: Date.now(),
    });
    expect(pub.publish).toHaveBeenCalledTimes(1);
    expect(gateway.broadcastToScope).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('EMG-03 (c) — the 7 s boot cap still bounds boot', () => {
  it('Redis that never answers: boot returns at 7 s, not later and not sooner', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
    const { svc, pub, sub } = build();
    pub.connectImpl = () => new Promise<void>(() => undefined);
    sub.connectImpl = () => new Promise<void>(() => undefined);

    let booted = false;
    const boot = svc.onModuleInit().then(() => (booted = true));
    jest.advanceTimersByTime(REDIS_BOOT_CAP_MS - 1);
    await flush();
    expect(booted).toBe(false);
    jest.advanceTimersByTime(1);
    await boot;
    expect(booted).toBe(true);
    expect(REDIS_BOOT_CAP_MS).toBe(7_000);
    expect(svc.isConnected()).toBe(false);
    expect(svc.pushChannelState().reason).toMatch(
      /not reachable when the API started/,
    );
  });

  it('Redis down at boot and up later: the push channel comes up by itself (it used to stay down)', async () => {
    const { svc, pub, sub } = build();
    const refused = () => Promise.reject(new Error('connect ECONNREFUSED'));
    pub.connectImpl = refused;
    sub.connectImpl = refused;
    await svc.onModuleInit();
    expect(svc.isConnected()).toBe(false);

    // ioredis's own retry reaches Redis.
    pub.goReady();
    sub.goReady();
    await flush();
    expect(sub.psubscribe).toHaveBeenCalledWith(...FANOUT_PATTERNS);
    expect(svc.isConnected()).toBe(true);
  });
});

describe('EMG-03 — shutdown with a connection still reconnecting', () => {
  it('closes a non-ready connection outright (QUIT would be refused and keep the retry timer alive)', async () => {
    const { svc, pub, sub } = await bootConnected();
    pub.drop();
    await svc.onModuleDestroy();
    expect(pub.disconnect).toHaveBeenCalled();
    expect(pub.status).toBe('end');
    expect(sub.quit).toHaveBeenCalled(); // the ready one still gets a graceful QUIT
    expect(sub.status).toBe('end');
  });
});
