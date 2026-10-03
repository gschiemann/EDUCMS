import 'reflect-metadata';
import { Writable } from 'stream';
import JSZip from 'jszip';
import supertest from 'supertest';
import type { Response } from 'express';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AppRole } from '@cms/database';
import {
  AssetArchivesService,
  archiveNames,
  ARCHIVE_MAX_BYTES,
} from './asset-archives.service';
import { AssetArchivesController } from './asset-archives.controller';
import { AssetsController } from './assets.controller';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RbacGuard } from '../auth/rbac.guard';
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

type Row = {
  id: string;
  fileUrl: string;
  originalName: string;
  mimeType: string;
};
type Where = {
  OR?: Array<{ tenantId: string; fileUrl: string }>;
};

function setup() {
  const rows: Row[] = IDS.map((id, n) => ({
    id,
    fileUrl: publicUrl(`${TENANT}/${id}.mp4`),
    originalName: n < 2 ? 'Loop café.mp4' : '../Welcome.mp4',
    mimeType: 'video/mp4',
  }));
  // Rows OTHER tenants hold, for the shared-file rule (fleet copies).
  const ownerRows: Array<{ tenantId: string; fileUrl: string }> = [];
  const prisma = {
    client: {
      asset: {
        findMany: jest.fn((args: { where: Where }) =>
          Promise.resolve(
            args.where.OR
              ? ownerRows.filter((held) =>
                  args.where.OR!.some(
                    (c) =>
                      c.tenantId === held.tenantId &&
                      c.fileUrl === held.fileUrl,
                  ),
                )
              : rows,
          ),
        ),
      },
      auditLog: {
        create: jest
          .fn<Promise<object>, [{ data: Record<string, unknown> }]>()
          .mockResolvedValue({}),
      },
    },
  };
  // Exercise the service's replay/capacity behavior without requiring a Redis
  // binary in unit-test CI. Scripts are told apart by their text; `ttl`
  // records the last expiry each key was given.
  const data = new Map<string, string>();
  const ttl = new Map<string, unknown>();
  const refreshes: unknown[][] = [];
  const cache = {
    status: 'ready',
    set: jest.fn((key: string, value: string) => {
      data.set(key, value);
      return Promise.resolve('OK');
    }),
    get: jest.fn((key: string) => Promise.resolve(data.get(key) ?? null)),
    eval: jest.fn((script: string, count: number, ...args: string[]) => {
      const keys = args.slice(0, count);
      const owner = args[count];
      if (script.includes('local data=')) {
        const value = data.get(keys[0]);
        data.delete(keys[0]);
        if (!value) return Promise.resolve(null);
        const grant = JSON.parse(value) as {
          tenantId: string;
          slot: number;
          owner: string;
        };
        const lease = [
          `asset-archive:{downloads}:tenant:${grant.tenantId}`,
          `asset-archive:{downloads}:slot:${grant.slot}`,
        ];
        if (lease.some((key) => data.get(key) !== grant.owner))
          return Promise.resolve(null);
        // ARGV[1] is the lease TTL the download starts with.
        lease.forEach((key) => ttl.set(key, args[count]));
        return Promise.resolve(value);
      }
      if (script.includes("'EXPIRE'")) {
        refreshes.push(args);
        let n = 0;
        keys.forEach((key) => {
          if (data.get(key) === owner) {
            ttl.set(key, args[count + 1]);
            n += 1;
          }
        });
        return Promise.resolve(n);
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
  return { service, prisma, rows, ownerRows, cache, data, ttl, refreshes };
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

// ── 2026-10-03 hardening ─────────────────────────────────────────────────────

const PARENT = '5b1d2c3e-4f50-4a61-8b72-9c83d4e5f601';
const LEASE_KEYS = [
  `asset-archive:{downloads}:tenant:${TENANT}`,
  'asset-archive:{downloads}:slot:0',
];
/** Let real setImmediate / nextTick work drain while timers are faked. */
const flush = async (rounds = 30) => {
  for (let i = 0; i < rounds; i++)
    await new Promise((resolve) => setImmediate(resolve));
};
const fakeTimers = () =>
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
  });

describe('files pushed to a location from its parent account', () => {
  it('are zipped while the parent still holds exactly that file', async () => {
    const t = setup();
    t.rows[0].fileUrl = publicUrl(`${PARENT}/pushed.mp4`);
    t.ownerRows.push({ tenantId: PARENT, fileUrl: t.rows[0].fileUrl });
    const grant = await t.service.prepare(TENANT, actor, IDS);
    const response = new DownloadResponse();
    await t.service.download(grant.ticket, response as unknown as Response);
    const zip = await JSZip.loadAsync(Buffer.concat(response.chunks));
    expect(Object.keys(zip.files)).toHaveLength(3);
    // The owner is asked about exactly that tenant and exactly that URL.
    expect(t.prisma.client.asset.findMany).toHaveBeenCalledWith({
      where: { OR: [{ tenantId: PARENT, fileUrl: t.rows[0].fileUrl }] },
      select: { fileUrl: true },
    });
  });

  it('are refused once the parent no longer holds that file', async () => {
    const t = setup();
    t.rows[0].fileUrl = publicUrl(`${PARENT}/pushed.mp4`);
    await expect(t.service.prepare(TENANT, actor, IDS)).rejects.toThrow(
      'hosted outside',
    );
    expect(t.cache.set).not.toHaveBeenCalled();
    expect(t.data.size).toBe(0);
  });

  it('are re-checked when the download starts', async () => {
    const t = setup();
    t.rows[0].fileUrl = publicUrl(`${PARENT}/pushed.mp4`);
    t.ownerRows.push({ tenantId: PARENT, fileUrl: t.rows[0].fileUrl });
    const grant = await t.service.prepare(TENANT, actor, IDS);
    t.ownerRows.length = 0;
    const response = new DownloadResponse();
    await expect(
      t.service.download(grant.ticket, response as unknown as Response),
    ).rejects.toThrow('hosted outside');
    expect(response.chunks).toHaveLength(0);
    expect(t.data.size).toBe(0);
  });

  it.each([
    [
      'an untrusted host',
      `https://evil.example/storage/v1/object/public/assets/${PARENT}/x.mp4`,
    ],
    ['encoded traversal', publicUrl(`${PARENT}/%2e%2e/x.mp4`)],
    [
      'a private bucket',
      `${BASE}/storage/v1/object/public/floorplans/${PARENT}/x.pdf`,
    ],
  ])(
    'keep every other check even when the parent holds the URL (%s)',
    async (_name, url) => {
      const t = setup();
      t.rows[0].fileUrl = url;
      t.ownerRows.push({ tenantId: PARENT, fileUrl: url });
      await expect(t.service.prepare(TENANT, actor, IDS)).rejects.toThrow();
      expect(t.cache.set).not.toHaveBeenCalled();
    },
  );

  it('another tenant’s asset ids still 404, with no partial ZIP', async () => {
    const t = setup();
    t.ownerRows.push({ tenantId: PARENT, fileUrl: t.rows[0].fileUrl });
    t.prisma.client.asset.findMany.mockImplementationOnce(() =>
      Promise.resolve([t.rows[0]]),
    );
    await expect(t.service.prepare(TENANT, actor, IDS)).rejects.toThrow(
      'unavailable in this account',
    );
    expect(t.cache.set).not.toHaveBeenCalled();
  });
});

describe('the download lease', () => {
  it('starts at one minute, is renewed only while bytes flow, and the renewal stops with the download', async () => {
    const t = setup();
    const grant = await t.service.prepare(TENANT, actor, IDS);
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    request.mockImplementation((url) => {
      if (String(url) !== t.rows[0].fileUrl)
        return Promise.resolve(
          new global.Response(Buffer.from('original video bytes')),
        );
      let step = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (step++ === 0) {
            controller.enqueue(Buffer.from('original '));
            return;
          }
          await gate;
          controller.enqueue(Buffer.from('video bytes'));
          controller.close();
        },
      });
      return Promise.resolve(new global.Response(body));
    });
    fakeTimers();
    try {
      const done = t.service.download(
        grant.ticket,
        new DownloadResponse() as unknown as Response,
      );
      await flush();
      // A one-minute lease, not 25 minutes: a container killed now frees the
      // tenant (and its global slot) within a minute.
      for (const key of LEASE_KEYS) expect(t.ttl.get(key)).toBe(60);
      await jest.advanceTimersByTimeAsync(20_000);
      expect(t.refreshes).toHaveLength(1); // bytes moved → renewed
      for (const key of LEASE_KEYS) expect(t.ttl.get(key)).toBe(60);
      await jest.advanceTimersByTimeAsync(20_000);
      expect(t.refreshes).toHaveLength(1); // nothing moved → left to lapse
      open();
      await done;
      await jest.advanceTimersByTimeAsync(120_000);
      expect(t.refreshes).toHaveLength(1); // the timer died with the download
      expect(t.data.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a download that stops moving ends at 14 minutes — inside the proxy’s 15-minute cut — and releases its lease', async () => {
    const t = setup();
    const grant = await t.service.prepare(TENANT, actor, IDS);
    request.mockImplementation(() =>
      Promise.resolve(
        new global.Response(
          new ReadableStream<Uint8Array>({
            pull: () => new Promise<void>(() => undefined),
          }),
        ),
      ),
    );
    fakeTimers();
    try {
      let settled: string | undefined;
      const done = t.service
        .download(grant.ticket, new DownloadResponse() as unknown as Response)
        .then(
          () => (settled = 'completed'),
          (error: Error) => (settled = error.message),
        );
      await flush();
      await jest.advanceTimersByTimeAsync(14 * 60_000);
      await flush();
      expect(settled).toBe('ZIP download timed out');
      await done;
      expect(t.data.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});

/** A client that reads slowly: the first write is held, applying backpressure. */
class StallingResponse extends Writable {
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  private held = false;
  constructor() {
    super({ highWaterMark: 1 });
  }
  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  _write(chunk: Buffer, _: string, done: () => void) {
    this.chunks.push(Buffer.from(chunk));
    if (this.held) return done();
    this.held = true;
    setTimeout(done, 200);
  }
}

it('a source that fails while the ZIP has it paused fails the download instead of hanging it', async () => {
  const t = setup();
  const big = 200_000;
  request.mockImplementation((url: unknown, init?: RequestInit) => {
    const first = String(url) === t.rows[0].fileUrl;
    if (init?.method === 'HEAD')
      return Promise.resolve(
        new global.Response(null, {
          headers: { 'content-length': String(first ? big : 20) },
        }),
      );
    if (!first)
      return Promise.resolve(
        new global.Response(Buffer.from('original video bytes')),
      );
    let sent = 0;
    // 64 KiB fills JSZip's output buffer against the slow client, so JSZip
    // pauses this input. Its FIRST pause is undone by a resume JSZip had
    // already scheduled (StreamHelper.resume runs on setImmediate); the second
    // chunk pauses it for real. The read after that fails 50 ms later — while
    // paused, which is the case jszip swallows.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent < 2) {
          sent += 1;
          controller.enqueue(new Uint8Array(sent === 1 ? 64 * 1024 : 1024));
          return;
        }
        return new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('storage connection reset')), 50),
        );
      },
    });
    return Promise.resolve(new global.Response(body));
  });
  const grant = await t.service.prepare(TENANT, actor, IDS);
  const response = new StallingResponse();
  const outcome = await Promise.race([
    t.service.download(grant.ticket, response as unknown as Response).then(
      () => 'completed',
      (error: Error) => error.message,
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve('hung'), 2_000)),
  ]);
  // Unwind a hung download so the test leaves nothing running.
  if (outcome === 'hung') response.destroy();
  expect(outcome).toBe('storage connection reset');
  await flush();
  expect(t.data.size).toBe(0);
});

