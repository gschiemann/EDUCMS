/**
 * STAGED EMERGENCY BOARDS — `GET /screens/:id/emergency-assets` carries the
 * boards the manifest's emergency branch would deliver (2026-10-26).
 *
 * The one claim that matters is proven against the REAL manifest, not a
 * hand-written fixture: the same mocked database serves `getManifest` during
 * an active alert and `getEmergencyAssets`, and the staged board for that
 * screen deep-equals `manifest.playlists[0]`. Then: orientation variants
 * (portrait screen → the portrait board), the set hash moving on a board
 * edit, and tenant isolation (a playlist row of another tenant never ships
 * as a board, even when a column points at it).
 */
import * as jwt from 'jsonwebtoken';
import { ScreensController } from './screens.controller';
import { resetManifestCacheForTests } from './manifest-hot-cache';
import { resetEmergencyRevForTests } from './emergency-rev';
import { invalidateDeviceCredentialCache } from './device-auth';
import { clearDisplayManifestCache } from '../display/display-manifest';

jest.mock('../security/required-secret', () => ({
  requireSecret: (_name: string, opts?: { devFallback?: string }) =>
    opts?.devFallback ?? 'test_secret_32_chars_padded_here_ok',
}));
jest.mock('./manifest-hot-cache', () => {
  const actual = jest.requireActual('./manifest-hot-cache');
  return {
    ...actual,
    shouldSkipEmergencyAudit: () => true,
    markEmergencyAuditWritten: () => undefined,
  };
});

const DEVICE_JWT_SECRET = 'dev_only_device_jwt_secret_CHANGE_ME';
const TENANT = 'tenant-boards';
const OTHER_TENANT = 'tenant-other';
const LAND = 'pl-medical-land';
const PORT = 'pl-medical-port';
const FOREIGN = 'pl-foreign';

type Row = Record<string, any>;

function tenantRow(over: Row = {}): Row {
  return {
    id: TENANT,
    name: 'Boards Test',
    parentId: null,
    archivedAt: null,
    posterStandardW: null,
    posterStandardH: null,
    locationBasedEmergencyEnabled: false,
    emergencyStatus: 'CRITICAL',
    emergencyType: 'MEDICAL',
    emergencyIsDrill: false,
    emergencyPlaylistId: LAND,
    emergencyPortraitPlaylistId: PORT,
    panicMedicalPlaylistId: LAND,
    panicMedicalPortraitPlaylistId: PORT,
    ...over,
  };
}

function screenRow(over: Row = {}): Row {
  return {
    id: 'screen-1',
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
    tenant: tenantRow(),
    ...over,
  };
}

function playlistRows(over: Record<string, Row> = {}): Record<string, Row> {
  const item = (id: string, seq: number, url: string, extra: Row = {}) => ({
    id,
    assetId: `asset-${id}`,
    durationMs: 10_000,
    sequenceOrder: seq,
    transitionType: null,
    asset: {
      fileUrl: url,
      fileHash: `hash-${id}`,
      mimeType: 'image/png',
      fileSize: 1000,
      status: 'PUBLISHED',
      ...extra,
    },
  });
  return {
    [LAND]: {
      id: LAND,
      tenantId: TENANT,
      name: 'Medical (landscape)',
      items: [
        item('l2', 1, 'https://cdn.invalid/l2.png'),
        item('l1', 0, 'https://cdn.invalid/l1.png'),
      ],
    },
    [PORT]: {
      id: PORT,
      tenantId: TENANT,
      name: 'Medical (portrait)',
      items: [
        item('p1', 0, 'https://cdn.invalid/p1.png'),
        item('p-draft', 1, 'https://cdn.invalid/draft.png', {
          status: 'PENDING_APPROVAL',
        }),
      ],
    },
    [FOREIGN]: {
      id: FOREIGN,
      tenantId: OTHER_TENANT,
      name: 'Other tenant board',
      items: [item('f1', 0, 'https://cdn.invalid/f1.png')],
    },
    ...over,
  };
}

