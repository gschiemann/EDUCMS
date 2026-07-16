/**
 * USB export — behavioral guards for the two 2026-07-16 launch-readiness
 * storage findings (S12 + S13). Unlike usb-bundle-contract.spec.ts (a
 * pure shape/source guard), this spec constructs the controller with a
 * mocked Prisma + a mocked safeFetch, calls bundle() end-to-end, unzips
 * the produced ZIP, and asserts the manifest CONTENTS.
 *
 * S12 — an asset with a null fileHash (every fresh presign upload) must be
 *       INCLUDED in the bundle: the controller hashes the bytes it already
 *       downloads and self-heals Asset.fileHash, instead of silently
 *       dropping the asset so the offline kiosk plays a playlist with
 *       missing items and no error surfaced.
 *
 * S13 — when a screenId is targeted, includeEmergency must bundle the
 *       screen's per-type emergency playlists (lockdown/evacuate/weather/
 *       hold/secure/medical + portrait variants), deduped against the
 *       tenant-default emergency playlist — not just the tenant default.
 */

import 'reflect-metadata';
import { createHash } from 'crypto';
import JSZip from 'jszip';

// Mock the network fetch BEFORE importing the controller so the controller
// binds to the mock. safeFetch returns { body: Buffer, contentType, ... }.
jest.mock('../branding/safe-fetch', () => ({
  safeFetch: jest.fn(),
}));
import { safeFetch } from '../branding/safe-fetch';
import { UsbExportController } from './usb-export.controller';

const mockedSafeFetch = safeFetch as jest.MockedFunction<any>;

const KEY_HEX =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** A Screen row with every emergency*PlaylistId field null unless overridden. */
function screenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'scr-1',
    tenantId: 'tenant-1',
    emergencyLockdownPlaylistId: null,
    emergencyEvacuatePlaylistId: null,
    emergencyWeatherPlaylistId: null,
    emergencyHoldPlaylistId: null,
    emergencySecurePlaylistId: null,
    emergencyMedicalPlaylistId: null,
    emergencyLockdownPortraitPlaylistId: null,
    emergencyEvacuatePortraitPlaylistId: null,
    emergencyWeatherPortraitPlaylistId: null,
    emergencyHoldPortraitPlaylistId: null,
    emergencySecurePortraitPlaylistId: null,
    emergencyMedicalPortraitPlaylistId: null,
    ...overrides,
  };
}

/**
 * Build a controller + mock Prisma. `playlists` is keyed by id; playlist
 * findMany returns the subset requested by `where.id.in`.
 */
function makeHarness(opts: {
  tenant?: Record<string, unknown>;
  screen?: Record<string, unknown> | null;
  playlists: Record<string, any>;
}) {
  const tenant = {
    id: 'tenant-1',
    slug: 'demo',
    usbIngestEnabled: true,
    usbIngestKey: KEY_HEX,
    emergencyPlaylistId: null,
    ...opts.tenant,
  };

  const assetUpdate = jest.fn().mockResolvedValue({});
  const playlistFindMany = jest.fn(async ({ where }: any) => {
    const ids: string[] = where?.id?.in ?? [];
    return ids.map((id) => opts.playlists[id]).filter(Boolean);
  });

  const client = {
    tenant: {
      findUnique: jest.fn().mockResolvedValue(tenant),
      update: jest.fn().mockResolvedValue({}),
    },
    screen: {
      findUnique: jest.fn().mockResolvedValue(opts.screen ?? null),
    },
    playlist: { findMany: playlistFindMany },
    asset: { update: assetUpdate },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };

  const prisma = { client } as any;
  const controller = new UsbExportController(prisma);
  return { controller, client, assetUpdate, playlistFindMany };
}

/** Fake express Response that captures the buffer passed to res.end(). */
function makeRes() {
  const headers: Record<string, string> = {};
  let ended: Buffer | null = null;
  const res: any = {
    setHeader: (k: string, v: string) => {
      headers[k] = v;
    },
    end: (buf: Buffer) => {
      ended = buf;
    },
    get body() {
      return ended;
    },
    headers,
  };
  return res;
}

