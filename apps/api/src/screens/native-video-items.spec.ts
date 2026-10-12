import {
  buildNativeVideoItems as build,
  nativeTemplateVideoZones,
  nativeVideoItemsCandidate,
  templateVideoZoneConfigEligible,
  NATIVE_VIDEO_MAX_ZONES,
} from './native-video-items';
import { buildNativeVideoDescriptor, nativeVideoCandidate } from './native-video';

const front = '11111111-1111-4111-8111-111111111111',
  back = '22222222-2222-4222-8222-222222222222';
const tenant = '33333333-3333-4333-8333-333333333333';
const assetA = '44444444-4444-4444-8444-444444444444',
  assetB = '66666666-6666-4666-8666-666666666666',
  imageId = '77777777-7777-4777-8777-777777777777';
const hashA = 'a'.repeat(64),
  hashB = 'b'.repeat(64);
const urlA = 'https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/a.mp4';
const urlB = 'https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/b.mp4';
const urlImg = 'https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/i.png';

function asset(id: string, url: string, hash: string): Record<string, any> {
  return {
    id,
    tenantId: tenant,
    mimeType: 'video/mp4',
    fileUrl: url,
    fileHash: hash,
    fileSize: 10_000_000,
    processingMeta: {
      probe: { codec: 'h264', rotation: 0, pixFmt: 'yuv420p', fps: 30, codedWidth: 1920, codedHeight: 1080 },
    },
  };
}
const assets: Record<string, any> = { [assetA]: asset(assetA, urlA, hashA), [assetB]: asset(assetB, urlB, hashB) };
const byId = (id: string) => assets[id];
const byUrl = (url: string) => Object.values(assets).find((a) => a.fileUrl === url);

function videoItem(itemId: string, id: string, url: string, hash: string, muted = true) {
  return { item_id: itemId, asset_id: id, url, asset_hash: hash, asset_size: 10_000_000, mime_type: 'video/mp4', muted };
}
const imageItem = { item_id: 'i1', asset_id: imageId, url: urlImg, asset_hash: 'c'.repeat(64), asset_size: 1000, mime_type: 'image/png', muted: true };

function screen(id = front): Record<string, any> {
  return {
    id,
    tenantId: tenant,
    status: 'ONLINE',
    faceOfScreenId: id === back ? front : null,
    faceIndex: id === back ? 1 : null,
    hardwareModel: null,
  };
}
function manifest(screenId: string, playlist: Record<string, any>): Record<string, any> {
  return {
    screenId,
    tenantId: tenant,
    isEmergency: false,
    sync: { enabled: false },
    orientation: 'LANDSCAPE',
    playlists: [{ id: 'playlist', schedule: { mode: 'replace' }, items: [], ...playlist }],
  };
}
const mixed = () => manifest(front, { items: [videoItem('v1', assetA, urlA, hashA), imageItem, videoItem('v2', assetB, urlB, hashB)] });

function zone(id: string, extra: Record<string, any> = {}, cfg: Record<string, any> = {}): Record<string, any> {
  return {
    id,
    widgetType: 'VIDEO',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    zIndex: 1,
    sortOrder: 0,
    touchAction: null,
    sceneId: null,
    defaultConfig: { assetUrl: urlA, ...cfg },
    ...extra,
  };
}
const template = (zones: Array<Record<string, any>>, extra: Record<string, any> = {}) =>
  manifest(front, { template: { id: 't', screenWidth: 1920, screenHeight: 1080, zones, scenes: [], ...extra } });

describe('native video protocol 3 — candidates', () => {
  it('a solo video is protocol 2, never protocol 3 (its payload hash does not move)', () => {
    const solo = manifest(front, { items: [videoItem('v1', assetA, urlA, hashA)] });
    expect(nativeVideoCandidate(solo)).toBe(true);
    expect(nativeVideoItemsCandidate(solo)).toBe(false);
    expect(build({ screen: screen(), manifest: solo, assetById: byId, assetByUrl: byUrl })).toBeNull();
    expect(buildNativeVideoDescriptor({ screen: screen(), manifest: solo, asset: assets[assetA] })).not.toBeNull();
  });
  it('a mixed playlist and a template with a VIDEO zone are candidates; an image-only playlist is not', () => {
    expect(nativeVideoItemsCandidate(mixed())).toBe(true);
    expect(nativeVideoItemsCandidate(template([zone('z1')]))).toBe(true);
    expect(nativeVideoItemsCandidate(manifest(front, { items: [imageItem] }))).toBe(false);
    expect(nativeVideoItemsCandidate(template([{ ...zone('z1'), widgetType: 'IMAGE' }]))).toBe(false);
  });
});

