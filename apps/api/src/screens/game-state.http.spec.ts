/**
 * POST /api/v1/screens/:id/game-state OVER REAL HTTP (2026-11-23, SDW-02).
 *
 * What the route now requires, each proved through a real request:
 *   1. A device credential for a PAIRED screen (a screen with no tenant: 401).
 *   2. A body of at most 16 KB (413), refused by the route's own parser before
 *      it is read in full, with a Content-Length backstop in the handler.
 *   3. A snapshot of the documented shape and bounds (400).
 *   4. At most 1200 requests a minute per client ADDRESS, whatever device
 *      credentials it presents (429).
 * and, just as important, that a live game still works: snapshots built by the
 * real decoders in `@cms/scoreboard-cts` from real console captures, and a
 * bridge posting at its real 5 Hz for a whole minute, are all accepted, signed
 * with the unchanged GAME_STATE signer and published on `device:<id>`.
 *
 * The app is wired like main.ts (route parser, then the global 5 MB parser, the
 * global exception filter, the ClientIpThrottlerGuard). Only Prisma and Redis
 * are doubles; device auth, the signer and the throttler are the real ones.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import { json, urlencoded } from 'express';
import * as jwt from 'jsonwebtoken';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

import {
  CtsWireParser,
  DaktronicsParser,
  MockDaktronicsFeed,
  type CtsFullSnapshot,
  type DaktronicsSnapshot,
  type DaktronicsSport,
} from '@cms/scoreboard-cts';
import { ScreensController, _gameStateRateMap } from './screens.controller';
import { mountGameStateBodyParser } from './game-state-body';
import {
  GAME_STATE_ADDRESS_LIMIT_PER_MIN,
  GAME_STATE_BRIDGE_MIN_INTERVAL_MS,
  GAME_STATE_FIRST_BRIDGE_MIN_INTERVAL_MS,
  GAME_STATE_MAX_BODY_BYTES,
  GAME_STATE_MAX_EXCLUSIONS,
  GAME_STATE_MAX_TEXT,
  parseGameStateBody,
} from './game-state';
import { invalidateDeviceCredentialCache } from './device-auth';
import {
  DEVICE_ROUTE_LIMIT,
  DEVICE_THROTTLE_ROUTES,
} from '../security/device-throttle-key';
import { ClientIpThrottlerGuard } from '../security/client-ip-throttler.guard';
import { AllExceptionsFilter } from '../common/all-exceptions.filter';
import { WebsocketSignerService } from '../security/websocket-signer.service';
import { verifyWsHmac } from '../security/ws-signature';
import { deviceSecretKeyRing } from '../security/key-ring';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { LicenseService } from '../license/license.service';
import { StripeService } from '../billing/stripe.service';
import { MenuService } from '../pos/menu.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const PAIRED = 'screen-gs-paired';
const UNPAIRED = 'screen-gs-unpaired';
const TENANT = 'tenant-gs';

function deviceToken(screenId: string): string {
  return jwt.sign(
    { sub: screenId, deviceId: screenId, kind: 'device', ep: 0 },
    DEVICE_JWT_SECRET,
    {
      expiresIn: '180d',
    },
  );
}

/** The live Screen row device auth reads. A screen whose id starts with the
 *  unpaired prefix has no tenant; every other id is paired. */
function screenRow(id: string) {
  return {
    id,
    tenantId: id.startsWith(UNPAIRED) ? null : TENANT,
    screenGroupId: null,
    status: 'ONLINE',
    credentialEpoch: 0,
    credentialEpochRotatedAt: null,
  };
}

// ─── real producer snapshots ──────────────────────────────────────────────────

const CTS_FIXTURES = path.join(
  path.dirname(require.resolve('@cms/scoreboard-cts/package.json')),
  'src',
  '__tests__',
  'fixtures',
);

/** A deep copy through JSON — exactly what reaches the API. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Every snapshot the classic CTS decoder emits for a real console capture. */
function ctsFromCapture(file: string): CtsFullSnapshot[] {
  const parser = new CtsWireParser({ wire: 'classic' });
  const out: CtsFullSnapshot[] = [];
  parser.onUpdate((s) => out.push(clone(s)));
  parser.feed(new Uint8Array(fs.readFileSync(path.join(CTS_FIXTURES, file))));
  return out;
}

