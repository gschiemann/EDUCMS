/**
 * The publish-time video gate (video guarantee step 5, 2026-10-12).
 *   warn (default): publish goes through; warnings name the file and screens.
 *   enforce: a file no copy fixes is refused 422 before anything is written —
 *            except on a two-sided unit (owner decision B: warning only).
 *   off: nothing evaluated. Unknown never warns. Emergency never evaluated.
 *   A gate that cannot run says nothing and blocks nothing.
 */
import { PlaybackGateService, playbackGateMessage } from './playback-gate.service';
import { MediaPublicationService } from './media-publication.service';

const T = 'tenant-a';
const SHA = 'a'.repeat(64);
const COPY = { url: 'https://cdn/1080.mp4', sha256: 'b'.repeat(64), size: 4_000_000 };

type Row = Record<string, any>;

function make(over: Partial<{
  playlist: Row | null;
  screens: Row[];
  unit: Row[];
  playback: Row[];
  classGroups: Row[];
  demotions: Row[];
  emergencyTenant: boolean;
  throwOnScreens: boolean;
}> = {}) {
  const w = {
    playlist: {
      id: 'pl-1', isProtected: false,
      items: [{ asset: { id: 'clip', originalName: 'Promo 4K.mp4', fileUrl: 'https://cdn/clip.mp4', fileHash: SHA, fileSize: 40_000_000, mimeType: 'video/mp4',
        processingMeta: { processedDimensions: { w: 3840, h: 2160 }, probe: { fps: 30 }, renditions: { '1080p': COPY } } } }],
      template: null,
    } as Row | null,
    screens: [{ id: 's1', name: 'Lobby', tenantId: T, resolution: '3840x2160', playerVersionCode: 30, displayCapabilities: null, faceOfScreenId: null, faceContentMode: null }],
    unit: [] as Row[],
    playback: [] as Row[],
    classGroups: [] as Row[],
    demotions: [] as Row[],
    emergencyTenant: false,
    throwOnScreens: false,
    ...over,
  };
  const db: any = {
    playlist: {
      findFirst: jest.fn(async ({ where }: any) => {
        if (where.isProtected) return null; // playlistEmergencyUse's protected lookup
        return where.id === 'pl-1' && where.tenantId === T ? w.playlist : null;
      }),
    },
    tenant: { findFirst: jest.fn(async () => (w.emergencyTenant ? { id: T } : null)) },
    screenEmergencyOverride: { findFirst: jest.fn(async () => null) },
    screen: {
      findFirst: jest.fn(async () => null), // emergency per-screen playlist lookup
      findMany: jest.fn(async ({ where }: any) => {
        if (w.throwOnScreens) throw new Error('pool timeout');
        if (where.OR?.some((o: any) => 'faceOfScreenId' in o)) {
          return w.unit.length ? w.unit : w.screens.filter((s) => where.OR.some((o: any) => o.id === s.id));
        }
        return w.screens.filter((s) => s.tenantId === where.tenantId);
      }),
    },
    screenFilePlayback: { findMany: jest.fn(async ({ where }: any) => w.playback.filter((p) => p.screenId === where.screenId && p.tenantId === where.tenantId)) },
    screenMediaCapabilities: { findFirst: jest.fn(async () => null) },
    screenPlaybackDemotion: { findMany: jest.fn(async ({ where }: any) => w.demotions.filter((d) => d.screenId === where.screenId && !d.clearedAt)) },
    $queryRaw: jest.fn(async () => w.classGroups),
  };
  return { w, db, gate: new PlaybackGateService({ client: db } as any) };
}

const stutteredAt4K = (screenId: string): Row => ({
  screenId, tenantId: T, width: 3840, height: 2160, verdict: 'stuttering', unitConcurrentMax: 1,
  lastAt: new Date('2026-10-12T00:00:00Z'), playerVersionCode: 30, webviewMajor: 120, deviceClass: null,
});

const ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ENV };
});