async function unzipManifest(zipBuffer: Buffer) {
  const zip = await JSZip.loadAsync(zipBuffer);
  const raw = await zip.file('edu-cms-content/manifest.json')!.async('string');
  const fileNames = Object.keys(zip.files);
  return { manifest: JSON.parse(raw), fileNames };
}

const req = { user: { id: 'user-1', tenantId: 'tenant-1' } } as any;

beforeEach(() => {
  mockedSafeFetch.mockReset();
});

describe('USB export S12 — null fileHash assets are hashed, not dropped', () => {
  it('includes a null-fileHash asset with a real 64-hex sha256 + localPath, and self-heals the DB', async () => {
    const bytes = Buffer.from('fresh-upload-with-no-stored-hash');
    const expectedHash = createHash('sha256').update(bytes).digest('hex');

    mockedSafeFetch.mockResolvedValue({
      body: bytes,
      contentType: 'video/mp4',
      finalUrl: 'https://cdn.test/clip.mp4',
      status: 200,
    });

    const { controller, assetUpdate } = makeHarness({
      playlists: {
        'pl-1': {
          id: 'pl-1',
          name: 'Lobby',
          template: null,
          items: [
            {
              durationMs: 5000,
              sequenceOrder: 0,
              transitionType: null,
              asset: {
                id: 'asset-1',
                fileUrl: 'https://cdn.test/clip.mp4',
                fileHash: null, // ← the whole point: no stored hash
                mimeType: 'video/mp4',
                fileSize: bytes.byteLength,
              },
            },
          ],
        },
      },
    });

    const res = makeRes();
    await controller.bundle(req, res, {
      playlistIds: ['pl-1'],
      includeEmergency: false,
    });

    expect(res.body).toBeInstanceOf(Buffer);
    const { manifest, fileNames } = await unzipManifest(res.body as Buffer);

    // (1) The asset is present in the flat top-level assets[] (the array the
    //     Android ingester reads) — NOT dropped.
    expect(manifest.assets).toHaveLength(1);
    const a = manifest.assets[0];
    expect(a.sha256).toBe(expectedHash);
    expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(a.localPath).toBe(`assets/${expectedHash}.mp4`);
    expect(a.url).toBe('https://cdn.test/clip.mp4');

    // (2) The playlist item references the same computed hash + storagePath.
    expect(manifest.playlists[0].items).toHaveLength(1);
    expect(manifest.playlists[0].items[0].asset.sha256).toBe(expectedHash);
    expect(manifest.playlists[0].items[0].asset.storagePath).toBe(
      `assets/${expectedHash}.mp4`,
    );

    // (3) The bytes were actually written into the ZIP under that path.
    expect(fileNames).toContain(`edu-cms-content/assets/${expectedHash}.mp4`);
    expect(manifest.assetCount).toBe(1);

    // (4) Self-heal: the computed hash was persisted back to Asset.fileHash.
    expect(assetUpdate).toHaveBeenCalledWith({
      where: { id: 'asset-1' },
      data: { fileHash: expectedHash },
    });
  });

  it('still drops a null-fileHash asset only when its bytes cannot be fetched (can not fabricate a hash)', async () => {
    mockedSafeFetch.mockRejectedValue(new Error('network down'));

    const { controller, assetUpdate } = makeHarness({
      playlists: {
        'pl-1': {
          id: 'pl-1',
          name: 'Lobby',
          template: null,
          items: [
            {
              durationMs: 5000,
              sequenceOrder: 0,
              transitionType: null,
              asset: {
                id: 'asset-x',
                fileUrl: 'https://cdn.test/gone.mp4',
                fileHash: null,
                mimeType: 'video/mp4',
                fileSize: 10,
              },
            },
          ],
        },
      },
    });

    const res = makeRes();
    await controller.bundle(req, res, {
      playlistIds: ['pl-1'],
      includeEmergency: false,
    });

    const { manifest } = await unzipManifest(res.body as Buffer);
    // No hash could be computed → asset omitted, no DB self-heal, empty items.
    expect(manifest.assets).toHaveLength(0);
    expect(manifest.playlists[0].items).toHaveLength(0);
    expect(assetUpdate).not.toHaveBeenCalled();
  });
});

