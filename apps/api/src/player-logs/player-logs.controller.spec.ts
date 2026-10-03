import { PlayerLogsController } from './player-logs.controller';
import { verifyDeviceForScreen } from '../screens/device-auth';
import {
  MAX_AUDIT_ROWS_PER_SCREEN_HOUR,
  MAX_AUDIT_ROWS_PER_UPLOAD,
} from './player-logs-limits';
jest.mock('../screens/device-auth', () => ({ verifyDeviceForScreen: jest.fn() }));
const verify = jest.mocked(verifyDeviceForScreen);
const screenId = 'test-screen';
const tenantId = 'test-tenant';
const recovery = '2026-09-29T17:35:00Z ERROR PLAYER_RENDERER_TERMINATED slot=primary didCrash=false failures=1 retryMs=2000';
const marker = (n: number) =>
  `2026-09-29T17:${String(10 + Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}Z WARN PLAYER_PLAYBACK_FAILURE stalled item=${n}`;

/** SET NX / DEL / MULTI(INCRBY, EXPIRE) / DECRBY with Redis semantics. */
function fakeRedis() {
  const data = new Map<string, string>();
  const redis = {
    status: 'ready',
    data,
    set: jest.fn(async (key: string, value: string) => {
      if (data.has(key)) return null;
      data.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key: string) => (data.delete(key) ? 1 : 0)),
    decrby: jest.fn(async (key: string, n: number) => {
      const next = Number(data.get(key) ?? 0) - n;
      data.set(key, String(next));
      return next;
    }),
    multi: jest.fn(() => {
      const ops: Array<() => unknown> = [];
      const pipeline = {
        incrby(key: string, n: number) {
          ops.push(() => {
            const next = Number(data.get(key) ?? 0) + n;
            data.set(key, String(next));
            return next;
          });
          return pipeline;
        },
        expire() {
          ops.push(() => 1);
          return pipeline;
        },
        exec: async () => ops.map((op) => [null, op()]),
      };
      return pipeline;
    }),
  };
  return redis;
}