function makeHarness(
  opts: { screen?: Row; tenant?: Row; playlists?: Record<string, Row> } = {},
) {
  const tenant = opts.tenant ?? tenantRow();
  const screen = { ...screenRow(opts.screen), tenant };
  const playlists = opts.playlists ?? playlistRows();
  const client: Record<string, any> = {
    screen: {
      findUnique: jest.fn(async () => screen),
      update: jest.fn(async () => ({ id: 'x' })),
      findMany: jest.fn(async () => []),
    },
    screenGroup: { findUnique: jest.fn(async () => null) },
    tenant: { findUnique: jest.fn(async () => tenant) },
    screenEmergencyOverride: { findUnique: jest.fn(async () => null) },
    game: { findFirst: jest.fn(async () => null) },
    playlist: {
      findUnique: jest.fn(async (args: any) => {
        const pl = playlists[args?.where?.id];
        if (!pl) return null;
        // The manifest's own query: PUBLISHED assets, sequence asc.
        return {
          ...pl,
          items: pl.items
            .filter((i: Row) => i.asset.status === 'PUBLISHED')
            .sort((a: Row, b: Row) => a.sequenceOrder - b.sequenceOrder),
        };
      }),
      findMany: jest.fn(async (args: any) =>
        (args?.where?.id?.in ?? [])
          .map((id: string) => playlists[id])
          .filter(Boolean),
      ),
    },
    asset: { findMany: jest.fn(async () => []) },
    schedule: {
      findMany: jest.fn(async () => []),
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

function makeReq(screenId: string) {
  return {
    headers: {
      authorization: `Bearer ${jwt.sign({ sub: screenId, kind: 'device', ep: 0, fp: 'fp-test' }, DEVICE_JWT_SECRET, { expiresIn: '180d' })}`,
    },
    ip: '10.0.0.1',
    socket: { remoteAddress: '10.0.0.1' },
    user: { id: screenId, sub: screenId, kind: 'device', tenantId: TENANT },
  } as any;
}

async function manifest(h: ReturnType<typeof makeHarness>) {
  const res = makeRes();
  await h.controller.getManifest('screen-1', makeReq('screen-1'), res);
  return res.body;
}
async function staged(h: ReturnType<typeof makeHarness>) {
  return h.controller.getEmergencyAssets('screen-1', makeReq('screen-1'));
}

beforeEach(() => {
  resetManifestCacheForTests();
  resetEmergencyRevForTests();
  invalidateDeviceCredentialCache();
  clearDisplayManifestCache();
});

describe('staged boards are the manifest emergency branch, byte for byte', () => {
  it('a landscape screen: boards[selected] deep-equals the live emergency manifest playlist (PUBLISHED only, sequence asc)', async () => {
    const h = makeHarness();
    const m = await manifest(h);
    expect(m.isEmergency).toBe(true);
    expect(m.playlists[0].id).toBe(LAND);
    const s = await staged(h);
    expect(s.boardFor.MEDICAL.live).toEqual({
      playlistId: LAND,
      perScreen: false,
      // 2026-10-31 — the key of what the manifest WILL play: the board itself, since it has items.
      boardKey: LAND,
    });
    expect(s.boards[LAND]).toEqual(m.playlists[0]);
    // Items come out ordered by sequence, exactly like the manifest.
    expect(s.boards[LAND].items.map((i: any) => i.item_id)).toEqual([
      'l1',
      'l2',
    ]);
    // The portrait variant is staged too, minus its unpublished item.
    expect(s.boards[PORT].items.map((i: any) => i.item_id)).toEqual(['p1']);
  });

  it('a portrait screen: both deliver the PORTRAIT board', async () => {
    const h = makeHarness({
      screen: { resolution: '1080x1920', orientation: 'PORTRAIT' },
    });
    const m = await manifest(h);
    expect(m.playlists[0].id).toBe(PORT);
    const s = await staged(h);
    expect(s.boardFor.MEDICAL.live.playlistId).toBe(PORT);
    expect(s.boards[PORT]).toEqual(m.playlists[0]);
  });

  it('an LED poster (OS 1920×1080, novastar-taurus, no explicit canvas): both deliver the PORTRAIT board', async () => {
    const h = makeHarness({
      screen: {
        resolution: '1920×1080',
        orientation: 'AUTO',
        hardwareModel: 'novastar-taurus',
      },
      tenant: tenantRow({ posterStandardW: 320, posterStandardH: 1080 }),
    });
    const m = await manifest(h);
    expect(m.playlists[0].id).toBe(PORT);
    const s = await staged(h);
    expect(s.boardFor.MEDICAL.live.playlistId).toBe(PORT);
    expect(s.boards[PORT]).toEqual(m.playlists[0]);
  });

  it("a double-sided unit's portrait back face (panel mode 960×540): both deliver the PORTRAIT board", async () => {
    const h = makeHarness({
      screen: {
        resolution: '960×540',
        orientation: 'PORTRAIT',
        faceOfScreenId: 'front-id',
        faceIndex: 1,
        faceContentMode: 'MIRROR',
      },
    });
    const m = await manifest(h);
    expect(m.playlists[0].id).toBe(PORT);
    const s = await staged(h);
    expect(s.boardFor.MEDICAL.live.playlistId).toBe(PORT);
    expect(s.boards[PORT]).toEqual(m.playlists[0]);
  });
});

describe('set hash and tenant isolation', () => {
  it('the set hash moves when a board is edited, even with the same files', async () => {
    const before = await staged(makeHarness());
    const edited = playlistRows();
    edited[LAND].items[0].durationMs = 15_000; // same file, new duration
    const after = await staged(makeHarness({ playlists: edited }));
    expect(after.setHash).not.toBe(before.setHash);
    expect(after.assets).toEqual(before.assets);
  });

  it('the set hash moves when the panic column is re-pointed (the selection changed)', async () => {
    const before = await staged(makeHarness());
    const after = await staged(
      makeHarness({ tenant: tenantRow({ panicMedicalPlaylistId: PORT }) }),
    );
    expect(after.boardFor.MEDICAL.live.playlistId).toBe(PORT);
    expect(after.setHash).not.toBe(before.setHash);
  });

  it("a playlist row of ANOTHER tenant never ships as a board, even when this screen's column points at it", async () => {
    const h = makeHarness({
      screen: { emergencyLockdownPlaylistId: FOREIGN },
      tenant: tenantRow({ locationBasedEmergencyEnabled: true }),
    });
    const s = await staged(h);
    expect(h.client.playlist.findMany.mock.calls[0][0].where.id.in).toContain(
      FOREIGN,
    );
    // Custom boards: only this tenant's two. The `system:` keys are the
    // synthesized system boards (2026-10-31), built from no playlist row.
    expect(Object.keys(s.boards).filter((k) => !k.startsWith('system:') && !k.startsWith('asset:')).sort()).toEqual([LAND, PORT]);
    expect(JSON.stringify(s.boards)).not.toContain(OTHER_TENANT);
    expect(s.boardFor.LOCKDOWN.live).toEqual({
      playlistId: FOREIGN,
      perScreen: true,
      // The foreign row was never staged, so the manifest will fall through to the system board.
      boardKey: 'system:LOCKDOWN:live',
    });
    expect(s.boards['system:LOCKDOWN:live'].id).toBe('DEFAULT_EMERGENCY');
    expect(s.tenantId).toBe(TENANT);
  });

  it("a screen whose tenant has no boards gets an empty map, never another tenant's", async () => {
    const s = await staged(
      makeHarness({
        tenant: tenantRow({
          panicMedicalPlaylistId: null,
          panicMedicalPortraitPlaylistId: null,
          emergencyPlaylistId: null,
          emergencyPortraitPlaylistId: null,
        }),
      }),
    );
    // No CUSTOM board of any tenant; what IS staged is this screen's system
    // board per type × live/drill (2026-10-31), so even a tenant with nothing
    // configured opens on the final board at the push.
    expect(Object.keys(s.boards).filter((k) => !k.startsWith('system:'))).toEqual([]);
    expect(Object.keys(s.boards)).toHaveLength(12);
    expect(JSON.stringify(s.boards)).not.toContain(OTHER_TENANT);
    expect(s.boardFor.MEDICAL.live.playlistId).toBeNull();
    expect(s.boardFor.MEDICAL.live.boardKey).toBe('system:MEDICAL:live');
    expect(s.boards['system:MEDICAL:live'].template.bgColor).toBe('#dc2626');
    expect(s.boards['system:MEDICAL:drill'].template.bgColor).toBe('#3730a3');
  });
});