/** The last snapshot of a full Daktronics game state for one sport. */
function daktronicsFullState(sport: DaktronicsSport): DaktronicsSnapshot {
  const parser = new DaktronicsParser({ sport });
  let last: DaktronicsSnapshot | null = null;
  parser.onUpdate((s) => {
    last = clone(s);
  });
  const extra: Record<DaktronicsSport, Record<string, string | number>> = {
    football: { down: '4th', toGo: 99, ballOn: 50, playClock: ':25' },
    basketball: { homeTeamFouls: 9, guestTeamFouls: 9, shotClock: '24' },
    baseball: {
      balls: 3,
      strikes: 2,
      outs: 2,
      homeHits: 9,
      guestHits: 9,
      batterNumber: 23,
    },
  };
  new MockDaktronicsFeed((b) => parser.feed(b)).pushInitialState(sport, {
    clock: '12:00',
    period: 4,
    homeScore: 199,
    awayScore: 199,
    homeTimeouts: 5,
    awayTimeouts: 5,
    extra: extra[sport],
  });
  if (!last) throw new Error(`no ${sport} snapshot decoded`);
  return last;
}

/** The largest CTS snapshot the decoders build (three exclusions a side). */
function worstCaseCts(): CtsFullSnapshot {
  const ex = [0, 1, 2].map(() => ({ playerJersey: 99, secondsRemaining: 20 }));
  const shot = { raw: '30', ms: 30_000, running: true };
  return {
    clock: ':59.9',
    period: 9,
    homeScore: 999,
    awayScore: 999,
    homeShotClock: shot,
    awayShotClock: shot,
    homeExclusions: ex,
    awayExclusions: ex.map((e) => ({ ...e })),
    homeTimeoutsRemaining: 9,
    awayTimeoutsRemaining: 9,
    horn: true,
    receivedAt: 1_795_395_372_729,
  };
}

/** What the first bridge build (2026-05-26) posted: string shot clocks. */
function firstBuildCts(): Record<string, unknown> {
  return { ...worstCaseCts(), homeShotClock: '30', awayShotClock: '' };
}

// ─── the app ─────────────────────────────────────────────────────────────────

let app: INestApplication | undefined;
let http: Parameters<typeof request>[0];
let publish: jest.Mock;
let findUnique: jest.Mock;
let signSpy: jest.SpyInstance;
// `new Date()` reads the real clock even while `Date.now` is mocked.
const realNow = (): number => new Date().getTime();
let clock = realNow();