let prisma: any;
let controller: PlayerLogsController;
beforeEach(() => {
  jest.clearAllMocks();
  prisma = { client: { auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit' }), findFirst: jest.fn().mockResolvedValue(null) } } };
  controller = new PlayerLogsController(prisma, {} as any);
  verify.mockResolvedValue({ ok: true, sub: screenId, tenantId } as any);
});
const request = (body: string) => ({ body, headers: {} } as any);
const created = () => prisma.client.auditLog.create.mock.calls.map(([arg]: any[]) => arg.data);
const loggedLines = () => created().map((d: any) => JSON.parse(d.details).log);

test('delegates identity, revocation and epoch checks to the shared device verifier', async () => {
  const req = request('FATAL EXCEPTION: main');
  await controller.ingestLog(screenId, req);
  expect(verify).toHaveBeenCalledWith({ prisma, redis: {} }, req, screenId, { allowUnpaired: true });
  expect(prisma.client.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId, targetId: screenId, action: 'PLAYER_DIAGNOSTICS_CRASH' }) });
});
test.each(['missing', 'invalid', 'subject-mismatch', 'unproven', 'revoked', 'stale-epoch'])('%s credentials cannot attribute a recovery event to any tenant', async () => {
  verify.mockResolvedValue({ ok: false } as any);
  expect(await controller.ingestLog(screenId, request(recovery))).toEqual({ stored: true, rows: 0 });
  expect(prisma.client.auditLog.findFirst).not.toHaveBeenCalled();
  expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
});
test('records isolated renderer termination without requiring a JVM fatal exception', async () => {
  expect(await controller.ingestLog(screenId, request('routine token-bearing navigation log\n' + recovery))).toEqual({ stored: true, rows: 1 });
  const data = prisma.client.auditLog.create.mock.calls[0][0].data;
  expect(data).toMatchObject({ tenantId, targetId: screenId, action: 'PLAYER_RECOVERY_EVENT' });
  const details = JSON.parse(data.details);
  expect(details.log).toBe(recovery);
  expect(details.recoveryEventId).toMatch(/^[a-f0-9]{64}$/);
  expect(details.crashDetected).toBe(false);
});
test('does not re-audit a timestamped recovery event from a repeated rotating-log upload — and never scans the audit table to know', async () => {
  const redis = fakeRedis();
  controller = new PlayerLogsController(prisma, { publisher: redis } as any);
  expect(await controller.ingestLog(screenId, request(recovery))).toEqual({ stored: true, rows: 1 });
  expect(await controller.ingestLog(screenId, request(recovery))).toEqual({ stored: true, rows: 0 });
  expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(1);
  expect(prisma.client.auditLog.findFirst).not.toHaveBeenCalled();
  expect(redis.set).toHaveBeenCalledWith(expect.stringContaining(`${tenantId}:${screenId}:`), '1', 'EX', expect.any(Number), 'NX');
});
test('two simultaneous uploads of the same event write it once', async () => {
  const redis = fakeRedis();
  controller = new PlayerLogsController(prisma, { publisher: redis } as any);
  const results = await Promise.all([
    controller.ingestLog(screenId, request(recovery)),
    controller.ingestLog(screenId, request(recovery)),
  ]);
  expect(results.map((r) => r.rows).sort()).toEqual([0, 1]);
  expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(1);
});
test('routine diagnostics stay outside the immutable audit log', async () => {
  expect(await controller.ingestLog(screenId, request('heartbeat synced'))).toEqual({ stored: true, rows: 0 });
  expect(prisma.client.auditLog.create).not.toHaveBeenCalled();
});
test('failed persistence is visible to the uploader so the local record can be retried', async () => {
  prisma.client.auditLog.create.mockRejectedValue(Error('database unavailable'));
  expect(await controller.ingestLog(screenId, request(recovery))).toEqual({ stored: false, rows: 0 });
});
test('a failed write gives its claim back, so the retry records the event', async () => {
  const redis = fakeRedis();
  controller = new PlayerLogsController(prisma, { publisher: redis } as any);
  prisma.client.auditLog.create.mockRejectedValueOnce(Error('database unavailable'));
  expect(await controller.ingestLog(screenId, request(recovery))).toEqual({ stored: false, rows: 0 });
  expect(await controller.ingestLog(screenId, request(recovery))).toEqual({ stored: true, rows: 1 });
});
test('oversized bodies are refused before authentication or storage', async () => {
  await expect(controller.ingestLog(screenId, request('x'.repeat(1_048_577)))).rejects.toThrow();
  expect(verify).not.toHaveBeenCalled();
});
test('retains each distinct renderer and decoder event in a bounded upload', async () => {
  const body = recovery + '\n2026-09-29T17:36:00Z PLAYER_PLAYBACK_FAILURE video stalled';
  expect(await controller.ingestLog(screenId, request(body))).toEqual({ stored: true, rows: 2 });
  expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(2);
});
test('an already uploaded renderer marker cannot hide a simultaneous JVM fatal exception', async () => {
  const redis = fakeRedis();
  controller = new PlayerLogsController(prisma, { publisher: redis } as any);
  await controller.ingestLog(screenId, request(recovery));
  prisma.client.auditLog.create.mockClear();
  expect(await controller.ingestLog(screenId, request(recovery + '\nFATAL EXCEPTION main'))).toEqual({ stored: true, rows: 1 });
  expect(prisma.client.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'PLAYER_DIAGNOSTICS_CRASH' }) });
});

