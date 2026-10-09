import { buildNativeSharedVideoDescriptor as build } from './native-shared-video';
const front = '11111111-1111-4111-8111-111111111111',
  back = '22222222-2222-4222-8222-222222222222';
const tenant = '33333333-3333-4333-8333-333333333333',
  assetId = '44444444-4444-4444-8444-444444444444';
const hash = 'a'.repeat(64),
  url =
    'https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/test.mp4';
function fixture() {
  const screen = {
    id: front,
    tenantId: tenant,
    playerVersionCode: 10125,
    status: 'ONLINE',
    faceOfScreenId: null,
    faceIndex: null,
  };
  const peer = {
    id: back,
    tenantId: tenant,
    playerVersionCode: 10125,
    status: 'ONLINE',
    faceOfScreenId: front,
    faceIndex: 1,
    faceContentMode: 'MIRROR',
  };
  const item = {
    asset_id: assetId,
    url,
    asset_hash: hash,
    asset_size: 84000000,
    mime_type: 'video/mp4',
    muted: true,
  };
  const manifest = {
    screenId: front,
    tenantId: tenant,
    isEmergency: false,
    sync: { enabled: false },
    orientation: 'PORTRAIT',
    playlists: [
      { id: 'playlist', schedule: { mode: 'replace' }, items: [item] },
    ],
  };
  const asset = {
    id: assetId,
    fileUrl: 'https://original.mp4',
    fileHash: 'b'.repeat(64),
    fileSize: 180000000,
    processingMeta: {
      probe: {
        codec: 'h264',
        rotation: 0,
        pixFmt: 'yuv420p',
        fps: 30,
        codedWidth: 2160,
        codedHeight: 3338,
      },
      renditions: {
        '1080p': {
          url,
          sha256: hash,
          size: 84000000,
          width: 1080,
          height: 1668,
        },
      },
    },
  };
  return {
    screen,
    peer,
    manifest,
    asset,
    env: { PLAYER_NATIVE_DUAL_VIDEO: `${front},${back}` },
  };
}
describe('explicit native mirrored-video admission', () => {
  it('is absent by default and when either participant is not explicitly admitted', () => {
    const f = fixture();
    expect(build({ ...f, env: {} })).toBeNull();
    expect(
      build({ ...f, env: { PLAYER_NATIVE_DUAL_VIDEO: front } }),
    ).toBeNull();
  });
  it('gives both reciprocal faces the same stable revision and selected-file dimensions', () => {
    const f = fixture(),
      a = build(f)!;
    const b = build({
      ...f,
      screen: f.peer,
      peer: f.screen,
      manifest: { ...f.manifest, screenId: back, orientation: 'AUTO' },
    })!;
    expect(a).toMatchObject({
      faceIndex: 0,
      asset: { width: 1080, height: 1668, size: 84000000, sha256: hash },
    });
    expect(b).toMatchObject({
      faceIndex: 1,
      primaryScreenId: front,
      peerScreenId: front,
      revision: a.revision,
    });
    expect(
      build({ ...f, manifest: { ...f.manifest, generatedAt: 'later' } })
        ?.revision,
    ).toBe(a.revision);
  });
  it('refuses tenant crossing, revoked peers and independently assigned rear content', () => {
    const f = fixture();
    for (const change of [
      { tenantId: back },
      { status: 'REVOKED' },
      { faceContentMode: 'OWN' },
      { faceOfScreenId: back },
      { faceIndex: 2 },
    ])
      expect(build({ ...f, peer: { ...f.peer, ...change } })).toBeNull();
  });
  it('refuses emergency, sync, canvases, templates, mixed content and time-window schedules', () => {
    const f = fixture();
    for (const change of [
      { isEmergency: true },
      { sync: { enabled: true } },
      { canvasW: 1080 },
      { repeats: 2 },
    ])
      expect(
        build({ ...f, manifest: { ...f.manifest, ...change } }),
      ).toBeNull();
    const pl = f.manifest.playlists[0];
    for (const change of [
      { template: {} },
      { items: [...pl.items, ...pl.items] },
      { schedule: { mode: 'replace', timeStart: '08:00' } },
      { schedule: { mode: 'append' } },
    ])
      expect(
        build({
          ...f,
          manifest: { ...f.manifest, playlists: [{ ...pl, ...change }] },
        }),
      ).toBeNull();
  });
  it('refuses an incoherent URL/hash/size or unsupported source properties', () => {
    const f = fixture();
    const pl = f.manifest.playlists[0];
    for (const change of [
      { asset_hash: 'b'.repeat(64) },
      { asset_size: 1 },
      { url: 'https://evil.test/file.mp4' },
      { muted: false },
      { mime_type: 'text/html' },
    ])
      expect(
        build({
          ...f,
          manifest: {
            ...f.manifest,
            playlists: [{ ...pl, items: [{ ...pl.items[0], ...change }] }],
          },
        }),
      ).toBeNull();
    for (const change of [
      { rotation: 90 },
      { fps: 60 },
      { pixFmt: 'yuv420p10le' },
      { codec: 'hevc' },
    ])
      expect(
        build({
          ...f,
          asset: {
            ...f.asset,
            processingMeta: {
              ...f.asset.processingMeta,
              probe: { ...f.asset.processingMeta.probe, ...change },
            },
          },
        }),
      ).toBeNull();
  });
});