describe('PlaybackGateService', () => {
  it('UNKNOWN never warns (no evidence, no class row)', async () => {
    const { gate } = make();
    expect((await gate.evaluate(T, 'pl-1', 's1')).warnings).toEqual([]);
  });

  it('warn (default): a 4K screen measured stuttering at 4K → "may stutter … we will switch to the 1080p copy", publish not refused', async () => {
    const { gate } = make({ playback: [stutteredAt4K('s1')] });
    const r = await gate.evaluate(T, 'pl-1', 's1');
    expect(r.mode).toBe('warn');
    expect(r.warnings).toEqual([expect.objectContaining({
      code: 'VIDEO_MAY_STUTTER', reason: 'capability', assetId: 'clip', file: 'Promo 4K.mp4',
      screens: [{ id: 's1', name: 'Lobby' }], hasLighterCopy: true,
    })]);
    expect(r.warnings[0].message).toBe('“Promo 4K.mp4” may stutter on Lobby. If it does, we will switch that screen to the 1080p copy automatically.');
    expect(r.copyWanted).toEqual([]);
  });

  it('an active demotion for that screen and file silences the warning (it already gets the copy)', async () => {
    const { gate } = make({ playback: [stutteredAt4K('s1')], demotions: [{ screenId: 's1', sourceSha256: SHA, clearedAt: null }] });
    expect((await gate.evaluate(T, 'pl-1', 's1')).warnings).toEqual([]);
  });

  it('no 1080p copy yet → the warning says so and a copy is wanted (never holds the publish)', async () => {
    const { gate, w } = make({ playback: [stutteredAt4K('s1')] });
    w.playlist!.items[0].asset.processingMeta = { processedDimensions: { w: 3840, h: 2160 }, probe: { fps: 30 } };
    const r = await gate.evaluate(T, 'pl-1', 's1');
    expect(r.warnings[0]).toMatchObject({ hasLighterCopy: false });
    expect(r.copyWanted).toEqual([{ id: 'clip', fileUrl: 'https://cdn/clip.mp4', fileSize: 40_000_000 }]);
  });

  it('enforce: concurrency on a SINGLE-face rk3288 (template video zone + playlist video) is refused 422, naming file + screen', async () => {
    process.env.VIDEO_PLAYBACK_GATE = 'enforce';
    const { gate, w } = make();
    w.screens[0] = { ...w.screens[0], resolution: '1920x1080', displayCapabilities: { build: { manufacturer: 'rockchip', model: 'rk3288', sdk: 25 } } };
    w.playlist!.template = { zones: [{ widgetType: 'VIDEO' }, { widgetType: 'TEXT' }] };
    await expect(gate.evaluate(T, 'pl-1', 's1')).rejects.toMatchObject({
      status: 422,
      response: expect.objectContaining({
        code: 'VIDEO_SCREEN_CANNOT_PLAY',
        files: [{ assetId: 'clip', name: 'Promo 4K.mp4' }],
        screens: [{ id: 's1', name: 'Lobby' }],
        reason: 'concurrency',
      }),
    });
  });

  it('owner decision B: a two-sided unit is NEVER refused, even in enforce — a two-sided warning instead', async () => {
    process.env.VIDEO_PLAYBACK_GATE = 'enforce';
    const rk = { build: { manufacturer: 'rockchip', model: 'rk3288', sdk: 25 } };
    const { gate } = make({
      screens: [{ id: 'front', name: 'DH43 Front', tenantId: T, resolution: '1080x1920', playerVersionCode: 30, displayCapabilities: rk, faceOfScreenId: null, faceContentMode: null }],
      unit: [
        { id: 'front', faceOfScreenId: null, faceContentMode: null, lastVideoReportAt: null },
        { id: 'back', faceOfScreenId: 'front', faceContentMode: 'MIRROR', lastVideoReportAt: null },
      ],
    });
    const r = await gate.evaluate(T, 'pl-1', 'front');
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'VIDEO_SCREEN_CANNOT_PLAY', reason: 'two-sided', screens: [{ id: 'front', name: 'DH43 Front' }] })]);
    expect(r.warnings[0].message).toContain("both sides of this display can't play video smoothly at the same time");
  });

  it('warn mode never refuses the same concurrency case', async () => {
    const { gate, w } = make();
    w.screens[0] = { ...w.screens[0], resolution: '1920x1080', displayCapabilities: { build: { manufacturer: 'rockchip', model: 'rk3288', sdk: 25 } } };
    w.playlist!.template = { zones: [{ widgetType: 'VIDEO' }] };
    const r = await gate.evaluate(T, 'pl-1', 's1');
    expect(r.warnings).toEqual([expect.objectContaining({ code: 'VIDEO_SCREEN_CANNOT_PLAY', reason: 'concurrency', demand: 2, max: 1 })]);
  });

  it('a group: one warning per file and reason, listing every affected screen', async () => {
    const { gate } = make({
      screens: [
        { id: 's1', name: 'Lobby', tenantId: T, resolution: '3840x2160', playerVersionCode: 30, displayCapabilities: null, faceOfScreenId: null, faceContentMode: null },
        { id: 's2', name: 'Gym', tenantId: T, resolution: '3840x2160', playerVersionCode: 30, displayCapabilities: null, faceOfScreenId: null, faceContentMode: null },
        { id: 's3', name: 'Office', tenantId: T, resolution: '3840x2160', playerVersionCode: 30, displayCapabilities: null, faceOfScreenId: null, faceContentMode: null },
      ],
      playback: [stutteredAt4K('s1'), stutteredAt4K('s2')],
    });
    const r = await gate.evaluate(T, 'pl-1', null, 'grp-1');
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].screens.map((s) => s.id)).toEqual(['s1', 's2']);
  });

  it('off: nothing is read; protected / emergency playlists are never evaluated', async () => {
    process.env.VIDEO_PLAYBACK_GATE = 'off';
    const off = make({ playback: [stutteredAt4K('s1')] });
    expect((await off.gate.evaluate(T, 'pl-1', 's1')).warnings).toEqual([]);
    expect(off.db.playlist.findFirst).not.toHaveBeenCalled();
    delete process.env.VIDEO_PLAYBACK_GATE;
    const prot = make({ playback: [stutteredAt4K('s1')] });
    prot.w.playlist!.isProtected = true;
    expect((await prot.gate.evaluate(T, 'pl-1', 's1')).warnings).toEqual([]);
    const em = make({ playback: [stutteredAt4K('s1')], emergencyTenant: true });
    expect((await em.gate.evaluate(T, 'pl-1', 's1')).warnings).toEqual([]);
  });

  it('a gate that cannot run says nothing and blocks nothing — even in enforce', async () => {
    process.env.VIDEO_PLAYBACK_GATE = 'enforce';
    const { gate } = make({ throwOnScreens: true });
    await expect(gate.evaluate(T, 'pl-1', 's1')).resolves.toMatchObject({ warnings: [] });
  });

  it('an unknown video size never warns', async () => {
    const { gate, w } = make({ playback: [stutteredAt4K('s1')] });
    w.playlist!.items[0].asset.processingMeta = {};
    expect((await gate.evaluate(T, 'pl-1', 's1')).warnings).toEqual([]);
  });

  it('message wording per reason', () => {
    const base = { code: 'VIDEO_SCREEN_CANNOT_PLAY' as const, assetId: 'a', file: 'f.mp4', screens: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }, { id: '3', name: 'C' }, { id: '4', name: 'D' }], hasLighterCopy: false };
    expect(playbackGateMessage({ ...base, reason: 'concurrency', demand: 2, max: 1 })).toBe('“f.mp4” may stutter on A, B, C and 1 more: it would play 2 videos at once, and this screen plays 1 smoothly. It will keep playing.');
    expect(playbackGateMessage({ ...base, reason: 'over-capability', demand: 60, max: 30 })).toContain('up to 30 frames per second');
  });
});