describe('native video protocol 3 — mixed playlists', () => {
  it('lists every muted MP4 item as its own slot, in playlist order, playing once (no loop)', () => {
    const d = build({ screen: screen(), manifest: mixed(), assetById: byId, assetByUrl: byUrl })!;
    expect(d).toMatchObject({ version: 3, screenId: front, tenantId: tenant, faceIndex: 0, orientation: 'LANDSCAPE' });
    expect(d.items.map((i: any) => [i.slot, i.asset.sha256, i.loop])).toEqual([
      ['item:v1', hashA, false],
      ['item:v2', hashB, false],
    ]);
    expect(d.items[0].asset).toEqual({ id: assetA, url: urlA, sha256: hashA, size: 10_000_000, width: 1920, height: 1080, fps: 30 });
  });
  it('an audio-on item or a file the shared asset gate refuses is simply left to the web', () => {
    const m = mixed();
    m.playlists[0].items[0].muted = false;
    const d = build({ screen: screen(), manifest: m, assetById: byId, assetByUrl: byUrl })!;
    expect(d.items.map((i: any) => i.slot)).toEqual(['item:v2']);
    const m2 = mixed();
    const d2 = build({ screen: screen(), manifest: m2, assetById: (id) => (id === assetB ? null : byId(id)), assetByUrl: byUrl })!;
    expect(d2.items.map((i: any) => i.slot)).toEqual(['item:v1']);
  });
  it('nothing native = no field (web exactly as today)', () => {
    const m = mixed();
    m.playlists[0].items.forEach((i: any) => (i.muted = false));
    expect(build({ screen: screen(), manifest: m, assetById: byId, assetByUrl: byUrl })).toBeNull();
  });
  it('the back face of a double-sided unit gets faceIndex 1 and its own revision', () => {
    const a = build({ screen: screen(front), manifest: mixed(), assetById: byId, assetByUrl: byUrl })!;
    const m = mixed();
    m.screenId = back;
    const b = build({ screen: screen(back), manifest: m, assetById: byId, assetByUrl: byUrl })!;
    expect(b.faceIndex).toBe(1);
    expect(a.revision).not.toBe(b.revision);
  });
  it('refuses emergency, sync, repeats, canvas overrides, a non-replace schedule, revoked, identity mismatch', () => {
    const ok = () => build({ screen: screen(), manifest: mixed(), assetById: byId, assetByUrl: byUrl });
    expect(ok()).not.toBeNull();
    for (const mutate of [
      (m: any) => (m.isEmergency = true),
      (m: any) => delete m.isEmergency,
      (m: any) => (m.sync = { enabled: true }),
      (m: any) => (m.repeats = 2),
      (m: any) => (m.canvasW = 320),
      (m: any) => (m.playlists[0].schedule.mode = 'fill'),
      (m: any) => (m.screenId = back),
      (m: any) => (m.orientation = 'UPSIDE'),
      (m: any) => m.playlists.push({ id: 'p2', schedule: { mode: 'replace' }, items: [] }),
    ]) {
      const m = mixed();
      mutate(m);
      expect(build({ screen: screen(), manifest: m, assetById: byId, assetByUrl: byUrl })).toBeNull();
    }
    expect(build({ screen: { ...screen(), status: 'REVOKED' }, manifest: mixed(), assetById: byId, assetByUrl: byUrl })).toBeNull();
  });
  it('is deterministic (safe in the hashed, hot-cached manifest) and carries no clock', () => {
    const a = build({ screen: screen(), manifest: mixed(), assetById: byId, assetByUrl: byUrl });
    const b = build({ screen: screen(), manifest: mixed(), assetById: byId, assetByUrl: byUrl });
    expect(a).toEqual(b);
    expect(JSON.stringify(a)).not.toMatch(/generatedAt|Date|now/);
  });
});