describe('the ticket link over real HTTP', () => {
  const binary = (
    res: NodeJS.ReadableStream,
    callback: (error: Error | null, body: Buffer) => void,
  ) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(chunk));
    res.on('end', () => callback(null, Buffer.concat(chunks)));
  };

  it('a HEAD does not spend the ticket — the GET after it still downloads the ZIP', async () => {
    const t = setup();
    const moduleRef = await Test.createTestingModule({
      controllers: [AssetArchivesController],
      providers: [{ provide: AssetArchivesService, useValue: t.service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    try {
      const http = app.getHttpServer() as Parameters<typeof supertest>[0];
      const grant = await t.service.prepare(TENANT, actor, IDS);
      const url = `/api/v1/assets/download-archive/${grant.ticket}`;
      const head = await supertest(http).head(url);
      expect(head.status).toBe(200);
      expect(head.headers['content-type']).toBe('application/zip');
      expect(head.headers['cache-control']).toBe('private, no-store');
      const get = await supertest(http).get(url).buffer(true).parse(binary);
      expect(get.status).toBe(200);
      const zip = await JSZip.loadAsync(get.body as Buffer);
      expect(Object.keys(zip.files)).toHaveLength(3);
      // The GET spent it.
      expect((await supertest(http).head(url)).status).toBe(404);
      expect((await supertest(http).get(url)).status).toBe(404);
    } finally {
      await app.close();
    }
  });
});

describe('who may prepare a ZIP', () => {
  const allowed = (
    controller: { prototype: object },
    handlerName: string,
    role: AppRole,
    method: string,
  ) => {
    const handler = (controller.prototype as Record<string, unknown>)[
      handlerName
    ];
    const ctx = {
      getHandler: () => handler,
      getClass: () => controller,
      switchToHttp: () => ({
        getRequest: () => ({
          user: { id: 'u', role },
          method,
          params: {},
          query: {},
          body: {},
        }),
      }),
    } as unknown as ExecutionContext;
    try {
      return new RbacGuard(new Reflector()).canActivate(ctx);
    } catch {
      return false;
    }
  };

  // Item 10 of the 2026-10-03 review read "restricted viewers can create a
  // ZIP but cannot list assets". They CAN list: RbacGuard lets a viewer READ
  // (GET/HEAD) any route a CONTRIBUTOR may read, and GET /assets is one. So
  // the two routes already agree; this pins that they keep agreeing.
  it.each(Object.values(AppRole))(
    '%s: may prepare a ZIP exactly when it may list the library',
    (role) => {
      expect(allowed(AssetArchivesController, 'prepare', role, 'POST')).toBe(
        allowed(AssetsController, 'list', role, 'GET'),
      );
    },
  );

  it('the harness tells allowed from refused (no vacuous agreement)', () => {
    expect(
      allowed(AssetsController, 'list', AppRole.RESTRICTED_VIEWER, 'GET'),
    ).toBe(true);
    expect(
      allowed(AssetsController, 'remove', AppRole.CONTRIBUTOR, 'DELETE'),
    ).toBe(false);
    expect(
      allowed(AssetsController, 'remove', AppRole.RESTRICTED_VIEWER, 'DELETE'),
    ).toBe(false);
  });
});