describe('rows per upload and per screen per hour', () => {
  test(`one upload writes at most ${MAX_AUDIT_ROWS_PER_UPLOAD} rows — the newest events, in log order — and the next upload writes the rest`, async () => {
    const redis = fakeRedis();
    controller = new PlayerLogsController(prisma, { publisher: redis } as any);
    const body = Array.from({ length: 20 }, (_, n) => marker(n)).join('\n');
    expect(await controller.ingestLog(screenId, request(body))).toEqual({ stored: true, rows: MAX_AUDIT_ROWS_PER_UPLOAD });
    expect(loggedLines()).toEqual(Array.from({ length: 8 }, (_, n) => marker(12 + n)));
    prisma.client.auditLog.create.mockClear();
    expect(await controller.ingestLog(screenId, request(body))).toEqual({ stored: true, rows: 8 });
    expect(loggedLines()).toEqual(Array.from({ length: 8 }, (_, n) => marker(4 + n)));
  });

  test('a crash in a busy upload keeps its slot: seven recovery events plus the crash record', async () => {
    const body = Array.from({ length: 20 }, (_, n) => marker(n)).join('\n') + '\nFATAL EXCEPTION main';
    expect(await controller.ingestLog(screenId, request(body))).toEqual({ stored: true, rows: 8 });
    const actions = created().map((d: any) => d.action);
    expect(actions.filter((a: string) => a === 'PLAYER_RECOVERY_EVENT')).toHaveLength(7);
    expect(actions[actions.length - 1]).toBe('PLAYER_DIAGNOSTICS_CRASH');
  });

  test(`a screen writes at most ${MAX_AUDIT_ROWS_PER_SCREEN_HOUR} rows an hour; withheld events are released for a later upload`, async () => {
    const redis = fakeRedis();
    let now = Date.UTC(2026, 9, 3, 12, 0, 0);
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      controller = new PlayerLogsController(prisma, { publisher: redis } as any);
      const fresh = (from: number) => Array.from({ length: 8 }, (_, n) => marker(from + n)).join('\n');
      const results = [];
      for (let upload = 0; upload < 4; upload++) {
        results.push(await controller.ingestLog(screenId, request(fresh(upload * 8))));
      }
      expect(results.map((r) => r.rows)).toEqual([8, 8, 8, 0]);
      expect(results[3]).toEqual({ stored: true, rows: 0, capped: true });
      expect(prisma.client.auditLog.create).toHaveBeenCalledTimes(MAX_AUDIT_ROWS_PER_SCREEN_HOUR);
      // Next hour: the withheld events were never marked seen.
      now += 60 * 60 * 1000;
      expect(await controller.ingestLog(screenId, request(fresh(24)))).toEqual({ stored: true, rows: 8 });
    } finally {
      jest.restoreAllMocks();
    }
  });

  test('another screen has its own budget', async () => {
    const redis = fakeRedis();
    controller = new PlayerLogsController(prisma, { publisher: redis } as any);
    for (let upload = 0; upload < 3; upload++) {
      await controller.ingestLog(screenId, request(Array.from({ length: 8 }, (_, n) => marker(upload * 8 + n)).join('\n')));
    }
    verify.mockResolvedValue({ ok: true, sub: 'other-screen', tenantId } as any);
    expect(await controller.ingestLog('other-screen', request(recovery))).toEqual({ stored: true, rows: 1 });
  });

  test('Redis down: events count as not seen, nothing throws, and the hourly cap still holds in-process', async () => {
    const results = [];
    for (let upload = 0; upload < 4; upload++) {
      results.push(await controller.ingestLog(screenId, request(Array.from({ length: 8 }, (_, n) => marker(n)).join('\n'))));
    }
    expect(results.map((r) => r.rows)).toEqual([8, 8, 8, 0]);
  });

  test('Redis erroring on every call behaves like Redis down — never a throw', async () => {
    const broken = {
      status: 'ready',
      set: jest.fn().mockRejectedValue(new Error('READONLY')),
      del: jest.fn().mockRejectedValue(new Error('READONLY')),
      decrby: jest.fn().mockRejectedValue(new Error('READONLY')),
      multi: jest.fn(() => { throw new Error('connection closed'); }),
    };
    controller = new PlayerLogsController(prisma, { publisher: broken } as any);
    expect(await controller.ingestLog(screenId, request(recovery))).toEqual({ stored: true, rows: 1 });
  });
});

