import {
  buildNativeVideoDescriptor as build,
  nativeVideoCandidate,
  nativeVideoEnrolled,
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
        transform: { orientation: 'PORTRAIT', fit: 'cover' },
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
    expect(build(fixture())).toEqual(build(fixture()));
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
    ['two playlists', (f: any) => f.manifest.playlists.push(f.manifest.playlists[0])],
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

  it('the shared asset gate did not change the protocol-1 pair descriptor', () => {
    const f = fixture(front);
    const peer = { id: back, tenantId: tenant, status: 'ONLINE', faceOfScreenId: front, faceIndex: 1, faceContentMode: 'MIRROR' };
    const env = { PLAYER_NATIVE_DUAL_VIDEO: `${front},${back}` } as any;
    const d = buildNativeSharedVideoDescriptor({ screen: f.screen, peer, manifest: f.manifest, asset: f.asset, env });
    expect(d).toMatchObject({ version: 1, asset: { width: 1080, height: 1920, fps: 30 }, transform: { fit: 'fill' } });
  });
});