describe('USB export S13 — per-screen per-type emergency playlists are bundled', () => {
  it('includes a screen per-type emergency playlist (evacuate) when includeEmergency + screenId are set', async () => {
    const { controller } = makeHarness({
      tenant: { emergencyPlaylistId: null },
      screen: screenRow({ emergencyEvacuatePlaylistId: 'em-evac' }),
      playlists: {
        'pl-1': { id: 'pl-1', name: 'Lobby', template: null, items: [] },
        'em-evac': {
          id: 'em-evac',
          name: 'Evacuate — Gym Wing',
          template: null,
          items: [],
        },
      },
    });

    const res = makeRes();
    await controller.bundle(req, res, {
      playlistIds: ['pl-1'],
      includeEmergency: true,
      screenId: 'scr-1',
    });

    const { manifest } = await unzipManifest(res.body as Buffer);
    const emIds = manifest.emergencyPlaylists.map((p: any) => p.id);
    expect(emIds).toContain('em-evac');
  });

  it('dedupes the tenant-default against per-screen ids and bundles every distinct resolvable board', async () => {
    const { controller, playlistFindMany } = makeHarness({
      // Tenant default + a per-screen lockdown that REUSES it (must dedupe),
      // plus a distinct evacuate + a portrait weather board.
      tenant: { emergencyPlaylistId: 'em-shared' },
      screen: screenRow({
        emergencyLockdownPlaylistId: 'em-shared', // same as tenant default
        emergencyEvacuatePlaylistId: 'em-evac',
        emergencyWeatherPortraitPlaylistId: 'em-weather-portrait',
      }),
      playlists: {
        'pl-1': { id: 'pl-1', name: 'Lobby', template: null, items: [] },
        'em-shared': { id: 'em-shared', name: 'Default', template: null, items: [] },
        'em-evac': { id: 'em-evac', name: 'Evacuate', template: null, items: [] },
        'em-weather-portrait': {
          id: 'em-weather-portrait',
          name: 'Weather (portrait)',
          template: null,
          items: [],
        },
      },
    });

    const res = makeRes();
    await controller.bundle(req, res, {
      playlistIds: ['pl-1'],
      includeEmergency: true,
      screenId: 'scr-1',
    });

    // The emergency findMany is the 2nd playlist.findMany call. Its requested
    // id set must be deduped (em-shared appears once) and carry all distinct
    // boards.
    const emergencyCall = playlistFindMany.mock.calls.find(
      (c: any[]) => Array.isArray(c[0]?.where?.id?.in) &&
        c[0].where.id.in.includes('em-evac'),
    );
    expect(emergencyCall).toBeDefined();
    const requestedIds: string[] = emergencyCall![0].where.id.in;
    expect(requestedIds).toEqual(
      expect.arrayContaining(['em-shared', 'em-evac', 'em-weather-portrait']),
    );
    // Deduped: em-shared appears exactly once.
    expect(requestedIds.filter((x) => x === 'em-shared')).toHaveLength(1);

    const { manifest } = await unzipManifest(res.body as Buffer);
    const emIds = manifest.emergencyPlaylists.map((p: any) => p.id).sort();
    expect(emIds).toEqual(['em-evac', 'em-shared', 'em-weather-portrait']);
  });

  it('with no screenId, only the tenant-default emergency playlist is bundled (unchanged behavior)', async () => {
    const { controller } = makeHarness({
      tenant: { emergencyPlaylistId: 'em-shared' },
      screen: null,
      playlists: {
        'pl-1': { id: 'pl-1', name: 'Lobby', template: null, items: [] },
        'em-shared': { id: 'em-shared', name: 'Default', template: null, items: [] },
      },
    });

    const res = makeRes();
    await controller.bundle(req, res, {
      playlistIds: ['pl-1'],
      includeEmergency: true,
    });

    const { manifest } = await unzipManifest(res.body as Buffer);
    expect(manifest.emergencyPlaylists.map((p: any) => p.id)).toEqual(['em-shared']);
  });
});