describe('what reaches the immutable audit table', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0LXNjcmVlbiIsImtpbmQiOiJkZXZpY2UifQ.c2lnbmF0dXJlLWJ5dGVz';
  const secrets = [
    jwt,
    'eyJzdWIiOiJ0ZXN0',
    'sess-secret-123',
    'oauth-code-456',
    'hunter2pass',
    'opaque-bearer-789',
  ];
  const leaky = [
    '2026-09-29T17:30:00.000Z [INFO] MainActivity: URL overlay page started: https://portal.example.com/login?session=sess-secret-123#frag',
    '2026-09-29T17:30:01.000Z [INFO] MainActivity: web tabs: following sign-in to https://user:hunter2pass@idp.example.com/cb?code=oauth-code-456',
    `2026-09-29T17:30:02.000Z [WARN] Net: request failed Authorization: Bearer opaque-bearer-789 token=${jwt}`,
    '2026-09-29T17:30:03.000Z [WARN] Net: half a token eyJzdWIiOiJ0ZXN0',
  ];

  test('a crash record holds the log tail with no credential, URL query string, fragment or userinfo — within 10 KB', async () => {
    const body = ['x'.repeat(200), ...leaky, '2026-09-29T17:31:00.000Z [CRASH] UncaughtException: FATAL EXCEPTION main'].join('\n');
    await controller.ingestLog(screenId, request(body));
    const crash = created().find((d: any) => d.action === 'PLAYER_DIAGNOSTICS_CRASH');
    const log = JSON.parse(crash.details).log as string;
    for (const secret of secrets) expect(log).not.toContain(secret);
    expect(log).toContain('https://portal.example.com/login?[redacted]');
    expect(log).toContain('https://[redacted]@idp.example.com/cb?[redacted]');
    expect(log).toContain('FATAL EXCEPTION main');
    expect(log.length).toBeLessThanOrEqual(10_240);
  });

  test('a tail window cut in the middle of a long URL never keeps the scheme-less rest of its query', async () => {
    // A query long enough that the tail window (10 KB + 2 KB) starts INSIDE
    // it, made of characters no other rule redacts on its own.
    const head = '2026-09-29T17:00:00.000Z [INFO] MainActivity: URL overlay page started: https://cdn.example.com/a.mp4?';
    const query = 'q=' + 'tok.en.'.repeat(500);
    const crash = '\n2026-09-29T17:31:00.000Z [CRASH] UncaughtException: FATAL EXCEPTION main';
    const windowChars = 10_240 + 2048;
    const fillerChars = windowChars - (query.length - 500) - 1 - crash.length;
    const filler = 'filler line\n'.repeat(Math.ceil(fillerChars / 12)).slice(0, fillerChars);
    const body = `${head}${query}\n${filler}${crash}`;
    expect(body.length - windowChars).toBe(head.length + 500); // the cut lands 500 chars into the query
    await controller.ingestLog(screenId, request(body));
    const log = JSON.parse(created().find((d: any) => d.action === 'PLAYER_DIAGNOSTICS_CRASH').details).log;
    expect(log).not.toContain('tok.en');
    expect(log).toContain('FATAL EXCEPTION main');
  });

  test('a recovery line is redacted and held to 1 024 characters', async () => {
    const line = `2026-09-29T17:35:00Z WARN PLAYER_PLAYBACK_FAILURE src=https://cdn.example.com/v.mp4?sig=abc123secret ${jwt} ${'z '.repeat(1000)}`;
    await controller.ingestLog(screenId, request(line));
    const log = JSON.parse(created()[0].details).log as string;
    expect(log).not.toContain('abc123secret');
    expect(log).not.toContain(jwt);
    expect(log).toContain('https://cdn.example.com/v.mp4?[redacted]');
    expect(log.length).toBeLessThanOrEqual(1024);
  });

  test('every stored field is either bounded text or a fixed-shape value', async () => {
    await controller.ingestLog(screenId, request(`${recovery}\nFATAL EXCEPTION main`));
    for (const data of created()) {
      const details = JSON.parse(data.details);
      expect(Object.keys(details).sort()).toEqual(
        data.action === 'PLAYER_RECOVERY_EVENT'
          ? ['crashDetected', 'jwtVerified', 'log', 'recoveryEventId', 'screenId', 'source']
          : ['bodyBytes', 'crashDetected', 'jwtVerified', 'log', 'screenId', 'source', 'truncated'],
      );
      expect(details.screenId).toBe(screenId);
      expect(details.source).toBe('android_apk');
    }
  });
});