describe('native video protocol 3 — template VIDEO zones', () => {
  it('a plain VIDEO zone becomes a looping slot resolved by its assetUrl', () => {
    const d = build({ screen: screen(), manifest: template([zone('z1')]), assetById: byId, assetByUrl: byUrl })!;
    expect(d.items).toEqual([{ slot: 'zone:z1', asset: { id: assetA, url: urlA, sha256: hashA, size: 10_000_000, width: 1920, height: 1080, fps: 30 }, loop: true }]);
    const once = build({ screen: screen(), manifest: template([zone('z1', {}, { loop: false })]), assetById: byId, assetByUrl: byUrl })!;
    expect(once.items[0].loop).toBe(false);
  });
  it('zone config the hole cannot honour stays web: opacity, radius, odd rotation, own background, audio, hidden', () => {
    expect(templateVideoZoneConfigEligible({ assetUrl: urlA })).toBe(true);
    expect(templateVideoZoneConfigEligible({ assetUrl: urlA, _zoneRotation: 270, fit: 'contain' })).toBe(true);
    for (const bad of [
      { opacity: 0.5 },
      { _zoneOpacity: 0.9 },
      { borderRadius: 12 },
      { _zoneRotation: 45 },
      { bgColor: '#fff' },
      { muted: false },
      { autoplay: false },
      { hidden: true },
      { fit: 'scale-down' },
    ]) {
      expect(templateVideoZoneConfigEligible({ assetUrl: urlA, ...bad })).toBe(false);
    }
    expect(templateVideoZoneConfigEligible({})).toBe(false);
    expect(templateVideoZoneConfigEligible(null)).toBe(false);
  });
  it('a zone that a LOWER zone overlaps stays web; a zone ABOVE it is fine (the page paints above the surface)', () => {
    const under = { id: 'bg', widgetType: 'IMAGE', x: 0, y: 0, width: 100, height: 100, zIndex: 0, defaultConfig: {} };
    const over = { ...under, id: 'logo', zIndex: 5, x: 10, y: 10, width: 20, height: 20 };
    expect(nativeTemplateVideoZones({ zones: [under, zone('z1')], scenes: [] })).toEqual([]);
    expect(nativeTemplateVideoZones({ zones: [zone('z1'), over], scenes: [] }).map((z) => z.id)).toEqual(['z1']);
    // Equal zIndex: document order decides — an earlier sibling is below.
    expect(nativeTemplateVideoZones({ zones: [{ ...under, zIndex: 1 }, zone('z1')], scenes: [] })).toEqual([]);
    expect(nativeTemplateVideoZones({ zones: [zone('z1'), { ...under, zIndex: 1 }], scenes: [] }).map((z) => z.id)).toEqual(['z1']);
    // A lower zone that does not touch the video's rect does not matter.
    expect(nativeTemplateVideoZones({ zones: [{ ...under, x: 60, width: 40 }, zone('z1')], scenes: [] }).map((z) => z.id)).toEqual(['z1']);
  });
  it('caps at NATIVE_VIDEO_MAX_ZONES in zone order; touch templates and multi-scene templates stay web', () => {
    const zones = [zone('a'), zone('b', { x: 50 }), zone('c', { y: 50 })];
    expect(nativeTemplateVideoZones({ zones, scenes: [] }).map((z) => z.id)).toEqual(['a', 'b']);
    expect(NATIVE_VIDEO_MAX_ZONES).toBe(2);
    expect(nativeTemplateVideoZones({ zones, scenes: [], isTouchEnabled: true })).toEqual([]);
    expect(nativeTemplateVideoZones({ zones, scenes: [{ id: 's1' }] })).toEqual([]);
    expect(nativeTemplateVideoZones({ zones: [zone('a', { touchAction: { type: 'open-url' } })], scenes: [] })).toEqual([]);
    expect(nativeTemplateVideoZones({ zones: [zone('a', { sceneId: 's1' })], scenes: [] })).toEqual([]);
  });
  it('an assetUrl that is not a tenant MP4 asset row, or a row not screen-ready, stays web', () => {
    const other = { ...zone('z1'), defaultConfig: { assetUrl: 'https://bhdaxzfalaycfopvcopm.supabase.co/storage/v1/object/public/assets/x.mp4' } };
    expect(build({ screen: screen(), manifest: template([other]), assetById: byId, assetByUrl: byUrl })).toBeNull();
    const notReady = { ...assets[assetA], processingMeta: { ...assets[assetA].processingMeta, screen: { ready: false } } };
    expect(build({ screen: screen(), manifest: template([zone('z1')]), assetById: byId, assetByUrl: () => notReady })).toBeNull();
    const mov = { ...assets[assetA], mimeType: 'video/quicktime' };
    expect(build({ screen: screen(), manifest: template([zone('z1')]), assetById: byId, assetByUrl: () => mov })).toBeNull();
  });
  it('revision changes with the zone set, the file and the orientation', () => {
    const a = build({ screen: screen(), manifest: template([zone('z1')]), assetById: byId, assetByUrl: byUrl })!;
    const b = build({ screen: screen(), manifest: template([zone('z1', { x: 50 })]), assetById: byId, assetByUrl: byUrl })!;
    expect(a.revision).toBe(b.revision); // geometry is measured by the page, not part of identity
    const c = build({ screen: screen(), manifest: template([zone('z2')]), assetById: byId, assetByUrl: byUrl })!;
    expect(c.revision).not.toBe(a.revision);
    const m = template([zone('z1')]);
    m.orientation = 'PORTRAIT';
    const d = build({ screen: screen(), manifest: m, assetById: byId, assetByUrl: byUrl })!;
    expect(d.revision).not.toBe(a.revision);
  });
});
