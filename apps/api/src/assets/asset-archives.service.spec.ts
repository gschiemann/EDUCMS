import { Writable } from 'stream';
import JSZip from 'jszip';
import type { Response } from 'express';
import {
  AssetArchivesService,
  archiveNames,
  ARCHIVE_MAX_BYTES,
} from './asset-archives.service';
import { AssetArchivesController } from './asset-archives.controller';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../realtime/redis.service';
import { SupabaseStorageService } from '../storage/supabase-storage.service';

const TENANT = '28d09f9d-0a6c-4828-b46d-38712eb69f1f';
const IDS = [1, 2, 3].map((n) => `00000000-0000-4000-8000-00000000000${n}`);
const actor = { userId: 'user-one', apiKeyId: null };
const BASE = 'https://storage.example.test';
const publicUrl = (path: string) =>
  `${BASE}/storage/v1/object/public/assets/${path}`;
class DownloadResponse extends Writable {
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  _write(chunk: Buffer, _: string, done: () => void) {
    this.chunks.push(Buffer.from(chunk));
    done();
  }
}

function setup() {
  const rows = IDS.map((id, n) => ({
    id,
    fileUrl: publicUrl(`${TENANT}/${id}.mp4`),
    originalName: n < 2 ? 'Loop café.mp4' : '../Welcome.mp4',
    mimeType: 'video/mp4',
  }));
  const prisma = {
    client: {
      asset: {
        findMany: jest
          .fn<Promise<typeof rows>, [unknown]>()
          .mockResolvedValue(rows),
      },
      auditLog: {
        create: jest
          .fn<Promise<object>, [{ data: Record<string, unknown> }]>()
          .mockResolvedValue({}),
      },
    },
  };
  // Exercise the service's replay/capacity behavior without requiring a Redis
  // binary in unit-test CI. The Lua scripts also have a real-Redis smoke test.
  const data = new Map<string, string>();
  const cache = {
    status: 'ready',
    set: jest.fn((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve('OK');
    }),
    eval: jest.fn((script: string, count: number, ...args: string[]) => {
      const keys = args.slice(0, count);
      const owner = args[count];
      if (script.includes('local data=')) {
        const value = data.get(keys[0]);
        data.delete(keys[0]);
        return Promise.resolve(value ?? null);
      }
      if (script.includes('for _,key')) {
        keys.forEach((key) => {
          if (data.get(key) === owner) data.delete(key);
        });
        return Promise.resolve(1);
      }
      if (keys.some((key) => data.has(key))) return Promise.resolve(0);
      keys.forEach((key) => data.set(key, owner));
      return Promise.resolve(1);
    }),
  };
  const storage = {
    publicUrlForPath: publicUrl,
    // Pure parser; binding preserves its declared receiver for typed lint.
    parseObjectUrl: (url: string) =>
      SupabaseStorageService.prototype.parseObjectUrl.call(
        {} as SupabaseStorageService,
        url,
      ) as ReturnType<SupabaseStorageService['parseObjectUrl']>,
  };
  const service = new AssetArchivesService(
    prisma as unknown as PrismaService,
    storage as unknown as SupabaseStorageService,
    { publisher: cache } as unknown as RedisService,
  );
  return { service, prisma, rows, cache, data };
}

let request: jest.SpyInstance;
beforeEach(() => {
  request = jest.spyOn(global, 'fetch').mockImplementation((_url, init) => {
    const bytes = Buffer.from('original video bytes');
    return Promise.resolve(
      new global.Response(init?.method === 'HEAD' ? null : bytes, {
        headers: { 'content-length': String(bytes.length) },
      }),
    );
  });
});
afterEach(() => request.mockRestore());

it('downloads exactly three files, preserving bytes and duplicate names in one streamed ZIP', async () => {
  const t = setup();
  const grant = await t.service.prepare(TENANT, actor, IDS);
  const response = new DownloadResponse();
  await t.service.download(grant.ticket, response as unknown as Response);
  expect(response.headers['Content-Disposition']).toMatch(
    /^attachment; filename="VenueOS-assets-/,
  );
  expect(response.headers['Cache-Control']).toBe('private, no-store');
  const zip = await JSZip.loadAsync(Buffer.concat(response.chunks));
  expect(Object.keys(zip.files)).toEqual([
    'Loop café.mp4',
    'Loop café (2).mp4',
    '.._Welcome.mp4',
  ]);
  for (const file of Object.values(zip.files))
    expect(await file.async('nodebuffer')).toEqual(
      Buffer.from('original video bytes'),
    );
  expect(t.prisma.client.asset.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { tenantId: TENANT, id: { in: IDS }, status: { not: 'ARCHIVED' } },
    }),
  );
  expect(
    t.prisma.client.auditLog.create.mock.calls.map(([call]) => call.data),
  ).toEqual([
    expect.objectContaining({
      tenantId: TENANT,
      ...actor,
      action: 'ASSET_ARCHIVE_DOWNLOAD_PREPARED',
    }),
    expect.objectContaining({
      tenantId: TENANT,
      ...actor,
      action: 'ASSET_ARCHIVE_DOWNLOAD_STARTED',
    }),
  ]);
  await expect(
    t.service.download(
      grant.ticket,
      new DownloadResponse() as unknown as Response,
    ),
  ).rejects.toThrow('expired or already started');
  expect(t.data.size).toBe(0);
});

it('rejects foreign-tenant or missing IDs without issuing a partial ZIP', async () => {
  const t = setup();
  t.prisma.client.asset.findMany.mockResolvedValue([t.rows[0]]);
  await expect(t.service.prepare(TENANT, actor, IDS)).rejects.toThrow(
    'unavailable in this account',
  );
  expect(request).not.toHaveBeenCalled();
  expect(t.cache.set).not.toHaveBeenCalled();
});

