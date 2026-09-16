/**
 * Double-sided displays — WHICH FACE GETS WHICH PLAYLIST (2026-09-16).
 *
 * `screen-faces.spec.ts` pins the pure rules. This file pins the thing the
 * operator actually experiences: what comes back from
 * `GET /screens/:id/manifest` for each side of a double-sided display.
 *
 * The four claims that matter:
 *
 *   1. A MIRRORING back side is served the FRONT's content — resolved from
 *      the front's screen id AND the front's group, because side A's content
 *      usually arrives through a group-scoped schedule.
 *   2. A side switched to OWN is served ITS OWN content, and the front's
 *      schedules stop reaching it.
 *   3. LIFE-SAFETY: mirroring cannot touch an alert. The emergency branch
 *      returns before any of this runs, so a mirroring face in an active
 *      emergency gets the emergency manifest — never the front's normal
 *      content — and it never even reads the front.
 *   4. The single-sided fleet pays NOTHING: an ordinary screen performs no
 *      extra query and its payload carries no new keys, so no ETag moves.
 */

import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import {
  markManifestRevHookArmed,
  resetManifestCacheForTests,
} from './manifest-hot-cache';
import { resetEmergencyRevForTests } from './emergency-rev';
import { invalidateDeviceCredentialCache, setDeviceCredentialSharedStore } from './device-auth';
import { clearDisplayManifestCache } from '../display/display-manifest';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const TENANT = 'tenant-ds';
const FRONT = 'screen-front';
const BACK = 'screen-back';
const FRONT_GROUP = 'group-entrance';

let nowMs = 1_770_000_000_000;
beforeAll(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
});
afterAll(() => {
  jest.restoreAllMocks();
});

type Row = Record<string, any>;

function frontRow(over: Row = {}): Row {
  return {
    id: FRONT,
    tenantId: TENANT,
    screenGroupId: FRONT_GROUP,
    status: 'ONLINE',
    name: 'Entrance Display',
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
    ...over,
  };
}

function backRow(over: Row = {}): Row {
  return frontRow({
    id: BACK,
    name: 'Entrance Display — Back',
    // The back panel is its own physical surface: its own group membership
    // (here: none) and its own orientation.
    screenGroupId: null,
    orientation: 'AUTO',
    faceOfScreenId: FRONT,
    faceIndex: 1,
    faceContentMode: 'MIRROR',
    ...over,
  });
}

interface World {
  rows: Record<string, Row>;
  /** Schedules keyed by the target id the query asks for. */
  schedulesFor: (targets: any[]) => any[];
  emergencyStatus?: string;
  emergencyPlaylistId?: string | null;
}

function playlistSchedule(id: string, playlistId: string, name: string, target: Row): any {
  return {
    id,
    playlistId,
    screenId: target.screenId ?? null,
    screenGroupId: target.screenGroupId ?? null,
    priority: 0,
    mode: 'replace',
    startTime: new Date(nowMs - 1000),
    endTime: null,
    daysOfWeek: null,
    timeStart: null,
    timeEnd: null,
    mutedOverride: null,
    playlist: { id: playlistId, name, items: [], template: null },
  };
}

