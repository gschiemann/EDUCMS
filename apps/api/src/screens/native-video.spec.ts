import {
  buildNativeVideoDescriptor as build,
  nativeVideoCandidate,
  nativeVideoEnrolled,
  nativeVideoExperimentsFor,
  NATIVE_VIDEO_EXPERIMENTS,
  nativeFirstFor,
  parseNativeFirstRollout,
  parseNativeVideoExperiments,
  parseNativeVideoRollout,
} from './native-video';
import { buildNativeSharedVideoDescriptor } from './native-shared-video';

const front = '11111111-1111-4111-8111-111111111111',
  back = '22222222-2222-4222-8222-222222222222',
  single = '55555555-5555-4555-8555-555555555555';
const tenant = '33333333-3333-4333-8333-333333333333',
  assetId = '44444444-4444-4444-8444-444444444444';
const hash = 'a'.repeat(64),
  url =
    'https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/test.mp4';

function fixture(screenId = front) {
  const screen: Record<string, any> = {
    id: screenId,
    tenantId: tenant,
    status: 'ONLINE',
    faceOfScreenId: screenId === back ? front : null,
    faceIndex: screenId === back ? 1 : null,
    hardwareModel: null,
  };
  const item = {
    asset_id: assetId,
    url,
    asset_hash: hash,
    asset_size: 84_000_000,
    mime_type: 'video/mp4',
    muted: true,
  };
  const manifest: Record<string, any> = {
    screenId,
    tenantId: tenant,
    isEmergency: false,
    sync: { enabled: false },
    orientation: 'PORTRAIT',
    playlists: [{ id: 'playlist', schedule: { mode: 'replace' }, items: [item] }],
  };
  const asset: Record<string, any> = {
    id: assetId,
    fileUrl: url,
    fileHash: hash,
    fileSize: 84_000_000,
    processingMeta: {
      probe: { codec: 'h264', rotation: 0, pixFmt: 'yuv420p', fps: 30, codedWidth: 1080, codedHeight: 1920 },
    },
  };
  return { screen, item, manifest, asset };
}

describe('native video engine (protocol 2) — rollout switch', () => {
  const env = (v?: string) => (v === undefined ? {} : { PLAYER_NATIVE_VIDEO: v });
  const never = async () => {
    throw new Error('must not be asked');
  };
  const yes = async () => true;
  const no = async () => false;

  it('defaults to double-sided units only: both faces in, single-sided out', async () => {
    expect(parseNativeVideoRollout(env()).faces).toBe(true);
    // A back side needs no query at all.
    expect(await nativeVideoEnrolled({ id: back, faceOfScreenId: front }, never, env())).toBe(true);
    expect(await nativeVideoEnrolled({ id: front }, yes, env())).toBe(true);
    expect(await nativeVideoEnrolled({ id: single }, no, env())).toBe(false);
  });

  it('a failed face lookup enrols nobody (never fails the manifest)', async () => {
    expect(await nativeVideoEnrolled({ id: front }, never, env())).toBe(false);
  });

  it('off wins over everything; all / ids / models enrol; exclusions win', async () => {
    expect(await nativeVideoEnrolled({ id: back, faceOfScreenId: front }, yes, env('all,off'))).toBe(false);
    expect(await nativeVideoEnrolled({ id: single }, never, env('all'))).toBe(true);
    expect(await nativeVideoEnrolled({ id: single }, never, env(single))).toBe(true);
    expect(await nativeVideoEnrolled({ id: single, hardwareModel: 'goodview-ep6n' }, never, env('model:goodview-ep6n'))).toBe(true);
    expect(await nativeVideoEnrolled({ id: single, hardwareModel: 'pi5' }, no, env('model:goodview-ep6n'))).toBe(false);
    expect(await nativeVideoEnrolled({ id: single }, never, env(`all,-${single}`))).toBe(false);
    expect(await nativeVideoEnrolled({ id: back, faceOfScreenId: front, hardwareModel: 'x' }, never, env('faces,-model:x'))).toBe(false);
    // An explicit list without `faces` turns the default off.
    expect(await nativeVideoEnrolled({ id: back, faceOfScreenId: front }, yes, env(single))).toBe(false);
  });

  it('a typo enrols nobody new', async () => {
    expect(await nativeVideoEnrolled({ id: single }, yes, env('alll'))).toBe(false);
  });

  it('NovaStar Taurus stays on the web player whatever the switch says', async () => {
    expect(await nativeVideoEnrolled({ id: single, hardwareModel: 'novastar-taurus' }, never, env('all'))).toBe(false);
    expect(await nativeVideoEnrolled({ id: single, hardwareModel: 'novastar-taurus' }, never, env(single))).toBe(false);
  });
});