describe('MediaPublicationService.prepare runs the gate first (every activation door goes through prepare)', () => {
  function svc(gateResult: any, opts: { throws?: any } = {}) {
    const prisma: any = {
      client: {
        playlist: { findFirst: jest.fn(async () => ({ id: 'pl-1', items: [] })) },
        screen: { findMany: jest.fn(async () => [{ resolution: '3840x2160' }]) },
      },
    };
    const jobs: any = { enqueueForRendition: jest.fn(async () => true) };
    const gate: any = { evaluate: jest.fn(async () => { if (opts.throws) throw opts.throws; return gateResult; }) };
    const s = new MediaPublicationService(prisma, jobs, {} as any, {} as any, {} as any, {} as any, undefined, gate);
    return { s, jobs, gate, prisma };
  }
  const warning = { code: 'VIDEO_MAY_STUTTER', reason: 'capability', assetId: 'clip', file: 'f', screens: [{ id: 's1', name: 'A' }], hasLighterCopy: true, message: 'm' };

  it('warn: collects warnings, merges screens across rules, and still publishes', async () => {
    const { s, gate } = svc({ mode: 'warn', warnings: [warning], copyWanted: [] });
    const warnings: any[] = [];
    await expect(s.prepare(T, 'pl-1', 's1', null, { warnings })).resolves.toBe(false);
    gate.evaluate.mockResolvedValueOnce({ mode: 'warn', warnings: [{ ...warning, screens: [{ id: 's2', name: 'B' }] }], copyWanted: [] });
    await s.prepareRules(T, 'pl-1', [{ id: 'r2', screenId: 's2', screenGroupId: null }], { warnings });
    expect(warnings).toHaveLength(1);
    expect(warnings[0].screens.map((x: any) => x.id)).toEqual(['s1', 's2']);
  });

  it('enforce refusal propagates BEFORE the playlist is read (nothing queued, no row)', async () => {
    const refusal = Object.assign(new Error('refused'), { status: 422 });
    const { s, prisma, jobs } = svc(null, { throws: refusal });
    await expect(s.prepare(T, 'pl-1', 's1', null)).rejects.toBe(refusal);
    expect(prisma.client.playlist.findFirst).not.toHaveBeenCalled();
    expect(jobs.enqueueForRendition).not.toHaveBeenCalled();
  });

  it('a wanted copy is queued without holding the publish', async () => {
    const { s, jobs } = svc({ mode: 'warn', warnings: [], copyWanted: [{ id: 'clip', fileUrl: 'https://cdn/clip.mp4', fileSize: 9 }] });
    await expect(s.prepare(T, 'pl-1', 's1', null)).resolves.toBe(false);
    expect(jobs.enqueueForRendition).toHaveBeenCalledWith({ tenantId: T, assetId: 'clip', sourceUrl: 'https://cdn/clip.mp4', sourceBytes: 9 });
  });

  it('no gate wired (older construction): prepare behaves exactly as before', async () => {
    const prisma: any = { client: { playlist: { findFirst: jest.fn(async () => null) }, screen: { findMany: jest.fn(async () => []) } } };
    const s = new MediaPublicationService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    await expect(s.prepare(T, 'pl-1', 's1', null)).resolves.toBe(false);
  });
});
