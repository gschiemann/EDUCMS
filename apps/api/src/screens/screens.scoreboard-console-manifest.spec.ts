/**
 * K12-F32 — what `GET /screens/:id/manifest` tells a box that reads a
 * scoreboard console: which game its console feeds and the decoder for that
 * game's sport — in the normal body, the "nothing scheduled" body and while
 * the box SHOWS a board — and nothing at all for every other screen, so no
 * ETag moves fleet-wide. The emergency branch is untouched.
 */
import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import {
  markManifestRevHookArmed,
  resetManifestCacheForTests,
} from './manifest-hot-cache';
import { resetEmergencyRevForTests } from './emergency-rev';
import {
  invalidateDeviceCredentialCache,
  setDeviceCredentialSharedStore,
} from './device-auth';
import { clearDisplayManifestCache } from '../display/display-manifest';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const TENANT = 'tenant-sbc';
const BOX = 'screen-console-box';

let nowMs = 1_780_000_000_000;
beforeAll(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterAll(() => {
  jest.restoreAllMocks();
});

type Row = Record<string, any>;

const BOUND_CONFIG = {
  wiring: { rs232_1: 'cts', rs232_2: 'off' },
  consoleProfile: 'daktronics-allsport',
  scoreboardConsole: {
    gameId: 'game-hoops',
    sport: 'basketball',
    boundAt: '2026-09-27T10:00:00.000Z',
    boundBy: 'user-1',
    confirmedAt: null,
    confirmedBy: null,
  },
};

function row(over: Row = {}): Row {
  return {
    id: BOX,
    tenantId: TENANT,
    screenGroupId: null,
    status: 'ONLINE',
    name: 'Gym console box',
    orientation: 'LANDSCAPE',
    resolution: '1920x1080',
    canvasW: null,
    canvasH: null,
    repeats: 1,
    config: null,
    hardwareModel: 'goodview-ecbox3576',
    displayCapabilities: null,
    activeBoardGameId: null,
    activeBoardSurface: null,
    syncOffsetMs: 0,
    pendingRefreshAt: null,
    credentialEpoch: 0,
    credentialEpochRotatedAt: null,
    faceOfScreenId: null,
    faceIndex: null,
    faceContentMode: null,
    ...over,
  };
}

function harness(
  screen: Row,
  opts: { scheduled?: boolean; emergency?: boolean } = {},
) {
  const client: Record<string, any> = {
    screen: {
      findUnique: jest.fn(async (args: any) =>
        args?.where?.id === BOX ? screen : null,
      ),
      update: jest.fn(async () => ({ id: BOX })),
      findMany: jest.fn(async () => []),
    },
    screenGroup: { findUnique: jest.fn(async () => null) },
    tenant: {
      findUnique: jest.fn(async (args: any) =>
        args?.select?.emergencyStatus
          ? {
              id: TENANT,
              parentId: null,
              archivedAt: null,
              emergencyStatus: opts.emergency ? 'CRITICAL' : 'INACTIVE',
              emergencyType: opts.emergency ? 'LOCKDOWN' : null,
              emergencyPlaylistId: opts.emergency ? 'pl-lockdown' : null,
              emergencyPortraitPlaylistId: null,
              locationBasedEmergencyEnabled: false,
            }
          : {
              name: 'Central High',
              posterStandardW: null,
              posterStandardH: null,
            },
      ),
    },
    screenEmergencyOverride: { findUnique: jest.fn(async () => null) },
    game: {
      findFirst: jest.fn(async (args: any) =>
        args?.where?.id === screen.activeBoardGameId &&
        args?.where?.tenantId === TENANT
          ? { id: screen.activeBoardGameId }
          : null,
      ),
    },
    playlist: {
      findUnique: jest.fn(async () => ({
        id: 'pl-lockdown',
        name: 'Lockdown',
        items: [
          {
            id: 'i1',
            assetId: 'a1',
            durationMs: 10000,
            sequenceOrder: 0,
            transitionType: null,
            asset: {
              fileUrl: 'https://x/lockdown.png',
              fileHash: 'h',
              mimeType: 'image/png',
            },
          },
        ],
      })),
    },
    schedule: {
      findMany: jest.fn(async () =>
        opts.scheduled
          ? [
              {
                id: 'sch-1',
                playlistId: 'pl-lobby',
                screenId: BOX,
                screenGroupId: null,
                priority: 0,
                mode: 'replace',
                startTime: new Date(nowMs - 1000),
                endTime: null,
                daysOfWeek: null,
                timeStart: null,
                timeEnd: null,
                mutedOverride: null,
                playlist: {
                  id: 'pl-lobby',
                  name: 'Lobby',
                  items: [],
                  template: null,
                },
              },
            ]
          : [],
      ),
      findFirst: jest.fn(async () => null),
    },
    displaySchedule: { findMany: jest.fn(async () => []) },
    displayVendorRecipe: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async () => ({})) },
  };
  const redis = {
    isConnected: () => false,
    getString: jest.fn(async () => null),
    setString: jest.fn(async () => true),
    delKey: jest.fn(async () => true),
    publish: jest.fn(async () => undefined),
  };
  return new ScreensController(
    { client } as any,
    redis as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

async function manifest(controller: ScreensController, etag?: string) {
  const res: any = { statusCode: null, body: undefined, headers: {} };
  res.setHeader = (k: string, v: string) => (
    (res.headers[k.toLowerCase()] = v),
    res
  );
  res.status = (c: number) => ((res.statusCode = c), res);
  res.json = (p: any) => ((res.body = p), res);
  res.send = () => res;
  res.end = () => res;
  const req = {
    headers: {
      ...(etag ? { 'if-none-match': etag } : {}),
      authorization: `Bearer ${jwt.sign(
        { sub: BOX, kind: 'device', ep: 0, fp: 'fp-test' },
        DEVICE_JWT_SECRET,
        {
          expiresIn: '180d',
        },
      )}`,
    },
    ip: '10.0.0.9',
    socket: { remoteAddress: '10.0.0.9' },
    user: { id: BOX, sub: BOX, kind: 'device', tenantId: TENANT },
  } as any;
  await controller.getManifest(BOX, req, res as any);
  return res;
}

beforeEach(() => {
  nowMs += 3_600_000;
  resetManifestCacheForTests();
  resetEmergencyRevForTests();
  clearDisplayManifestCache();
  invalidateDeviceCredentialCache();
  setDeviceCredentialSharedStore(null);
  markManifestRevHookArmed();
});

const EXPECTED_BLOCK = {
  gameId: 'game-hoops',
  sport: 'basketball',
  sportName: 'Basketball',
  consoleProfile: 'daktronics-allsport',
  decoder: 'daktronics',
  decoderSport: 'basketball',
  confirmed: false,
};

describe('a box bound to a game learns it from its manifest (K12-F32)', () => {
  it('delivers and clears durable refresh requests while showing a live board, including conditional polls', async () => {
    const screen = row({
      activeBoardGameId: 'game-hoops',
      activeBoardSurface: 'BOARD',
    });
    const controller = harness(screen);
    const read = async (etag?: string) =>
      (await manifest(controller, etag)) as {
        statusCode: number;
        body: { refreshRequestedAt: number | null };
        headers: Record<string, string>;
      };
    const initial = await read();
    const value = nowMs - 1000;
    screen.pendingRefreshAt = new Date(value);
    const requested = await read(initial.headers.etag);
    expect(requested.statusCode).toBe(200);
    expect(requested.body.refreshRequestedAt).toBe(value);
    expect(requested.headers.etag).not.toBe(initial.headers.etag);
    expect((await read(requested.headers.etag)).statusCode).toBe(304);
    screen.pendingRefreshAt = null;
    const acked = await read(requested.headers.etag);
    expect(acked.statusCode).toBe(200);
    expect(acked.body.refreshRequestedAt).toBeNull();
    expect(acked.headers.etag).toBe(initial.headers.etag);
  });

  it('in the normal body', async () => {
    const res = await manifest(
      harness(row({ config: BOUND_CONFIG }), { scheduled: true }),
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.playlists).toHaveLength(1);
    expect(res.body.scoreboardConsole).toMatchObject(EXPECTED_BLOCK);
  });

  it('in the "nothing scheduled" body — a console box often shows nothing else', async () => {
    const res = await manifest(harness(row({ config: BOUND_CONFIG })));
    expect(res.body.emptyReason).toBe('NO_SCHEDULE');
    expect(res.body.scoreboardConsole).toMatchObject(EXPECTED_BLOCK);
  });

  it('while it SHOWS a board: wiring, console model and binding all ride along', async () => {
    const res = await manifest(
      harness(
        row({
          config: BOUND_CONFIG,
          activeBoardGameId: 'game-hoops',
          activeBoardSurface: 'RIBBON',
        }),
      ),
    );
    expect(res.body.playlists[0]).toBeDefined();
    expect(res.body.wiring).toEqual({ rs232_1: 'cts', rs232_2: 'off' });
    expect(res.body.consoleProfile).toBe('daktronics-allsport');
    expect(res.body.scoreboardConsole).toMatchObject(EXPECTED_BLOCK);
  });

  it('a console model that cannot read the sport is stated, not defaulted', async () => {
    const res = await manifest(
      harness(row({ config: { ...BOUND_CONFIG, consoleProfile: 'cts-gen6' } })),
    );
    expect(res.body.scoreboardConsole).toMatchObject({
      decoder: 'cts',
      decoderSport: null,
      supportedSportNames: ['Water Polo'],
    });
  });
});

describe('every other screen pays nothing', () => {
  it('no key in the normal, empty or board bodies of an unbound screen', async () => {
    const normal = await manifest(harness(row(), { scheduled: true }));
    expect(normal.body).not.toHaveProperty('scoreboardConsole');
    nowMs += 3_600_000;
    resetManifestCacheForTests();
    const empty = await manifest(harness(row()));
    expect(empty.body).not.toHaveProperty('scoreboardConsole');
    nowMs += 3_600_000;
    resetManifestCacheForTests();
    const board = await manifest(
      harness(
        row({ activeBoardGameId: 'game-hoops', activeBoardSurface: 'BOARD' }),
      ),
    );
    expect(board.body).not.toHaveProperty('scoreboardConsole');
    expect(board.body).not.toHaveProperty('wiring');
    expect(board.body).not.toHaveProperty('consoleProfile');
  });

  it('the emergency branch is unchanged — it carries no console block', async () => {
    const res = await manifest(
      harness(row({ config: BOUND_CONFIG }), { emergency: true }),
    );
    expect(res.body.isEmergency).toBe(true);
    expect(res.body).not.toHaveProperty('scoreboardConsole');
  });
});