describe('native video engine (protocol 2) — descriptor', () => {
  it('describes ONE face independently: no peer, no pairing', () => {
    for (const id of [front, back, single]) {
      const f = fixture(id);
      const d = build(f);
      expect(d).toMatchObject({
        version: 2,
        screenId: id,
        tenantId: tenant,
        faceIndex: id === back ? 1 : 0,
        asset: { id: assetId, url, sha256: hash, size: 84_000_000, width: 1080, height: 1920, fps: 30 },
        transform: { orientation: 'PORTRAIT', fit: 'fill' },
      });
      expect(d).not.toHaveProperty('peerScreenId');
    }
  });

  it('an OWN-content back side playing a DIFFERENT file gets its own descriptor', () => {
    const a = build(fixture(front))!;
    const f = fixture(back);
    const other = 'c'.repeat(64);
    f.item.asset_hash = other;
    f.asset.fileHash = other;
    const b = build(f)!;
    expect(b.asset.sha256).toBe(other);
    expect(a.revision).not.toBe(b.revision);
  });

  it('is deterministic (safe in the hashed, hot-cached manifest)', () => {
    const first = build(fixture());
    const second = build(fixture());
    expect(first).toEqual(second);
    expect(first?.transform.fit).toBe('fill');
    expect(first?.revision).toBe(second?.revision);
  });

  it('accepts N copies of the same file (player collapses them) but not a mixed playlist', () => {
    const f = fixture();
    f.manifest.playlists[0].items = [f.item, { ...f.item }];
    expect(build(f)).not.toBeNull();
    f.manifest.playlists[0].items = [f.item, { ...f.item, mime_type: 'image/png' }];
    expect(nativeVideoCandidate(f.manifest)).toBe(false);
    expect(build(f)).toBeNull();
  });

  it.each([
    ['emergency', (f: any) => (f.manifest.isEmergency = true)],
    ['frame-locked sync', (f: any) => (f.manifest.sync = { enabled: true })],
    ['template', (f: any) => (f.manifest.playlists[0].template = { id: 't' })],
    ['an append row mixes items in', (f: any) => f.manifest.playlists.push({ ...f.manifest.playlists[0], schedule: { ...f.manifest.playlists[0].schedule, mode: 'append' } })],
    ['the winner has a day/time window', (f: any) => (f.manifest.playlists[0].schedule = { ...f.manifest.playlists[0].schedule, timeStart: '08:00', timeEnd: '15:00' })],
    ['audio', (f: any) => (f.item.muted = false)],
    ['canvas override', (f: any) => (f.manifest.canvasW = 1920)],
    ['revoked', (f: any) => (f.screen.status = 'REVOKED')],
    ['wrong screen', (f: any) => (f.manifest.screenId = single)],
    ['10-bit', (f: any) => (f.asset.processingMeta.probe.pixFmt = 'yuv420p10le')],
    ['hevc', (f: any) => (f.asset.processingMeta.probe.codec = 'hevc')],
    ['60 fps', (f: any) => (f.asset.processingMeta.probe.fps = 60)],
    ['rotation tag', (f: any) => (f.asset.processingMeta.probe.rotation = 90)],
    ['foreign host', (f: any) => (f.item.url = 'https://evil.example/storage/v1/object/public/assets/x.mp4')],
    ['face beyond the second', (f: any) => { f.screen.faceOfScreenId = front; f.screen.faceIndex = 2; }],
    ['no asset row', (f: any) => (f.asset = null)],
  ])('stays on the web path: %s', (_n, mutate) => {
    const f = fixture();
    mutate(f);
    expect(build(f)).toBeNull();
  });

  it('two REPLACE playlists: describes the winner (first in manifest order), like the player', () => {
    // VisionCore 2026-10-12: a screen-pinned playlist + an older group one.
    const f = fixture();
    f.manifest.playlists.push({ id: 'group-older', schedule: { mode: 'replace', pin: 'group', priority: 0 }, items: [] });
    expect(build(f)).not.toBeNull();
  });

  it('the shared asset gate did not change the protocol-1 pair descriptor', () => {
    const f = fixture(front);
    const peer = { id: back, tenantId: tenant, status: 'ONLINE', faceOfScreenId: front, faceIndex: 1, faceContentMode: 'MIRROR' };
    const env = { PLAYER_NATIVE_DUAL_VIDEO: `${front},${back}` } as any;
    const d = buildNativeSharedVideoDescriptor({ screen: f.screen, peer, manifest: f.manifest, asset: f.asset, env });
    expect(d).toMatchObject({ version: 1, asset: { width: 1080, height: 1920, fps: 30 }, transform: { fit: 'fill' } });
  });
});

