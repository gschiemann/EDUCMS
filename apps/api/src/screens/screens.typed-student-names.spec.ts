/**
 * Student names TYPED into templates, through the REAL screen manifest
 * (K-12 sports launch follow-up, lane B4, 2026-09-27).
 *
 * A template scheduled to an ordinary screen (a lobby TV playing a relay board
 * or a CTS announcement reel) reaches the glass through
 * `GET /screens/:id/manifest`, not the public board payload. What this pins:
 *   1. At a school that has not confirmed its directory-information policy, a
 *      typed value that is a rostered student's name is BLANK in the manifest
 *      — and appears nowhere in the body.
 *   2. At a venue the policy does not apply to, the manifest is unchanged.
 *   3. The fleet pays nothing: a manifest with no typed-name values performs
 *      no roster or policy query at all.
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
import { clearTypedNameMatcherCache } from '../sports/typed-student-names';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const TENANT = 'tenant-school';
const SCREEN = 'screen-lobby';

let nowMs = 1_780_000_000_000;
beforeAll(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterAll(() => {
  jest.restoreAllMocks();
});

type Row = Record<string, any>;

function screenRow(): Row {
  return {
    id: SCREEN,
    tenantId: TENANT,
    screenGroupId: null,
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
  };
}

function relayZones(swimmer: string, other = 'M. Okafor') {
  return [
    {
      id: 'z-relay',
      name: 'Relay',
      widgetType: 'SWIM_RELAY_EXCHANGE',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      zIndex: 1,
      sortOrder: 0,
      touchAction: null,
      sceneId: null,
      defaultConfig: JSON.stringify({
        teamName: 'HOME RELAY A',
        legs: [
          { legName: 'LEG 1', swimmer, split: '27.80' },
          { legName: 'LEG 2', swimmer: other, split: '31.42' },
        ],
      }),
    },
  ];
}

function makeHarness(opts: { vertical: string; zones: any[] }) {
  const client: Record<string, any> = {
    screen: {
      findUnique: jest.fn(async (args: any) =>
        args?.where?.id === SCREEN ? screenRow() : null,
      ),
      update: jest.fn(async () => ({ id: SCREEN })),
      findMany: jest.fn(async () => []),
    },
    screenGroup: { findUnique: jest.fn(async () => null) },
    tenant: {
      findUnique: jest.fn(async (args: any) => {
        if (args?.select?.emergencyStatus) {
          return {
            id: TENANT,
            parentId: null,
            archivedAt: null,
            emergencyStatus: 'INACTIVE',
            emergencyType: null,
            emergencyPlaylistId: null,
            emergencyPortraitPlaylistId: null,
            locationBasedEmergencyEnabled: false,
          };
        }
        if (args?.select?.vertical) {
          // The student-privacy policy chain (B3's loader).
          return args?.where?.id === TENANT
            ? {
                id: TENANT,
                name: 'Riverside High',
                vertical: opts.vertical,
                parentId: null,
              }
            : null;
        }
        return {
          name: 'Riverside High',
          posterStandardW: null,
          posterStandardH: null,
        };
      }),
    },
    screenEmergencyOverride: { findUnique: jest.fn(async () => null) },
    game: { findFirst: jest.fn(async () => null) },
    playlist: { findUnique: jest.fn(async () => null) },
    schedule: {
      findMany: jest.fn(async () => [
        {
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
          playlist: {
            id: 'pl-1',
            name: 'Swim night',
            items: [],
            template: {
              id: 'tpl-relay',
              name: 'Relay board',
              screenWidth: 1920,
              screenHeight: 1080,
              bgColor: '#000',
              bgGradient: null,
              bgImage: null,
              isTouchEnabled: false,
              idleResetMs: null,
              zones: opts.zones,
              scenes: [],
            },
          },
        },
      ]),
      findFirst: jest.fn(async () => null),
    },
    displaySchedule: { findMany: jest.fn(async () => []) },
    displayVendorRecipe: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async () => ({})) },
    // Lane B4's reads.
    studentPrivacyPolicy: { findMany: jest.fn(async () => []) },
    rosterPlayer: {
      findMany: jest.fn(async () => [
        {
          name: 'Jordan Lee',
          directoryOptOut: false,
          photoRelease: false,
          person: null,
        },
      ]),
    },
    sportsPerson: { findMany: jest.fn(async () => []) },
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
      authorization: `Bearer ${jwt.sign(
        { sub: SCREEN, kind: 'device', ep: 0, fp: 'fp-test' },
        DEVICE_JWT_SECRET,
        {
          expiresIn: '180d',
        },
      )}`,
    },
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    user: { id: SCREEN, sub: SCREEN, kind: 'device', tenantId: TENANT },
  } as any;
}

async function manifest(h: ReturnType<typeof makeHarness>) {
  const res = makeRes();
  await h.controller.getManifest(SCREEN, makeReq(), res as any);
  return res.body;
}

const legsOf = (body: any) =>
  body.playlists[0].template.zones[0].defaultConfig.legs;

beforeEach(() => {
  nowMs += 3_600_000;
  resetManifestCacheForTests();
  resetEmergencyRevForTests();
  clearDisplayManifestCache();
  invalidateDeviceCredentialCache();
  setDeviceCredentialSharedStore(null);
  markManifestRevHookArmed();
  clearTypedNameMatcherCache();
});

describe('the screen manifest — student names typed into a template', () => {
  it("a school that confirmed nothing: the rostered student's typed name is blank and appears nowhere", async () => {
    const h = makeHarness({ vertical: 'K12', zones: relayZones('Jordan Lee') });
    const body = await manifest(h);
    expect(legsOf(body).map((l: any) => l.swimmer)).toEqual(['', 'M. Okafor']);
    expect(legsOf(body)[0].split).toBe('27.80');
    expect(JSON.stringify(body)).not.toContain('Jordan');
  });

  it('a last name typed alone is the same student', async () => {
    const h = makeHarness({ vertical: 'K12', zones: relayZones('LEE') });
    expect(legsOf(await manifest(h))[0].swimmer).toBe('');
  });

  it('a venue the policy does not apply to is unchanged', async () => {
    const h = makeHarness({
      vertical: 'SPORTS',
      zones: relayZones('Jordan Lee'),
    });
    expect(legsOf(await manifest(h))[0].swimmer).toBe('Jordan Lee');
  });

  it('a manifest with no typed-name values performs no roster or policy query', async () => {
    const h = makeHarness({ vertical: 'K12', zones: relayZones('', '') });
    await manifest(h);
    expect(h.client.rosterPlayer.findMany).not.toHaveBeenCalled();
    expect(h.client.sportsPerson.findMany).not.toHaveBeenCalled();
    expect(h.client.studentPrivacyPolicy.findMany).not.toHaveBeenCalled();
  });
});