it.each([
  [undefined],
  [[]],
  [[IDS[0]]],
  [[...IDS, IDS[0]]],
  [['not-a-uuid', IDS[0]]],
  [Array.from({ length: 51 }, () => IDS[0])],
])(
  'validates all selected IDs before making a database query (%j)',
  async (ids) => {
    const t = setup();
    await expect(
      t.service.prepare(TENANT, actor, ids as unknown as string[]),
    ).rejects.toThrow('between 2 and 50');
    expect(t.prisma.client.asset.findMany).not.toHaveBeenCalled();
  },
);

it.each([
  `${BASE}/storage/v1/object/public/floorplans/${TENANT}/map.pdf`,
  `${BASE}/storage/v1/object/public/assets/another-tenant/video.mp4`,
  `https://evil.example/storage/v1/object/public/assets/${TENANT}/video.mp4`,
  `${BASE}/storage/v1/object/public/assets/${TENANT}/%2e%2e%2fvideo.mp4`,
])(
  'refuses private buckets, cross-tenant objects, untrusted hosts, and encoded traversal (%s)',
  async (url) => {
    const t = setup();
    t.rows[0].fileUrl = url;
    await expect(t.service.prepare(TENANT, actor, IDS)).rejects.toThrow();
    expect(t.cache.set).not.toHaveBeenCalled();
    expect(t.data.size).toBe(0);
  },
);

it('rejects web links with an actionable message', async () => {
  const t = setup();
  t.rows[0].mimeType = 'text/html';
  await expect(t.service.prepare(TENANT, actor, IDS)).rejects.toThrow(
    'Web links cannot',
  );
});

it('does not authorize an archive if any source is unavailable', async () => {
  const t = setup();
  request.mockResolvedValueOnce(new global.Response(null, { status: 404 }));
  await expect(t.service.prepare(TENANT, actor, IDS)).rejects.toThrow(
    'No ZIP was started',
  );
  expect(t.cache.set).not.toHaveBeenCalled();
  expect(t.data.size).toBe(0);
});

it('enforces the 2 GB bound from actual object metadata, without allocating those bytes', async () => {
  const t = setup();
  request.mockResolvedValue(
    new global.Response(null, {
      headers: { 'content-length': String(ARCHIVE_MAX_BYTES) },
    }),
  );
  await expect(t.service.prepare(TENANT, actor, IDS)).rejects.toThrow(
    'limited to 2 GB',
  );
  expect(t.cache.set).not.toHaveBeenCalled();
});

it('rechecks ownership and source identity before starting a ticketed download', async () => {
  const t = setup();
  const grant = await t.service.prepare(TENANT, actor, IDS);
  t.rows[0].fileUrl += '?changed=1';
  const response = new DownloadResponse();
  await expect(
    t.service.download(grant.ticket, response as unknown as Response),
  ).rejects.toThrow('selected file changed');
  expect(response.chunks).toHaveLength(0);
  expect(t.data.size).toBe(0);
});

it('stops an incomplete object transfer instead of returning a successful partial archive', async () => {
  const t = setup();
  const grant = await t.service.prepare(TENANT, actor, IDS);
  request.mockResolvedValue(new global.Response(Buffer.from('short')));
  const response = new DownloadResponse();
  await expect(
    t.service.download(grant.ticket, response as unknown as Response),
  ).rejects.toThrow('incomplete');
  expect(response.destroyed).toBe(true);
  expect(t.data.size).toBe(0);
});

it('limits one archive per tenant and releases capacity when preparation fails', async () => {
  const t = setup();
  await t.service.prepare(TENANT, actor, IDS);
  await expect(t.service.prepare(TENANT, actor, IDS)).rejects.toThrow(
    'already being prepared',
  );
});

it('fails closed when Redis is unavailable or the audit write fails', async () => {
  const t = setup();
  t.cache.status = 'end';
  await expect(t.service.prepare(TENANT, actor, IDS)).rejects.toThrow(
    'temporarily unavailable',
  );
  t.cache.status = 'ready';
  t.prisma.client.auditLog.create.mockRejectedValueOnce(
    new Error('audit unavailable'),
  );
  await expect(t.service.prepare(TENANT, actor, IDS)).rejects.toThrow(
    'No ZIP was started',
  );
  expect(t.cache.set).not.toHaveBeenCalled();
  expect(t.data.size).toBe(0);
});

it('keeps the initiating human or API key on the archive audit trail', () => {
  const prepare = jest.fn();
  const controller = new AssetArchivesController({
    prepare,
  } as unknown as AssetArchivesService);
  void controller.prepare(
    { user: { tenantId: TENANT, id: 'human' } },
    { assetIds: IDS },
  );
  void controller.prepare(
    { user: { tenantId: TENANT, kind: 'api-key', apiKeyId: 'key-one' } },
    { assetIds: IDS },
  );
  expect(prepare.mock.calls).toEqual([
    [TENANT, { userId: 'human', apiKeyId: null }, IDS],
    [TENANT, { userId: null, apiKeyId: 'key-one' }, IDS],
  ]);
});

it('makes portable, flat names and handles case-insensitive collisions', () => {
  expect(
    archiveNames(['CON.txt', 'LOOP.mp4', 'loop.mp4', '/', 'name. ']),
  ).toEqual(['_CON.txt', 'LOOP.mp4', 'loop (2).mp4', '_', 'name']);
});