describe('native video engine — the three M43 experiments (1.1.41, plan §4E)', () => {
  const env = (v?: string) => (v === undefined ? {} : { PLAYER_NATIVE_VIDEO_EXPERIMENTS: v });

  it('every experiment is OFF by default and the descriptor carries no key at all', () => {
    expect(nativeVideoExperimentsFor(front, env())).toBeNull();
    expect(nativeVideoExperimentsFor(front, env(''))).toBeNull();
    const d = build({ ...fixture(), env: env() as any })!;
    expect(d).not.toHaveProperty('experiments');
  });

  it('each experiment is switchable on its own, per screen or for all', () => {
    const r = parseNativeVideoExperiments(env(`webview-invisible:${front}, surface-frame-rate:all ,decoder-rotation:${back}`));
    expect(r.webviewInvisible.ids.has(front)).toBe(true);
    expect(r.webviewInvisible.all).toBe(false);
    expect(r.surfaceFrameRate.all).toBe(true);
    expect(r.decoderRotation.ids.has(back)).toBe(true);
    expect(nativeVideoExperimentsFor(front, env(`webview-invisible:${front},surface-frame-rate:all`))).toEqual({ webviewInvisible: true, surfaceFrameRate: true });
    expect(nativeVideoExperimentsFor(back, env(`webview-invisible:${front},surface-frame-rate:all`))).toEqual({ surfaceFrameRate: true });
    expect(nativeVideoExperimentsFor(single, env(`decoder-rotation:${back}`))).toBeNull();
    // Case-insensitive names and ids; a token's target is exact.
    expect(nativeVideoExperimentsFor(front.toUpperCase(), env(`Decoder-Rotation:${front.toUpperCase()}`))).toEqual({ decoderRotation: true });
  });

  it('a typo, a bare name, an unknown experiment or a non-uuid target enables nothing', () => {
    for (const v of ['webviewInvisible:all', 'webview-invisible', `webview-invisible:${front}x`, 'all', 'frame-rate:all', ':all', `surface-frame-rate:${front.slice(1)}`]) {
      expect({ v, flags: nativeVideoExperimentsFor(front, env(v)) }).toEqual({ v, flags: null });
    }
  });

  it('the flags ride on the hashed descriptor but stay OUTSIDE the revision (a flip never restarts a session on the glass)', () => {
    const off = build({ ...fixture(), env: env() as any })!;
    const on = build({ ...fixture(), env: env(`webview-invisible:${front},decoder-rotation:all`) as any })!;
    expect(on.experiments).toEqual({ webviewInvisible: true, decoderRotation: true });
    expect(on.revision).toBe(off.revision);
    const { experiments: _e, ...rest } = on;
    expect(rest).toEqual(off);
    // Deterministic: safe inside the hashed, hot-cached manifest.
    expect(build({ ...fixture(), env: env(`webview-invisible:${front}`) as any })).toEqual(build({ ...fixture(), env: env(`webview-invisible:${front}`) as any }));
  });

  it('1.1.42: the two pacing experiments parse by their exact tokens; near misses enable nothing', () => {
    expect(nativeVideoExperimentsFor(front, env(`vsync-snap:${front}`))).toEqual({ vsyncSnap: true });
    expect(nativeVideoExperimentsFor(front, env('prefer-60hz:all'))).toEqual({ prefer60hz: true });
    expect(nativeVideoExperimentsFor(front, env(`Vsync-Snap:${front}, PREFER-60HZ:all ,webview-invisible:${front}`)))
      .toEqual({ webviewInvisible: true, vsyncSnap: true, prefer60hz: true });
    expect(nativeVideoExperimentsFor(back, env(`vsync-snap:${front}`))).toBeNull();
    for (const v of ['vsyncSnap:all', 'vsync_snap:all', 'vsync-snap', 'prefer60hz:all', 'prefer-60:all', 'prefer-60-hz:all', `snap:${front}`]) {
      expect({ v, flags: nativeVideoExperimentsFor(front, env(v)) }).toEqual({ v, flags: null });
    }
    // Outside the revision like the other three: a flip never restarts a session on the glass.
    const off = build({ ...fixture(), env: env() as any })!;
    const on = build({ ...fixture(), env: env(`vsync-snap:${front},prefer-60hz:${front}`) as any })!;
    expect(on.experiments).toEqual({ vsyncSnap: true, prefer60hz: true });
    expect(on.revision).toBe(off.revision);
    expect(NATIVE_VIDEO_EXPERIMENTS).toEqual(['webviewInvisible', 'surfaceFrameRate', 'decoderRotation', 'vsyncSnap', 'prefer60hz']);
  });

  it('1.1.43: a negative token sends `false` — the kill switch of the two pacing defaults — and never touches the three experiments', () => {
    expect(nativeVideoExperimentsFor(front, env(`-vsync-snap:${front}`))).toEqual({ vsyncSnap: false });
    expect(nativeVideoExperimentsFor(back, env(`-vsync-snap:${front}`))).toBeNull();
    expect(nativeVideoExperimentsFor(single, env('-prefer-60hz:all'))).toEqual({ prefer60hz: false });
    // The kill switch wins over a positive token for the same screen, whatever their order.
    expect(nativeVideoExperimentsFor(front, env(`vsync-snap:all,-vsync-snap:${front}`))).toEqual({ vsyncSnap: false });
    expect(nativeVideoExperimentsFor(back, env(`vsync-snap:all,-vsync-snap:${front}`))).toEqual({ vsyncSnap: true });
    expect(nativeVideoExperimentsFor(front, env(`-prefer-60hz:all, prefer-60hz:${front}`))).toEqual({ prefer60hz: false });
    // The three experiments are off by default: a negative token for one changes nothing and cannot cancel a positive one.
    expect(nativeVideoExperimentsFor(front, env(`-webview-invisible:${front},-decoder-rotation:all`))).toBeNull();
    expect(nativeVideoExperimentsFor(front, env(`-surface-frame-rate:all,surface-frame-rate:${front}`))).toEqual({ surfaceFrameRate: true });
    // A malformed negative token disables nothing.
    for (const v of ['-vsync-snap', '--vsync-snap:all', `-vsync-snap:${front}x`, '-:all', '- prefer-60hz', '-prefer60hz:all']) {
      expect({ v, flags: nativeVideoExperimentsFor(front, env(v)) }).toEqual({ v, flags: null });
    }
    // Rides on the descriptor outside the revision, like every flag: flipping it never restarts a session on the glass.
    const off = build({ ...fixture(), env: env() as any })!;
    const killed = build({ ...fixture(), env: env(`-vsync-snap:${front},-prefer-60hz:${front}`) as any })!;
    expect(killed.experiments).toEqual({ vsyncSnap: false, prefer60hz: false });
    expect(killed.revision).toBe(off.revision);
  });

  it('a back face gets its own flags by its own id, never its primary\'s', () => {
    const b = build({ ...fixture(back), env: env(`surface-frame-rate:${front}`) as any })!;
    expect(b).not.toHaveProperty('experiments');
    expect(build({ ...fixture(back), env: env(`surface-frame-rate:${back}`) as any })!.experiments).toEqual({ surfaceFrameRate: true });
  });
});