function makeHarness(world: World) {
  const scheduleWhere: any[] = [];
  const reads: string[] = [];

  const client: Record<string, any> = {
    screen: {
      findUnique: jest.fn(async (args: any) => {
        reads.push(`screen.findUnique:${args?.where?.id}`);
        return world.rows[args?.where?.id] ?? null;
      }),
      update: jest.fn(async () => ({ id: 'x' })),
      findMany: jest.fn(async () => []),
    },
    screenGroup: {
      findUnique: jest.fn(async (args: any) => ({
        id: args?.where?.id,
        name: 'Entrance',
        syncMode: 'off',
      })),
    },
    tenant: {
      findUnique: jest.fn(async (args: any) => {
        if (args?.select?.emergencyStatus) {
          return {
            id: TENANT,
            parentId: null,
            archivedAt: null,
            emergencyStatus: world.emergencyStatus ?? 'INACTIVE',
            emergencyType: world.emergencyStatus ? 'LOCKDOWN' : null,
            emergencyPlaylistId: world.emergencyPlaylistId ?? null,
            emergencyPortraitPlaylistId: null,
            locationBasedEmergencyEnabled: false,
          };
        }
        return { name: 'Riverside', posterStandardW: null, posterStandardH: null };
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
            asset: { fileUrl: 'https://x/lockdown.png', fileHash: 'h', mimeType: 'image/png' },
          },
        ],
      })),
    },
    schedule: {
      findMany: jest.fn(async (args: any) => {
        const targets = args?.where?.AND?.find((c: any) => Array.isArray(c?.OR))?.OR ?? [];
        scheduleWhere.push(targets);
        return world.schedulesFor(targets);
      }),
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
  return { controller, client, scheduleWhere, reads };
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

function makeReq(screenId: string) {
  return {
    headers: {
      authorization: `Bearer ${jwt.sign(
        { sub: screenId, kind: 'device', ep: 0, fp: 'fp-test' },
        DEVICE_JWT_SECRET,
        { expiresIn: '180d' },
      )}`,
    },
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    user: { id: screenId, sub: screenId, kind: 'device', tenantId: TENANT },
  } as any;
}

async function manifest(h: ReturnType<typeof makeHarness>, screenId: string) {
  const res = makeRes();
  await h.controller.getManifest(screenId, makeReq(screenId), res as any);
  return res;
}

beforeEach(() => {
  // Monotonic — never rewind. Several caches on this path expire by TTL
  // alone, and a rewound clock makes a previous case's entry look like it was
  // written in the future, so it would never expire.
  nowMs += 3_600_000;
  resetManifestCacheForTests();
  resetEmergencyRevForTests();
  clearDisplayManifestCache();
  invalidateDeviceCredentialCache();
  setDeviceCredentialSharedStore(null);
  markManifestRevHookArmed();
});

// ═══ 1. MIRROR — the back shows the front ═══════════════════════════════

describe('a MIRRORING back side is served the front’s content', () => {
  it("resolves the FRONT's screen id and the FRONT's group, not its own", async () => {
    const h = makeHarness({
      rows: { [FRONT]: frontRow(), [BACK]: backRow() },
      schedulesFor: (targets) => {
        const hitsFront = targets.some(
          (t: any) => t.screenId === FRONT || t.screenGroupId === FRONT_GROUP,
        );
        return hitsFront
          ? [playlistSchedule('sch-front', 'pl-front', 'Lobby Loop', { screenId: FRONT })]
          : [];
      },
    });

    const res = await manifest(h, BACK);

    // The back has NO group of its own, so if the group half were not
    // inherited, a group-published front would mirror nothing — the common
    // case, silently broken.
    const targets = h.scheduleWhere[0];
    expect(targets).toEqual(
      expect.arrayContaining([{ screenId: FRONT }, { screenGroupId: FRONT_GROUP }]),
    );
    expect(targets).not.toEqual(expect.arrayContaining([{ screenId: BACK }]));

    expect(res.statusCode).toBe(200);
    expect(res.body.playlists).toHaveLength(1);
    expect(res.body.playlists[0].id).toBe('pl-front');
  });

  it('says it is mirroring, so an operator never has to guess', async () => {
    const h = makeHarness({
      rows: { [FRONT]: frontRow(), [BACK]: backRow() },
      schedulesFor: () => [
        playlistSchedule('sch-front', 'pl-front', 'Lobby Loop', { screenId: FRONT }),
      ],
    });
    const res = await manifest(h, BACK);
    expect(res.body.face).toEqual({
      index: 1,
      label: 'Back',
      contentMode: 'MIRROR',
      mirroredFrom: FRONT,
    });
  });

  it('still reports its OWN identity — mirroring borrows content, not the panel', async () => {
    // The back is a different piece of glass: its own orientation must win,
    // or a portrait back panel would be driven landscape by the front.
    const h = makeHarness({
      rows: { [FRONT]: frontRow({ orientation: 'LANDSCAPE' }), [BACK]: backRow({ orientation: 'PORTRAIT' }) },
      schedulesFor: () => [
        playlistSchedule('sch-front', 'pl-front', 'Lobby Loop', { screenId: FRONT }),
      ],
    });
    const res = await manifest(h, BACK);
    expect(res.body.screenId).toBe(BACK);
    expect(res.body.orientation).toBe('PORTRAIT');
  });
});

// ═══ 2. OWN — the back has its own content ══════════════════════════════

describe('a side switched to OWN is served its own content', () => {
  it("resolves its own id, and the front's schedules no longer reach it", async () => {
    const h = makeHarness({
      rows: { [FRONT]: frontRow(), [BACK]: backRow({ faceContentMode: 'OWN' }) },
      schedulesFor: (targets) =>
        targets.some((t: any) => t.screenId === BACK)
          ? [playlistSchedule('sch-back', 'pl-back', 'Street Side Promo', { screenId: BACK })]
          : [playlistSchedule('sch-front', 'pl-front', 'Lobby Loop', { screenId: FRONT })],
    });

    const res = await manifest(h, BACK);

    expect(h.scheduleWhere[0]).toEqual([{ screenId: BACK }]);
    expect(res.body.playlists[0].id).toBe('pl-back');
    expect(res.body.face).toMatchObject({ contentMode: 'OWN', mirroredFrom: null });
  });

  it('never reads the front at all — nothing to inherit, nothing to fetch', async () => {
    const h = makeHarness({
      rows: { [FRONT]: frontRow(), [BACK]: backRow({ faceContentMode: 'OWN' }) },
      schedulesFor: () => [],
    });
    await manifest(h, BACK);
    expect(h.reads.filter((r) => r === `screen.findUnique:${FRONT}`)).toHaveLength(0);
  });

  it('a side with its own content and nothing scheduled says so honestly', async () => {
    // "Waiting for assignment" is a real state, not a connection failure —
    // and the face block rides the empty body too.
    const h = makeHarness({
      rows: { [FRONT]: frontRow(), [BACK]: backRow({ faceContentMode: 'OWN' }) },
      schedulesFor: () => [],
    });
    const res = await manifest(h, BACK);
    expect(res.statusCode).toBe(200);
    expect(res.body.playlists).toEqual([]);
    expect(res.body.emptyReason).toBe('NO_SCHEDULE');
    expect(res.body.face).toMatchObject({ label: 'Back', contentMode: 'OWN' });
  });
});

// ═══ 3. LIFE-SAFETY ═════════════════════════════════════════════════════

describe('mirroring can never touch an alert', () => {
  it('a mirroring back in an active emergency gets the EMERGENCY manifest', async () => {
    const h = makeHarness({
      rows: { [FRONT]: frontRow(), [BACK]: backRow() },
      emergencyStatus: 'CRITICAL',
      emergencyPlaylistId: 'pl-lockdown',
      schedulesFor: () => [
        playlistSchedule('sch-front', 'pl-front', 'Lobby Loop', { screenId: FRONT }),
      ],
    });

    const res = await manifest(h, BACK);

    expect(res.body.isEmergency).toBe(true);
    expect(res.body.playlists[0].id).toBe('pl-lockdown');
    // The front's normal content must not appear anywhere in an alert.
    expect(JSON.stringify(res.body)).not.toContain('pl-front');
  });

  it('the emergency branch returns before any mirror resolution happens', async () => {
    // Proof, not assertion-by-comment: the front row is never read, and the
    // schedule fan-out never runs. There is no code path on which a corrupt
    // or hostile mirror configuration could reach an alert decision.
    const h = makeHarness({
      rows: { [FRONT]: frontRow(), [BACK]: backRow() },
      emergencyStatus: 'CRITICAL',
      emergencyPlaylistId: 'pl-lockdown',
      schedulesFor: () => [],
    });

    await manifest(h, BACK);

    expect(h.reads.filter((r) => r === `screen.findUnique:${FRONT}`)).toHaveLength(0);
    expect(h.client.schedule.findMany).not.toHaveBeenCalled();
  });
});

// ═══ 4. The refusals, end to end ════════════════════════════════════════

describe('a mirror that cannot be trusted resolves the side’s own content', () => {
  it('falls back to OWN when the front row is gone', async () => {
    const h = makeHarness({
      rows: { [BACK]: backRow() }, // front deleted mid-request
      schedulesFor: (targets) =>
        targets.some((t: any) => t.screenId === BACK)
          ? [playlistSchedule('sch-back', 'pl-back', 'Own', { screenId: BACK })]
          : [playlistSchedule('sch-front', 'pl-front', 'Front', { screenId: FRONT })],
    });
    const res = await manifest(h, BACK);
    expect(h.scheduleWhere[0]).toEqual([{ screenId: BACK }]);
    expect(res.body.playlists[0].id).toBe('pl-back');
  });

  it('refuses a CROSS-TENANT front even though the link points at it', async () => {
    // The link is written by a tenant-checked endpoint, but the manifest must
    // not depend on a past write having been correct.
    const h = makeHarness({
      rows: { [FRONT]: frontRow({ tenantId: 'tenant-other' }), [BACK]: backRow() },
      schedulesFor: (targets) =>
        targets.some((t: any) => t.screenId === BACK)
          ? [playlistSchedule('sch-back', 'pl-back', 'Own', { screenId: BACK })]
          : [playlistSchedule('sch-x', 'pl-other-tenant', 'Other', { screenId: FRONT })],
    });
    const res = await manifest(h, BACK);
    expect(h.scheduleWhere[0]).toEqual([{ screenId: BACK }]);
    expect(JSON.stringify(res.body)).not.toContain('pl-other-tenant');
  });
});

// ═══ 5. The single-sided fleet pays nothing ═════════════════════════════

describe('an ordinary screen is untouched by this feature', () => {
  it('performs no extra read and carries no face block', async () => {
    const h = makeHarness({
      rows: { [FRONT]: frontRow() },
      schedulesFor: () => [
        playlistSchedule('sch-front', 'pl-front', 'Lobby Loop', { screenId: FRONT }),
      ],
    });

    const res = await manifest(h, FRONT);

    // Exactly one screen read: its own, from the preamble.
    expect(h.reads.filter((r) => r.startsWith('screen.findUnique'))).toEqual([
      `screen.findUnique:${FRONT}`,
    ]);
    expect(h.scheduleWhere[0]).toEqual(
      expect.arrayContaining([{ screenId: FRONT }, { screenGroupId: FRONT_GROUP }]),
    );
    // No new key → the payload hashes to what it always did → no fleet-wide
    // 304 bust when this ships.
    expect(res.body.face).toBeUndefined();
  });
});
