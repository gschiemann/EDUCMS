/**
 * USB made simple (2026-10-22). Greg: "just allow people to download the
 * playlist to a USB by default … our app … reads our playlist and retains all
 * the settings". Guards: no setting stands between an admin and the export,
 * the key is minted silently, and every packaged playlist is a player
 * manifest playlist (the fields the web player reads live).
 */
import 'reflect-metadata';
import { createHash, createHmac } from 'crypto';
import JSZip from 'jszip';

jest.mock('../branding/safe-fetch', () => ({ safeFetch: jest.fn() }));
import { safeFetch } from '../branding/safe-fetch';
import { UsbExportController, cleanBundleSchedule } from './usb-export.controller';
import { ensureUsbSigningKey } from './usb-signing-key';
import { SCREEN_STAMP_VERSION } from '@cms/api-types';

const mockedSafeFetch = safeFetch as jest.MockedFunction<any>;
const bytes = Buffer.from('a-picture');
const hash = createHash('sha256').update(bytes).digest('hex');
const req = { user: { id: 'user-1', tenantId: 'tenant-1' } } as any;

const playlist = {
  id: 'pl-1',
  name: 'Lobby',
  template: null,
  items: [
    {
      id: 'item-1',
      assetId: 'asset-1',
      durationMs: 8000,
      sequenceOrder: 0,
      transitionType: 'fade',
      muted: false,
      asset: { id: 'asset-1', fileUrl: 'https://cdn.test/a.png', fileHash: hash, mimeType: 'image/png', fileSize: bytes.byteLength },
    },
  ],
};