/**
 * FIELD 2026-10-12 — the API is NOT the gate that kept M43 / L55VEC on the
 * web engine. Production rows as read from the database that morning, with
 * the production `PLAYER_NATIVE_VIDEO` shape: both screens are enrolled and
 * both get a protocol-2 descriptor for the original 4K file. (Railway HTTP
 * logs agree: under APK 1.1.29 each box fetched its manifest natively and
 * downloaded the file — the page then blocked it; see "field 2026-10-12" in
 * apps/web/src/app/player/__tests__/nativeVideoEngine.test.ts.)
 */
describe('field 2026-10-12 — the T982 pair is enrolled and gets a descriptor', () => {
  const tenantId = '28d09f9d-0a6c-4828-b46d-38712eb69f1f';
  const url =
    'https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/28d09f9d-0a6c-4828-b46d-38712eb69f1f/6bd9a41f-131e-4a96-a8e8-1b24f3ac2956.mp4';
  const sha = 'd4d05533719e94ccc8d0a280149b1971a87a31f8641366b53e1fa97a071438dd';
  const asset = {
    id: '9c0eb1c6-2486-484a-863d-e74c2dde5e93',
    fileUrl: url,
    fileHash: sha,
    fileSize: 186_954_348,
    mimeType: 'video/mp4',
    processingMeta: {
      probe: { fps: 30, codec: 'h264', level: 51, pixFmt: 'yuv420p', profile: 'High', rotation: 0, codedWidth: 2160, codedHeight: 3338 },
    },
  };
  const env = {
    PLAYER_NATIVE_VIDEO:
      'faces,40864836-9367-47a3-b349-ba1c3378f814,882706a8-33d9-45a6-a10c-c102e56da8b2,c4945182-435e-4260-8765-8091243828cc',
    SUPABASE_URL: 'https://bhdaxzfalaycfopvcopm.supabase.co',
  } as any;
  it.each([
    ['M43', 'c4945182-435e-4260-8765-8091243828cc', 'generic-android', 'AUTO'],
    ['L55VEC', '882706a8-33d9-45a6-a10c-c102e56da8b2', 'maxhub-l55vec', 'PORTRAIT'],
  ])('%s', async (_n, id, hardwareModel, orientation) => {
    const screen = { id, tenantId, status: 'ONLINE', hardwareModel, faceOfScreenId: null, faceIndex: null };
    expect(await nativeVideoEnrolled(screen, async () => false, env)).toBe(true);
    const manifest = {
      screenId: id, tenantId, isEmergency: false, sync: { enabled: false }, repeats: 1, canvasW: null, canvasH: null, orientation,
      playlists: [{
        id: 'pl', schedule: { mode: 'replace' },
        items: [{ asset_id: asset.id, asset_hash: sha, asset_size: 186_954_348, url, mime_type: 'video/mp4', muted: true }],
      }],
    };
    expect(nativeVideoCandidate(manifest)).toBe(true);
    expect(build({ screen, manifest, asset, env })).toMatchObject({
      version: 2, screenId: id, faceIndex: 0,
      asset: { id: asset.id, url, sha256: sha, size: 186_954_348, width: 2160, height: 3338, fps: 30 },
      transform: { orientation, fit: 'fill' },
    });
  });
});