async function boot(
  opts: { withRouteParser: boolean } = { withRouteParser: true },
) {
  publish = jest.fn(() => Promise.resolve(1));
  findUnique = jest.fn((args: { where: { id: string } }) =>
    Promise.resolve(screenRow(args.where.id)),
  );
  const signer = new WebsocketSignerService();
  signSpy = jest.spyOn(signer, 'signMessage');
  const moduleRef = await Test.createTestingModule({
    // In-memory storage, same limits as app.module.ts.
    imports: [
      ThrottlerModule.forRoot({ throttlers: [{ ttl: 60_000, limit: 600 }] }),
    ],
    controllers: [ScreensController],
    providers: [
      {
        provide: PrismaService,
        useValue: { client: { screen: { findUnique } } },
      },
      {
        provide: RedisService,
        useValue: { publish, sismember: jest.fn(() => Promise.resolve(false)) },
      },
      { provide: WebsocketSignerService, useValue: signer },
      { provide: LicenseService, useValue: {} },
      { provide: StripeService, useValue: {} },
      { provide: MenuService, useValue: {} },
      { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
    ],
  })
    // The session guards on the controller's OTHER routes; this route has none.
    .overrideGuard(JwtAuthGuard)
    .useValue({ canActivate: () => false })
    .overrideGuard(RbacGuard)
    .useValue({ canActivate: () => false })
    .compile();
  // main.ts order: global filter, route-scoped parsers, then the global parsers.
  app = moduleRef.createNestApplication({ rawBody: true, logger: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  if (opts.withRouteParser) mountGameStateBodyParser(app);
  app.use(json({ limit: '5mb' }));
  app.use(urlencoded({ limit: '5mb', extended: true }));
  // Listening once up front, so concurrent requests share one server.
  await app.listen(0, '127.0.0.1');
  http = app.getHttpServer() as Parameters<typeof request>[0];
}

function post(
  screenId: string,
  body: unknown,
  opts: { token?: string | null; ip?: string; path?: string } = {},
) {
  const token = opts.token === undefined ? deviceToken(screenId) : opts.token;
  let r = request(http)
    .post(opts.path ?? `/api/v1/screens/${screenId}/game-state`)
    .set('X-Forwarded-For', `${opts.ip ?? '198.51.100.7'}, 10.0.0.1`)
    .set('Content-Type', 'application/json');
  if (token) r = r.set('Authorization', `Bearer ${token}`);
  return r.send(typeof body === 'string' ? body : JSON.stringify(body));
}

/** A signed envelope as handed to Redis. */
interface PublishedMessage {
  eventId: string;
  timestamp: number;
  type: string;
  signature?: string;
  payload: {
    screenId: string;
    source: string;
    snapshot: Record<string, unknown>;
  };
}

/** Every message handed to Redis, with its channel. */
function published(): Array<{ channel: string; message: PublishedMessage }> {
  return (publish.mock.calls as Array<[string, PublishedMessage]>).map(
    ([channel, message]) => ({
      channel,
      message,
    }),
  );
}

/** The machine code of an error answer. */
function codeOf(res: request.Response): unknown {
  return (res.body as { code?: unknown }).code;
}

/** The human message of an error answer. */
function messageOf(res: request.Response): unknown {
  return (res.body as { message?: unknown }).message;
}

/** The JSON body of an answer. */
function bodyOf(res: request.Response): unknown {
  return res.body as unknown;
}

beforeEach(() => {
  _gameStateRateMap.clear();
  invalidateDeviceCredentialCache();
  clock = realNow();
  jest.spyOn(Date, 'now').mockImplementation(() => clock);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await app?.close();
  app = undefined;
});

// ─── 1. paired vs unpaired ───────────────────────────────────────────────────

describe('a device credential for a PAIRED screen is required', () => {
  it('a paired screen is accepted, signed as GAME_STATE and published on its own channel', async () => {
    await boot();
    const snapshot = worstCaseCts();
    const res = await post(PAIRED, { source: 'cts', snapshot });
    expect(res.status).toBe(201);
    expect(bodyOf(res)).toEqual({ ok: true });
    const [{ channel, message }] = published();
    expect(channel).toBe(`device:${PAIRED}`);
    expect(message.type).toBe('GAME_STATE');
    expect(message.payload).toEqual({
      screenId: PAIRED,
      source: 'cts',
      snapshot,
    });
    // Same key as before this change: the player and the fan-out gate verify it.
    expect(verifyWsHmac(message, deviceSecretKeyRing().primary)).toEqual({
      ok: true,
    });
  });

  it('a screen with NO tenant gets 401 and nothing is signed or published', async () => {
    await boot();
    const res = await post(UNPAIRED, {
      source: 'cts',
      snapshot: worstCaseCts(),
    });
    expect(res.status).toBe(401);
    expect(codeOf(res)).toBe('SCREEN_DEVICE_AUTH_REQUIRED');
    expect(signSpy).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('no credential, and a credential for a different screen, get 401', async () => {
    await boot();
    expect(
      (await post(PAIRED, { snapshot: worstCaseCts() }, { token: null }))
        .status,
    ).toBe(401);
    expect(
      (
        await post(
          PAIRED,
          { snapshot: worstCaseCts() },
          { token: deviceToken('screen-gs-other') },
        )
      ).status,
    ).toBe(401);
    expect(publish).not.toHaveBeenCalled();
  });
});

// ─── 2. body size ────────────────────────────────────────────────────────────

describe('a body over 16 KB is refused before anything else runs', () => {
  const oversize = () => ({
    source: 'cts',
    snapshot: { ...worstCaseCts(), pad: 'x'.repeat(20_000) },
  });

  it('the route parser answers 413; device auth, signer and Redis never run', async () => {
    await boot();
    const res = await post(PAIRED, oversize());
    expect(res.status).toBe(413);
    expect(codeOf(res)).toBe('SCREEN_GAME_STATE_BODY_TOO_LARGE');
    expect(messageOf(res)).toBe('Body exceeds 16 KB');
    expect(findUnique).not.toHaveBeenCalled();
    expect(signSpy).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('the limit is exactly GAME_STATE_MAX_BODY_BYTES', async () => {
    await boot();
    const base = JSON.stringify({ source: 'cts', snapshot: worstCaseCts() });
    // An unlisted key is dropped, not refused, so padding with one is a clean
    // way to land on an exact size.
    const at = (bytes: number) => {
      const pad = 'x'.repeat(bytes - base.length - ',"pad":""'.length);
      return `${base.slice(0, -2)},"pad":"${pad}"}}`;
    };
    expect(Buffer.byteLength(at(GAME_STATE_MAX_BODY_BYTES))).toBe(
      GAME_STATE_MAX_BODY_BYTES,
    );
    expect((await post(PAIRED, at(GAME_STATE_MAX_BODY_BYTES))).status).toBe(
      201,
    );
    _gameStateRateMap.clear();
    expect((await post(PAIRED, at(GAME_STATE_MAX_BODY_BYTES + 1))).status).toBe(
      413,
    );
  });

  it('a differently cased path reaches the handler, and is bounded by the same parser', async () => {
    await boot();
    const upper = `/API/V1/SCREENS/${PAIRED}/GAME-STATE`;
    // The router matches regardless of case, so the parser must too.
    expect(
      (
        await post(
          PAIRED,
          { source: 'cts', snapshot: worstCaseCts() },
          { path: upper },
        )
      ).status,
    ).toBe(201);
    publish.mockClear();
    _gameStateRateMap.clear();
    const res = await post(PAIRED, oversize(), { path: upper });
    expect(res.status).toBe(413);
    expect(publish).not.toHaveBeenCalled();
  });

  it('without the route parser, the handler still refuses a declared oversize body (backstop)', async () => {
    await boot({ withRouteParser: false });
    const res = await post(PAIRED, oversize());
    expect(res.status).toBe(413);
    expect(codeOf(res)).toBe('SCREEN_GAME_STATE_BODY_TOO_LARGE');
    expect(messageOf(res)).toBe('Body exceeds 16 KB');
    expect(publish).not.toHaveBeenCalled();
  });

  it('main.ts mounts the route parser BEFORE the global JSON parser', () => {
    const main = fs.readFileSync(path.join(__dirname, '..', 'main.ts'), 'utf8');
    const mount = main.indexOf('mountGameStateBodyParser(app)');
    const globalJson = main.indexOf("expressBody.json({ limit: '5mb' })");
    expect(mount).toBeGreaterThan(-1);
    expect(globalJson).toBeGreaterThan(-1);
    expect(mount).toBeLessThan(globalJson);
  });
});

// ─── 3. shape and bounds ─────────────────────────────────────────────────────

describe('the snapshot must have the documented shape and bounds', () => {
  const ok = worstCaseCts();
  const invalid: Array<[string, unknown]> = [
    ['no clock', { snapshot: { ...ok, clock: undefined } }],
    [
      'a clock longer than the text bound',
      { snapshot: { ...ok, clock: 'x'.repeat(GAME_STATE_MAX_TEXT + 1) } },
    ],
    ['a score that is a string', { snapshot: { ...ok, homeScore: '3' } }],
    [
      'a score past the counter bound',
      { snapshot: { ...ok, awayScore: 1e12 } },
    ],
    ['a negative timestamp', { snapshot: { ...ok, receivedAt: -1 } }],
    [
      'too many exclusions',
      {
        snapshot: {
          ...ok,
          homeExclusions: Array.from(
            { length: GAME_STATE_MAX_EXCLUSIONS + 1 },
            () => ok.homeExclusions[0],
          ),
        },
      },
    ],
    [
      'an exclusion that is not an object',
      { snapshot: { ...ok, awayExclusions: ['7'] } },
    ],
    [
      'a shot clock that is a number',
      { snapshot: { ...ok, homeShotClock: 30 } },
    ],
    [
      'a Daktronics block with a long field',
      {
        snapshot: {
          ...ok,
          football: { down: 'x'.repeat(GAME_STATE_MAX_TEXT + 1) },
        },
      },
    ],
    [
      'a possession outside home/away',
      { snapshot: { ...ok, basketball: { possession: 'both' } } },
    ],
    ['a horn that is not a boolean', { snapshot: { ...ok, horn: 'yes' } }],
    ['a source that is not a string', { source: 7, snapshot: ok }],
    ['a source past its bound', { source: 'x'.repeat(33), snapshot: ok }],
  ];

  it.each(invalid)(
    '%s is a 400 and nothing is published',
    async (_label, body) => {
      await boot();
      const res = await post(PAIRED, body);
      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe('SCREEN_GAME_STATE_SNAPSHOT_INVALID');
      expect(signSpy).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['missing', { source: 'cts' }],
    ['a string', { snapshot: 'score' }],
    ['an array', { snapshot: [ok] }],
    ['null', { snapshot: null }],
  ])(
    'a snapshot that is %s keeps the original 400 code',
    async (_label, body) => {
      await boot();
      const res = await post(PAIRED, body);
      expect(res.status).toBe(400);
      expect(codeOf(res)).toBe('SCREEN_GAME_STATE_SNAPSHOT_REQUIRED');
      expect(publish).not.toHaveBeenCalled();
    },
  );

  it('a body that is not JSON is a 400', async () => {
    await boot();
    const res = await post(PAIRED, '{"snapshot": ');
    expect(res.status).toBe(400);
    expect(publish).not.toHaveBeenCalled();
  });

  it('an unlisted key is dropped from the published copy, not refused', async () => {
    await boot();
    const res = await post(PAIRED, {
      source: 'cts',
      snapshot: { ...ok, futureField: 'x' },
      extra: 1,
    });
    expect(res.status).toBe(201);
    const [{ message }] = published();
    expect(message.payload.snapshot).toEqual(ok);
    expect(message.payload.snapshot).not.toHaveProperty('futureField');
    expect(message.payload).not.toHaveProperty('extra');
  });

  it('a number the decoder could not read (NaN, serialised as null) is accepted', () => {
    expect(
      parseGameStateBody({ snapshot: { ...ok, homeScore: null } }),
    ).toMatchObject({ ok: true });
  });
});

// ─── 4. a live game still works ──────────────────────────────────────────────

describe('every real producer shape is accepted and published unchanged', () => {
  const cases: Array<
    [string, () => Array<{ source: string; snapshot: unknown }>]
  > = [
    [
      'CTS classic, real capture meet.bin',
      () =>
        ctsFromCapture('meet.bin').map((s) => ({ source: 'cts', snapshot: s })),
    ],
    [
      'CTS classic, real capture blank.bin',
      () =>
        ctsFromCapture('blank.bin').map((s) => ({
          source: 'cts',
          snapshot: s,
        })),
    ],
    [
      'CTS classic, real capture totalBlank.bin',
      () =>
        ctsFromCapture('totalBlank.bin').map((s) => ({
          source: 'cts',
          snapshot: s,
        })),
    ],
    [
      'CTS worst case (3 + 3 exclusions)',
      () => [{ source: 'cts', snapshot: worstCaseCts() }],
    ],
    [
      'the first bridge build (string shot clocks)',
      () => [{ source: 'cts', snapshot: firstBuildCts() }],
    ],
    [
      'Daktronics football',
      () => [
        { source: 'daktronics', snapshot: daktronicsFullState('football') },
      ],
    ],
    [
      'Daktronics basketball',
      () => [
        { source: 'daktronics', snapshot: daktronicsFullState('basketball') },
      ],
    ],
    [
      'Daktronics baseball',
      () => [
        { source: 'daktronics', snapshot: daktronicsFullState('baseball') },
      ],
    ],
  ];

  it.each(cases)('%s', async (_label, build) => {
    const bodies = build();
    expect(bodies.length).toBeGreaterThan(0);
    await boot();
    for (const body of bodies) {
      _gameStateRateMap.clear();
      publish.mockClear();
      // A real body is a few hundred bytes.
      expect(Buffer.byteLength(JSON.stringify(body))).toBeLessThan(1024);
      const res = await post(PAIRED, body);
      expect(res.status).toBe(201);
      const [{ channel, message }] = published();
      expect(channel).toBe(`device:${PAIRED}`);
      expect(message.payload).toEqual({ screenId: PAIRED, ...body });
      expect(verifyWsHmac(message, deviceSecretKeyRing().primary)).toEqual({
        ok: true,
      });
    }
  });
});

// ─── 5. rate ─────────────────────────────────────────────────────────────────

/** The two tests below send hundreds of real requests; under a loaded CI
 *  runner that takes longer than Jest's 5 s default. */
const MANY_REQUESTS_TIMEOUT_MS = 120_000;

describe('rate: a ceiling per address, headroom for the real bridge', () => {
  it('the route throttles (no SkipThrottle) and is keyed on the address, not the device', () => {
    const handler = Reflect.get(
      ScreensController.prototype,
      'postGameState',
    ) as object;
    expect(
      Reflect.getMetadata('THROTTLER:SKIPdefault', handler),
    ).toBeUndefined();
    expect(Reflect.getMetadata('THROTTLER:LIMITdefault', handler)).toBe(
      GAME_STATE_ADDRESS_LIMIT_PER_MIN,
    );
    expect(Reflect.getMetadata('THROTTLER:TTLdefault', handler)).toBe(60_000);
    expect(DEVICE_THROTTLE_ROUTES).not.toContain(
      'ScreensController#postGameState',
    );
  });

  it('the ceiling leaves headroom over the measured bridge rates', () => {
    const perMin = (intervalMs: number) => 60_000 / intervalMs;
    // Today's bridge (5 Hz) and the first build (8 Hz), at their maximum.
    expect(GAME_STATE_ADDRESS_LIMIT_PER_MIN).toBeGreaterThanOrEqual(
      4 * perMin(GAME_STATE_BRIDGE_MIN_INTERVAL_MS),
    );
    expect(GAME_STATE_ADDRESS_LIMIT_PER_MIN).toBeGreaterThanOrEqual(
      2 * perMin(GAME_STATE_FIRST_BRIDGE_MIN_INTERVAL_MS),
    );
    // The device-keyed clamp sits exactly at a 5 Hz bridge's maximum, which is
    // why this route is keyed on the address instead.
    expect(DEVICE_ROUTE_LIMIT).toBeLessThanOrEqual(
      perMin(GAME_STATE_BRIDGE_MIN_INTERVAL_MS),
    );
  });

  it(
    'a bridge posting at its real 5 Hz for a full minute is never throttled and every post is published',
    async () => {
      await boot();
      const posts = 60_000 / GAME_STATE_BRIDGE_MIN_INTERVAL_MS + 20; // a minute, plus a little more
      const statuses = new Map<number, number>();
      for (let i = 0; i < posts; i++) {
        const snap = {
          ...worstCaseCts(),
          clock: `:${String(59 - (i % 60)).padStart(2, '0')}.${i % 10}`,
        };
        const res = await post(PAIRED, { source: 'cts', snapshot: snap });
        statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        clock += GAME_STATE_BRIDGE_MIN_INTERVAL_MS;
      }
      expect(Object.fromEntries(statuses)).toEqual({ 201: posts });
      expect(publish).toHaveBeenCalledTimes(posts);
    },
    MANY_REQUESTS_TIMEOUT_MS,
  );

  it(
    'an address is capped at the ceiling even when every request carries a different paired credential',
    async () => {
      await boot();
      const statuses = new Map<number, number>();
      // In batches, so the run stays short; the clock is frozen, so every
      // request lands in the same 60 s window.
      const BATCH = 50;
      for (let i = 0; i < GAME_STATE_ADDRESS_LIMIT_PER_MIN; i += BATCH) {
        const batch = Array.from({ length: BATCH }, (_, j) =>
          post(
            `screen-gs-many-${i + j}`,
            { source: 'cts', snapshot: worstCaseCts() },
            { ip: '203.0.113.50' },
          ),
        );
        for (const res of await Promise.all(batch)) {
          statuses.set(res.status, (statuses.get(res.status) ?? 0) + 1);
        }
      }
      expect(Object.fromEntries(statuses)).toEqual({
        201: GAME_STATE_ADDRESS_LIMIT_PER_MIN,
      });
      const publishedBefore = publish.mock.calls.length;

      const over = await post(
        'screen-gs-many-over',
        { source: 'cts', snapshot: worstCaseCts() },
        { ip: '203.0.113.50' },
      );
      expect(over.status).toBe(429);
      expect(publish.mock.calls.length).toBe(publishedBefore);

      // Another address is unaffected.
      const elsewhere = await post(
        'screen-gs-many-over',
        { source: 'cts', snapshot: worstCaseCts() },
        { ip: '203.0.113.51' },
      );
      expect(elsewhere.status).toBe(201);
    },
    MANY_REQUESTS_TIMEOUT_MS,
  );

  it('the per-screen floor still collapses a burst from one screen to 16 Hz', async () => {
    await boot();
    const first = await post(PAIRED, {
      source: 'cts',
      snapshot: worstCaseCts(),
    });
    const second = await post(PAIRED, {
      source: 'cts',
      snapshot: worstCaseCts(),
    });
    expect(bodyOf(first)).toEqual({ ok: true });
    expect(bodyOf(second)).toEqual({ ok: true, throttled: true });
    expect(publish).toHaveBeenCalledTimes(1);
  });
});
