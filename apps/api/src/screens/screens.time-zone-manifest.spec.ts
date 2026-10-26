/**
 * GET /screens/:id/manifest — the per-screen `timeZone` field (2026-10-24).
 *
 * What the player must be able to rely on:
 *   1. The normal (full) manifest ALWAYS carries `timeZone`: the automatic
 *      zone from the location's coordinates when nothing is set, the
 *      location's setting over that, the screen's override over everything —
 *      and `null` when nothing resolves ("use the device's zone").
 *   2. The "no content scheduled" body carries it too (a splash clock is a
 *      clock), and the zone is part of the hashed payload, so changing the
 *      override moves the ETag.
 *   3. LIFE-SAFETY: the EMERGENCY branch is untouched — its payload carries
 *      no `timeZone` key, which the player reads as "keep what you had".
 *
 * Harness: the face-manifest spec's prisma double, trimmed to one screen.
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
const TENANT = 'tenant-tz';
const SCREEN = 'screen-tz';
const GROUP = 'group-tz';

const LA = { latitude: 34.0522, longitude: -118.2437 };
const CLEVELAND = { latitude: 41.4993, longitude: -81.6944 };

let nowMs = 1_780_000_000_000;
beforeAll(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterAll(() => {
  jest.restoreAllMocks();
});

type Row = Record<string, any>;

function screenRow(over: Row = {}): Row {
  return {
    id: SCREEN,
    tenantId: TENANT,
    screenGroupId: GROUP,
    status: 'ONLINE',
    name: 'Lobby',
    orientation: 'LANDSCAPE',
    resolution: '1920x1080',
    canvasW: null,
    canvasH: null,
    repeats: 1,
    config: null,
    hardwareModel: null,
    displayCapabilities: null,
    activeBoardGameId: null,
    syncOffsetMs: 0,
    pendingRefreshAt: null,
    credentialEpoch: 0,
    credentialEpochRotatedAt: null,
    faceOfScreenId: null,
    faceIndex: null,
    faceContentMode: null,
    timezone: null,
    latitude: null,
    longitude: null,
    ...over,
  };
}

interface World {
  screen: Row;
  group: Row | null;
  tenant: {
    timezone?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  };
  schedules: any[];
  emergency?: boolean;
}

function playlistSchedule(): any {
  return {
    id: 'sch-1',
    playlistId: 'pl-1',
    screenId: SCREEN,
    screenGroupId: null,
    priority: 0,
    mode: 'replace',
    startTime: new Date(nowMs - 1000),
    endTime: null,
    daysOfWeek: null,
    timeStart: null,
    timeEnd: null,
    mutedOverride: null,
    playlist: { id: 'pl-1', name: 'Welcome', items: [], template: null },
  };
}

function makeHarness(world: World) {
  const client: Record<string, any> = {
    screen: {
      findUnique: jest.fn(async (args: any) =>
        args?.where?.id === SCREEN ? world.screen : null,
      ),
      update: jest.fn(async () => ({ id: SCREEN })),
      findMany: jest.fn(async () => []),
    },
    screenGroup: {
      findUnique: jest.fn(async () => world.group),
    },
    tenant: {
      findUnique: jest.fn(async (args: any) => {
        if (args?.select?.emergencyStatus) {
          return {
            id: TENANT,
            parentId: null,
            archivedAt: null,
            emergencyStatus: world.emergency ? 'CRITICAL' : 'INACTIVE',
            emergencyType: world.emergency ? 'LOCKDOWN' : null,
            emergencyPlaylistId: world.emergency ? 'pl-lockdown' : null,
            emergencyPortraitPlaylistId: null,
            locationBasedEmergencyEnabled: false,
          };
        }
        // The manifest's tenant projection (MANIFEST_TENANT_SELECT).
        return {
          name: 'Riverside',
          posterStandardW: null,
          posterStandardH: null,
          timezone: world.tenant.timezone ?? null,
          latitude: world.tenant.latitude ?? null,
          longitude: world.tenant.longitude ?? null,
        };
      }),
    },
    screenEmergencyOverride: { findUnique: jest.fn(async () => null) },
    game: { findFirst: jest.fn(async () => null) },
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
      findMany: jest.fn(async () => world.schedules),
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
  const controller = new ScreensController(
    { client } as any,
    redis as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  return { controller, client };
}

function makeRes() {
  const res: any = { statusCode: null, body: undefined, headers: {} };
  res.setHeader = (k: string, v: string) => {
    res.headers[k.toLowerCase()] = v;
    return res;
  };
  res.status = (c: number) => {
    res.statusCode = c;
    return res;
  };
  res.json = (p: any) => {
    res.body = p;
    return res;
  };
  res.send = () => res;
  res.end = () => res;
  return res;
}

function makeReq() {
  return {
    headers: {
      authorization: `Bearer ${jwt.sign({ sub: SCREEN, kind: 'device', ep: 0, fp: 'fp-tz' }, DEVICE_JWT_SECRET, { expiresIn: '180d' })}`,
    },
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    user: { id: SCREEN, sub: SCREEN, kind: 'device', tenantId: TENANT },
  } as any;
}

async function manifest(world: World) {
  const h = makeHarness(world);
  const res = makeRes();
  await h.controller.getManifest(SCREEN, makeReq(), res as any);
  return res;
}

beforeEach(() => {
  resetManifestCacheForTests();
  markManifestRevHookArmed();
  resetEmergencyRevForTests();
  invalidateDeviceCredentialCache();
  setDeviceCredentialSharedStore(null as any);
  clearDisplayManifestCache();
  nowMs += 60_000;
});

describe('manifest timeZone — the precedence, over the rows the manifest already reads', () => {
  it('automatic from the location’s coordinates when nothing is set', async () => {
    const res = await manifest({
      screen: screenRow(),
      group: null,
      tenant: { ...LA },
      schedules: [playlistSchedule()],
    });
    expect(res.statusCode ?? 200).toBe(200);
    expect(res.body.timeZone).toBe('America/Los_Angeles');
  });

  it('the group’s address beats the location’s; the screen’s own pin beats both', async () => {
    const viaGroup = await manifest({
      screen: screenRow(),
      group: { id: GROUP, name: 'East wing', syncMode: 'off', ...CLEVELAND },
      tenant: { ...LA },
      schedules: [playlistSchedule()],
    });
    expect(viaGroup.body.timeZone).toBe('America/New_York');
    // Same screen id, new row: in production the Screen write bumps the
    // content rev (Prisma hook); here the harness forgets the snapshot by hand.
    resetManifestCacheForTests();
    const viaScreen = await manifest({
      screen: screenRow({ latitude: 21.3069, longitude: -157.8583 }),
      group: { id: GROUP, name: 'East wing', syncMode: 'off', ...CLEVELAND },
      tenant: { ...LA },
      schedules: [playlistSchedule()],
    });
    expect(viaScreen.body.timeZone).toBe('Pacific/Honolulu');
  });

  it('the location’s setting beats automatic; the screen’s override beats the setting', async () => {
    const setting = await manifest({
      screen: screenRow(),
      group: null,
      tenant: { ...LA, timezone: 'America/Chicago' },
      schedules: [playlistSchedule()],
    });
    expect(setting.body.timeZone).toBe('America/Chicago');
    resetManifestCacheForTests();
    const override = await manifest({
      screen: screenRow({ timezone: 'America/Denver' }),
      group: null,
      tenant: { ...LA, timezone: 'America/Chicago' },
      schedules: [playlistSchedule()],
    });
    expect(override.body.timeZone).toBe('America/Denver');
  });

  it('is null — "use the device’s zone" — when nothing resolves, and the key is still present', async () => {
    const res = await manifest({
      screen: screenRow(),
      group: null,
      tenant: {},
      schedules: [playlistSchedule()],
    });
    expect(Object.prototype.hasOwnProperty.call(res.body, 'timeZone')).toBe(
      true,
    );
    expect(res.body.timeZone).toBeNull();
  });

  it('the "no content scheduled" body carries it too', async () => {
    const res = await manifest({
      screen: screenRow(),
      group: null,
      tenant: { ...LA },
      schedules: [],
    });
    expect(res.body.timeZone).toBe('America/Los_Angeles');
  });

  it('is part of the hashed payload: a different override is a different ETag', async () => {
    const a = await manifest({
      screen: screenRow(),
      group: null,
      tenant: { ...LA },
      schedules: [playlistSchedule()],
    });
    resetManifestCacheForTests();
    const b = await manifest({
      screen: screenRow({ timezone: 'America/Denver' }),
      group: null,
      tenant: { ...LA },
      schedules: [playlistSchedule()],
    });
    expect(a.headers.etag).toBeTruthy();
    expect(b.headers.etag).toBeTruthy();
    expect(a.headers.etag).not.toBe(b.headers.etag);
  });
});

describe('manifest timeZone — life safety', () => {
  it('the EMERGENCY branch carries no timeZone key (the player keeps its last known zone)', async () => {
    const res = await manifest({
      screen: screenRow({ timezone: 'America/Denver' }),
      group: null,
      tenant: { ...LA },
      schedules: [playlistSchedule()],
      emergency: true,
    });
    expect(res.body.isEmergency).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(res.body, 'timeZone')).toBe(
      false,
    );
  });
});