/**
 * NATIVE-FIRST switch (design docs/design/NATIVE-FIRST-ONE-STORE.md §8.1):
 * `PLAYER_NATIVE_FIRST`, carried per face as `nativeFirst: boolean` on the
 * hashed descriptor OUTSIDE its revision; absent = the APK's class default.
 */
describe('native-first switch (PLAYER_NATIVE_FIRST, §8.1)', () => {
  const env = (v?: string, video?: string) => ({
    ...(v === undefined ? {} : { PLAYER_NATIVE_FIRST: v }),
    ...(video === undefined ? {} : { PLAYER_NATIVE_VIDEO: video }),
  });
  const withClass = (id: string, cls: string, hardwareModel: string | null = null) => ({
    id, hardwareModel, lastVideoReport: { native: { device: { class: cls } } },
  });

  it('unset / empty names nobody: no key on the descriptor (the APK class default)', () => {
    expect(nativeFirstFor({ id: front }, env())).toBeNull();
    expect(nativeFirstFor({ id: front }, env('  '))).toBeNull();
    expect('nativeFirst' in build({ ...fixture(), env: env() as any })!).toBe(false);
  });

  it('a screen uuid, a model, a reported class and `all` include', () => {
    expect(nativeFirstFor({ id: front }, env(front))).toBe(true);
    expect(nativeFirstFor({ id: front }, env(front.toUpperCase()))).toBe(true);
    expect(nativeFirstFor({ id: single, hardwareModel: 'Goodview-EP6N' }, env('model:goodview-ep6n'))).toBe(true);
    expect(nativeFirstFor(withClass(single, 'amlogic/android-13'), env('class:amlogic/android-13'))).toBe(true);
    expect(nativeFirstFor({ id: single }, env('all'))).toBe(true);
    // Not named → null, never false (false is the kill switch).
    expect(nativeFirstFor({ id: single }, env(front))).toBeNull();
    expect(nativeFirstFor(withClass(single, 'rockchip/android-7'), env('class:amlogic/android-13'))).toBeNull();
  });

  it('exclusions win over inclusions and answer false; off wins over everything', () => {
    expect(nativeFirstFor({ id: front }, env(`all,-${front}`))).toBe(false);
    expect(nativeFirstFor({ id: front, hardwareModel: 'x' }, env(`${front},-model:x`))).toBe(false);
    expect(nativeFirstFor(withClass(front, 'amlogic/android-11'), env(`${front},-class:amlogic/android-11`))).toBe(false);
    expect(nativeFirstFor({ id: front }, env(`${front},off`))).toBe(false);
    expect(nativeFirstFor({ id: single }, env('off'))).toBe(false);
    for (const k of ['0', 'false', 'no', 'OFF']) expect(nativeFirstFor({ id: single }, env(k))).toBe(false);
  });

  it('a class token never matches a screen that has not reported its class', () => {
    expect(nativeFirstFor({ id: single }, env('class:amlogic/android-13'))).toBeNull();
    expect(nativeFirstFor({ id: single }, env('-class:amlogic/android-13'))).toBeNull();
    expect(nativeFirstFor({ id: single, lastVideoReport: 'garbage' }, env('class:amlogic/android-13'))).toBeNull();
    expect(nativeFirstFor(withClass(single, 'amlogic/android-13 '), env('class:amlogic/android-13'))).toBeNull();
  });

  it('a typo, a malformed class, a negative `all` / `off` or a non-uuid names nobody', () => {
    for (const t of ['alll', 'class:amlogic', 'class:Amlogic/android-x', '-all', '-off', 'model:', 'faces', 'front', `${front}x`]) {
      expect(nativeFirstFor(withClass(front, 'amlogic/android-13', 'x'), env(t))).toBeNull();
    }
  });

  it('rides on the hashed descriptor OUTSIDE the revision (a flip never restarts a session)', () => {
    const none = build({ ...fixture(), env: env() as any })!;
    const on = build({ ...fixture(), env: env(front) as any })!;
    const off = build({ ...fixture(), env: env('off') as any })!;
    expect(on.nativeFirst).toBe(true);
    expect(off.nativeFirst).toBe(false);
    expect(on.revision).toBe(none.revision);
    expect(off.revision).toBe(none.revision);
    const { nativeFirst: _n, ...rest } = on;
    expect(rest).toEqual(none);
    // Deterministic: safe inside the hashed, hot-cached manifest.
    expect(build({ ...fixture(), env: env(front) as any })).toEqual(build({ ...fixture(), env: env(front) as any }));
  });

  it('each face is resolved by its OWN id (a back face never inherits its primary)', () => {
    const b = fixture(back);
    expect(build({ ...b, env: env(front) as any })!.nativeFirst).toBeUndefined();
    expect(build({ ...b, env: env(back) as any })!.nativeFirst).toBe(true);
  });

  it('emergency content still gets NO descriptor at all (§7 E2 — the server lock)', () => {
    const f = fixture();
    f.manifest.isEmergency = true;
    expect(build({ ...f, env: env('all') as any })).toBeNull();
    const g = fixture();
    delete g.manifest.isEmergency;
    expect(build({ ...g, env: env(front) as any })).toBeNull();
  });

  it('an inclusion enrols the screen in the native engine; native-video kill switches still win', async () => {
    const never = async () => {
      throw new Error('must not be asked');
    };
    // A single-sided screen is outside the default `faces` rollout …
    expect(await nativeVideoEnrolled({ id: single }, async () => false, env())).toBe(false);
    // … naming it for native-first gives it the descriptor it needs.
    expect(await nativeVideoEnrolled({ id: single }, never, env(single))).toBe(true);
    expect(await nativeVideoEnrolled(withClass(single, 'amlogic/android-11'), never, env('class:amlogic/android-11'))).toBe(true);
    // A native-first exclusion / off is no enrolment of its own.
    expect(await nativeVideoEnrolled({ id: single }, async () => false, env(`-${single}`))).toBe(false);
    expect(await nativeVideoEnrolled({ id: single }, async () => false, env('off'))).toBe(false);
    // PLAYER_NATIVE_VIDEO's own kill switches and Taurus win over native-first.
    expect(await nativeVideoEnrolled({ id: single }, never, env(single, 'off'))).toBe(false);
    expect(await nativeVideoEnrolled({ id: single }, never, env(single, `faces,-${single}`))).toBe(false);
    expect(await nativeVideoEnrolled({ id: single, hardwareModel: 'novastar-taurus' }, never, env(single))).toBe(false);
  });

  it('parses every token kind into its own set', () => {
    const r = parseNativeFirstRollout(env(`${front},-${back},model:a,-model:b,class:rockchip/android-7,-class:amlogic/android-11`));
    expect([...r.ids]).toEqual([front]);
    expect([...r.excludeIds]).toEqual([back]);
    expect([...r.models]).toEqual(['a']);
    expect([...r.excludeModels]).toEqual(['b']);
    expect([...r.classes]).toEqual(['rockchip/android-7']);
    expect([...r.excludeClasses]).toEqual(['amlogic/android-11']);
    expect(r.off || r.all).toBe(false);
  });
});