function harness(opts: { tenant?: Record<string, unknown>; playlists?: Record<string, any>; schedules?: any[] } = {}) {
  const tenant: any = { id: 'tenant-1', slug: 'demo', usbIngestEnabled: true, usbIngestKey: 'a'.repeat(64), emergencyPlaylistId: null, ...opts.tenant };
  const playlists = opts.playlists ?? { 'pl-1': playlist };
  const tenantUpdateMany = jest.fn(async ({ where, data }: any) => {
    if (where.usbIngestKey !== undefined && where.usbIngestKey !== tenant.usbIngestKey) return { count: 0 };
    tenant.usbIngestKey = data.usbIngestKey;
    return { count: 1 };
  });
  const assetUpdate = jest.fn().mockResolvedValue({});
  const client = {
    tenant: { findUnique: jest.fn(async () => tenant), updateMany: tenantUpdateMany },
    screen: { findUnique: jest.fn(async () => null) },
    schedule: { findMany: jest.fn(async () => opts.schedules ?? []) },
    playlist: { findMany: jest.fn(async ({ where }: any) => (where.id.in as string[]).map((id) => playlists[id]).filter(Boolean)) },
    asset: { update: assetUpdate },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  return { controller: new UsbExportController({ client } as any), tenant, tenantUpdateMany, assetUpdate, client };
}

function res() {
  let ended: Buffer | null = null;
  return { setHeader: () => {}, end: (b: Buffer) => { ended = b; }, get body() { return ended; } } as any;
}

async function unzip(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const raw = await zip.file('edu-cms-content/manifest.json')!.async('string');
  const sig = await zip.file('edu-cms-content/manifest.sig')!.async('string');
  return { raw, sig, manifest: JSON.parse(raw), fileNames: Object.keys(zip.files) };
}

beforeEach(() => {
  mockedSafeFetch.mockReset();
  mockedSafeFetch.mockResolvedValue({ body: bytes, contentType: 'image/png', finalUrl: 'https://cdn.test/a.png', status: 200 });
});

describe('USB export — no setting', () => {
  it('exports for a tenant that never turned USB on, minting the key silently and signing with it', async () => {
    const h = harness({ tenant: { usbIngestEnabled: false, usbIngestKey: null } });
    const r = res();
    await h.controller.bundle(req, r, { playlistIds: ['pl-1'] });
    expect(r.body).toBeInstanceOf(Buffer);
    expect(h.tenantUpdateMany).toHaveBeenCalledTimes(1);
    expect(h.tenant.usbIngestKey).toMatch(/^[0-9a-f]{64}$/);
    const { raw, sig } = await unzip(r.body);
    expect(sig).toBe(createHmac('sha256', Buffer.from(h.tenant.usbIngestKey, 'hex')).update(raw, 'utf-8').digest('hex'));
  });

  it('never re-mints an existing key', async () => {
    const h = harness();
    await h.controller.bundle(req, res(), { playlistIds: ['pl-1'] });
    expect(h.tenantUpdateMany).not.toHaveBeenCalled();
    expect(h.tenant.usbIngestKey).toBe('a'.repeat(64));
  });

  it('ensureUsbSigningKey: two first callers end on ONE key', async () => {
    const tenant: any = { usbIngestKey: null };
    const prisma: any = {
      client: {
        tenant: {
          findUnique: jest.fn(async () => ({ usbIngestKey: tenant.usbIngestKey })),
          updateMany: jest.fn(async ({ where, data }: any) => {
            if (where.usbIngestKey !== tenant.usbIngestKey) return { count: 0 };
            tenant.usbIngestKey = data.usbIngestKey;
            return { count: 1 };
          }),
        },
      },
    };
    const [a, b] = await Promise.all([ensureUsbSigningKey(prisma, 't'), ensureUsbSigningKey(prisma, 't')]);
    expect(a).toBe(b);
    expect(a).toBe(tenant.usbIngestKey);
  });
});

describe('USB export — the package keeps the playlist settings', () => {
  it('carries every field the web player reads from a live manifest playlist', async () => {
    const h = harness();
    const r = res();
    await h.controller.bundle(req, r, { playlistIds: ['pl-1'], schedule: { daysOfWeek: 'Mon,Tue', timeStart: '08:00', timeEnd: '15:00' } });
    const { manifest } = await unzip(r.body);
    const pl = manifest.playlists[0];
    expect(pl.schedule).toEqual({ daysOfWeek: 'Mon,Tue', timeStart: '08:00', timeEnd: '15:00', mutedOverride: null, mode: 'replace', pin: 'screen', priority: 0 });
    expect(pl.contentRev).toMatch(/^[0-9a-f]{12}$/);
    expect(pl.items[0]).toMatchObject({
      item_id: 'item-1', asset_id: 'asset-1', asset_hash: hash, asset_size: bytes.byteLength,
      url: 'https://cdn.test/a.png', mime_type: 'image/png', duration_ms: 8000, sequence: 0,
      transition_type: 'fade', muted: false,
    });
  });

  it('serializes the template with its touch settings, scenes and per-zone config', async () => {
    const withTemplate = {
      ...playlist,
      template: {
        id: 't1', name: 'Board', screenWidth: 1080, screenHeight: 1920, bgColor: '#000', bgGradient: null, bgImage: null,
        isTouchEnabled: true, idleResetMs: 30000, scenes: [{ id: 's1' }],
        zones: [{ id: 'z1', name: 'Clock', widgetType: 'CLOCK', x: 0, y: 0, width: 50, height: 10, zIndex: 1, sortOrder: 0, touchAction: { go: 's1' }, sceneId: 's1', defaultConfig: '{"format":"24h"}' }],
      },
    };
    const h = harness({ playlists: { 'pl-1': withTemplate } });
    const r = res();
    await h.controller.bundle(req, r, { playlistIds: ['pl-1'] });
    const { manifest } = await unzip(r.body);
    expect(manifest.playlists[0].template).toMatchObject({
      isTouchEnabled: true, idleResetMs: 30000, scenes: [{ id: 's1' }],
      zones: [{ widgetType: 'CLOCK', touchAction: { go: 's1' }, sceneId: 's1', defaultConfig: { format: '24h' } }],
    });
  });

  it('without a window, uses the playlist\'s own published window when its rules agree', async () => {
    const h = harness({ schedules: [
      { playlistId: 'pl-1', daysOfWeek: 'Sat', timeStart: '10:00', timeEnd: '12:00' },
      { playlistId: 'pl-1', daysOfWeek: 'Sat', timeStart: '10:00', timeEnd: '12:00' },
    ] });
    const r = res();
    await h.controller.bundle(req, r, { playlistIds: ['pl-1'] });
    expect((await unzip(r.body)).manifest.playlists[0].schedule).toMatchObject({ daysOfWeek: 'Sat', timeStart: '10:00', timeEnd: '12:00' });
  });

  it('disagreeing rules mean always on', async () => {
    const h = harness({ schedules: [
      { playlistId: 'pl-1', daysOfWeek: 'Sat', timeStart: null, timeEnd: null },
      { playlistId: 'pl-1', daysOfWeek: 'Sun', timeStart: null, timeEnd: null },
    ] });
    const r = res();
    await h.controller.bundle(req, r, { playlistIds: ['pl-1'] });
    expect((await unzip(r.body)).manifest.playlists[0].schedule).toMatchObject({ daysOfWeek: null, timeStart: null, timeEnd: null });
  });

  it('cleanBundleSchedule turns garbage or half a window into "no limit"', () => {
    expect(cleanBundleSchedule({ daysOfWeek: 'Funday', timeStart: '25:00', timeEnd: '08:00' })).toEqual({ daysOfWeek: null, timeStart: null, timeEnd: null });
    expect(cleanBundleSchedule({ timeStart: '08:00' })).toEqual({ daysOfWeek: null, timeStart: null, timeEnd: null });
    expect(cleanBundleSchedule(null)).toEqual({ daysOfWeek: null, timeStart: null, timeEnd: null });
  });

  it('names a file by the hash of the bytes written, even when the stored hash is stale', async () => {
    const stale = { ...playlist, items: [{ ...playlist.items[0], asset: { ...playlist.items[0].asset, fileHash: 'f'.repeat(64) } }] };
    const h = harness({ playlists: { 'pl-1': stale } });
    const r = res();
    await h.controller.bundle(req, r, { playlistIds: ['pl-1'] });
    const { manifest, fileNames } = await unzip(r.body);
    expect(manifest.assets[0].sha256).toBe(hash);
    expect(manifest.playlists[0].items[0].asset_hash).toBe(hash);
    expect(fileNames).toContain(`edu-cms-content/assets/${hash}.png`);
    expect(h.assetUpdate).toHaveBeenCalledWith({ where: { id: 'asset-1', tenantId: 'tenant-1' }, data: { fileHash: hash } });
  });

  it('leaves out a video that is not ready for screens, as the live manifest does', async () => {
    const notReady = {
      ...playlist,
      items: [{ ...playlist.items[0], asset: { ...playlist.items[0].asset, mimeType: 'video/mp4', fileUrl: 'https://cdn.test/v.mp4', processingMeta: { screen: { version: SCREEN_STAMP_VERSION, ready: false } } } }],
    };
    const h = harness({ playlists: { 'pl-1': notReady } });
    const r = res();
    await h.controller.bundle(req, r, { playlistIds: ['pl-1'] });
    expect((await unzip(r.body)).manifest.playlists[0].items).toHaveLength(0);
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });

  it('counts files it could not download instead of dropping them silently', async () => {
    mockedSafeFetch.mockRejectedValue(new Error('network down'));
    const h = harness();
    const r = res();
    await h.controller.bundle(req, r, { playlistIds: ['pl-1'] });
    const { manifest } = await unzip(r.body);
    expect(manifest.skippedFiles).toBe(1);
    expect(manifest.playlists[0].items).toHaveLength(0);
  });
});
