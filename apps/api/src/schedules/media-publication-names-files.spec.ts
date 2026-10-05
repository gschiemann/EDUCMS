/**
 * Publishing NAMES the files it cannot prepare (2026-10-05).
 *
 * The media beta test (img-findings ANSWER 1): two non-pictures accepted as
 * pictures made every publish to a 1080p screen fail with "The 1080p image copy
 * could not be prepared … please retry publishing" — no file named, retry never
 * helps, and the 86 good pictures after the first failure were never looked at.
 * For video, the sweep stamped "A playback copy could not be prepared" — again
 * naming nothing. Pinned here, with the REAL MediaPublicationService, the REAL
 * upload optimizer and real sharp bytes:
 *   1. prepare() examines EVERY picture and refuses once, naming each bad file
 *      by the name the operator sees, with the asset ids in `files`;
 *   2. it refuses before anything is queued and the publish creates NO schedule
 *      row (driven through the real SchedulesController.create);
 *   3. a "not just now" failure (storage) is a retryable 503 that says so;
 *   4. the sweep names every failed video and records the files, and GET
 *      /schedules hands them back as `pendingMediaFiles`.
 */
import 'reflect-metadata';
import sharp from 'sharp';
import { AppRole } from '@cms/database';
import { HttpException } from '@nestjs/common';
import { MediaOptimizationService } from '../storage/media-optimization.service';
import {
  assetDisplayName,
  failedPublicationFiles,
  MediaPublicationService,
  playbackCopyFailureMessage,
  quoteFileNames,
  SCHEDULE_MEDIA_COPY_FAILED,
} from './media-publication.service';
import { SchedulesController } from './schedules.controller';

const TENANT = 'tenant-1';
const url = (p: string) =>
  `https://proj.supabase.co/storage/v1/object/public/assets/${p}`;

const picture = (id: string, name: string, w = 3840, h = 2160) => ({
  id,
  tenantId: TENANT,
  originalName: name,
  mimeType: name.endsWith('.png') ? 'image/png' : 'image/jpeg',
  fileUrl: url(`${TENANT}/${id}${name.endsWith('.png') ? '.png' : '.jpg'}`),
  fileSize: 1000,
  // What a non-picture accepted before 2026-10-05 carries: no dimensions.
  processingMeta: w
    ? { processedDimensions: { w, h } }
    : { skippedReason: 'no-gain-or-passthrough' },
});
const video = (id: string, name: string) => ({
  id,
  tenantId: TENANT,
  originalName: name,
  mimeType: 'video/mp4',
  fileUrl: url(`${TENANT}/${id}.mp4`),
  fileSize: 9_000_000,
  processingMeta: { processedDimensions: { w: 3840, h: 2160 } },
});

async function jpeg4k(): Promise<Buffer> {
  return sharp({
    create: { width: 3840, height: 2160, channels: 3, background: '#225588' },
  })
    .jpeg()
    .toBuffer();
}

function harness(items: any[], bytes: Record<string, Buffer | null>) {
  const auditRows: any[] = [];
  const tx = {
    asset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditLog: {
      create: jest.fn(async ({ data }: any) => auditRows.push(data)),
    },
  };
  const prisma: any = {
    client: {
      playlist: {
        findFirst: jest.fn(async ({ where }: any) =>
          where.id === 'pl-1' && where.tenantId === TENANT
            ? { id: 'pl-1', items: items.map((asset) => ({ asset })) }
            : null,
        ),
      },
      screen: {
        findMany: jest.fn().mockResolvedValue([{ resolution: '1920x1080' }]),
        findFirst: jest.fn(async () => ({ id: 'lcd-1' })),
      },
      screenGroup: { findFirst: jest.fn().mockResolvedValue(null) },
      asset: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      schedule: {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        create: jest.fn(),
      },
      videoTranscodeJob: { findMany: jest.fn().mockResolvedValue([]) },
      tenant: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ requireContentApproval: false }),
      },
      auditLog: {
        create: jest.fn(async ({ data }: any) => auditRows.push(data)),
        findMany: jest.fn(async ({ where }: any) =>
          auditRows
            .filter(
              (r) =>
                r.tenantId === where.tenantId &&
                r.action === where.action &&
                where.targetId.in.includes(r.targetId),
            )
            .reverse()
            .map((r) => ({ targetId: r.targetId, details: r.details })),
        ),
      },
      $transaction: jest.fn(async (fn: (c: typeof tx) => Promise<unknown>) =>
        fn(tx),
      ),
    },
  };
  const storage: any = {
    extractPath: (u: string) => u.split('/public/assets/')[1] ?? null,
    publicUrlForPath: (p: string) => url(p),
    download: jest.fn(async (p: string) => bytes[p] ?? null),
    upload: jest.fn(async (p: string) => url(p)),
    delete: jest.fn(),
  };
  const jobs = { enqueueForRendition: jest.fn().mockResolvedValue(true) };
  const service = new MediaPublicationService(
    prisma,
    jobs as any,
    { publish: jest.fn() } as any,
    { signMessage: jest.fn().mockReturnValue('signed') } as any,
    storage,
    new MediaOptimizationService(),
  );
  (service as any).lastLegacyBackfillAt = Date.now();
  return { service, prisma, storage, jobs, auditRows, tx };
}

async function refusal(p: Promise<unknown>): Promise<HttpException> {
  try {
    await p;
  } catch (e) {
    if (e instanceof HttpException) return e;
    throw e;
  }
  throw new Error('expected a refusal');
}

describe('naming the files', () => {
  it("assetDisplayName: the upload name, else the URL's last part, else the id", () => {
    expect(
      assetDisplayName({
        id: 'a',
        originalName: '  Fall   promo.jpg ',
        fileUrl: url('t/x.jpg'),
      }),
    ).toBe('Fall promo.jpg');
    expect(
      assetDisplayName({
        id: 'a',
        originalName: null,
        fileUrl: 'https://cdn.example/media/IMG%201.jpg?x=1',
      }),
    ).toBe('IMG 1.jpg');
    expect(
      assetDisplayName({ id: 'a-id', originalName: '', fileUrl: 'not a url' }),
    ).toBe('a-id');
  });

  it('quoteFileNames: five names at most, each cut at 80 characters', () => {
    expect(quoteFileNames(['a.jpg'])).toBe('“a.jpg”');
    expect(quoteFileNames(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe(
      '“a”, “b”, “c”, “d”, “e” and 2 more',
    );
    const long = quoteFileNames(['x'.repeat(200)]);
    expect(long.length).toBeLessThan(90);
    expect(long.endsWith('…”')).toBe(true);
  });

  it('the words say what to do', () => {
    expect(playbackCopyFailureMessage(['a.jpg'], 'unusable')).toBe(
      "“a.jpg” can't be prepared for 1080p screens. Remove or replace it, then publish again. The previous content stays on screen.",
    );
    expect(playbackCopyFailureMessage(['a.jpg', 'b.png'], 'unusable')).toMatch(
      /^These files can't be prepared for 1080p screens: “a\.jpg”, “b\.png”\. Remove or replace them/,
    );
    expect(playbackCopyFailureMessage(['a.jpg'], 'retry')).toMatch(
      /couldn't be made just now.*publish again in a minute/,
    );
  });

  it('failedPublicationFiles reads an audit row back, and nothing else', () => {
    expect(
      failedPublicationFiles(
        JSON.stringify({
          files: [{ assetId: 'a', name: 'x.mp4', job: {} }, { nope: 1 }],
        }),
      ),
    ).toEqual([{ assetId: 'a', name: 'x.mp4' }]);
    expect(failedPublicationFiles('{"files":[]}')).toBeNull();
    expect(failedPublicationFiles('garbage')).toBeNull();
    expect(failedPublicationFiles(null)).toBeNull();
  });
});

describe('prepare() — every picture examined, every bad one named', () => {
  it('two non-pictures in a playlist of four: ONE refusal naming both, ids carried, the good 4K picture still prepared, nothing queued', async () => {
    const good = picture('good', 'Fall promo.jpg');
    const textJpg = picture('txt', 'menu-board.jpg', 0);
    const mp4Png = picture('mp4', 'not-really-a.png', 0);
    const clip = video('clip', 'Gym loop.mp4');
    const h = harness([textJpg, good, mp4Png, clip], {
      [`${TENANT}/good.jpg`]: await jpeg4k(),
      [`${TENANT}/txt.jpg`]: Buffer.from('this is a text file\n'),
      [`${TENANT}/mp4.png`]: Buffer.concat([
        Buffer.from([0, 0, 0, 0x20]),
        Buffer.from('ftypisom'),
        Buffer.alloc(64),
      ]),
    });
    const err = await refusal(h.service.prepare(TENANT, 'pl-1', 'lcd-1'));
    expect(err.getStatus()).toBe(422);
    const body = err.getResponse() as any;
    expect(body.code).toBe('IMAGE_PLAYBACK_COPY_FAILED');
    expect(body.message).toBe(
      "These files can't be prepared for 1080p screens: “menu-board.jpg”, “not-really-a.png”. Remove or replace them, then publish again. The previous content stays on screen.",
    );
    expect(body.files).toEqual([
      { assetId: 'txt', name: 'menu-board.jpg' },
      { assetId: 'mp4', name: 'not-really-a.png' },
    ]);
    expect(body.retryable).toBe(false);
    // The good picture AFTER the first bad one was still examined and got its copy.
    expect(h.storage.upload).toHaveBeenCalledTimes(1);
    expect(h.storage.upload.mock.calls[0][0]).toMatch(
      new RegExp(`^${TENANT}/optimized/renditions/`),
    );
    // Refused before anything was queued.
    expect(h.jobs.enqueueForRendition).not.toHaveBeenCalled();
  });

  it('a picture whose bytes could not be read just now: a retryable 503 that names it and says to publish again', async () => {
    const h = harness([picture('good', 'Fall promo.jpg')], {});
    const err = await refusal(h.service.prepare(TENANT, 'pl-1', 'lcd-1'));
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toEqual(
      expect.objectContaining({
        code: 'IMAGE_PLAYBACK_COPY_FAILED',
        retryable: true,
        files: [{ assetId: 'good', name: 'Fall promo.jpg' }],
        message: expect.stringMatching(
          /^The 1080p copy of “Fall promo\.jpg” couldn't be made just now\./,
        ),
      }),
    );
  });

  it('a bad file and a storage blip together: the bad file is what the operator must act on, so it is the one named (422)', async () => {
    const h = harness(
      [picture('blip', 'blip.jpg'), picture('txt', 'menu.jpg', 0)],
      {
        [`${TENANT}/txt.jpg`]: Buffer.from('text\n'),
      },
    );
    const err = await refusal(h.service.prepare(TENANT, 'pl-1', 'lcd-1'));
    expect(err.getStatus()).toBe(422);
    expect((err.getResponse() as any).files).toEqual([
      { assetId: 'txt', name: 'menu.jpg' },
    ]);
  });

  it('videos that cannot be queued are all named too (retryable)', async () => {
    const h = harness(
      [video('v1', 'Gym loop.mp4'), video('v2', 'Lobby.mp4')],
      {},
    );
    h.jobs.enqueueForRendition.mockResolvedValue(false);
    const err = await refusal(h.service.prepare(TENANT, 'pl-1', 'lcd-1'));
    expect(err.getStatus()).toBe(503);
    expect(err.getResponse()).toEqual(
      expect.objectContaining({
        code: 'VIDEO_PLAYBACK_COPY_QUEUE_FAILED',
        files: [
          { assetId: 'v1', name: 'Gym loop.mp4' },
          { assetId: 'v2', name: 'Lobby.mp4' },
        ],
      }),
    );
    expect(h.jobs.enqueueForRendition).toHaveBeenCalledTimes(2);
  });
});

describe('a refused publish leaves NO schedule row (the real SchedulesController.create)', () => {
  it('POST /schedules answers the named refusal and writes nothing', async () => {
    const h = harness([picture('txt', 'menu-board.jpg', 0)], {
      [`${TENANT}/txt.jpg`]: Buffer.from('text\n'),
    });
    const controller = new SchedulesController(
      h.prisma,
      { publish: jest.fn() } as any,
      { signMessage: jest.fn() } as any,
      { notify: jest.fn() } as any,
      h.service,
    );
    const admin = {
      user: {
        id: 'u1',
        userId: 'u1',
        role: AppRole.SCHOOL_ADMIN,
        tenantId: TENANT,
      },
    };
    const err = await refusal(
      controller.create(
        admin as any,
        {
          playlistId: 'pl-1',
          screenId: 'lcd-1',
          startTime: new Date().toISOString(),
        } as any,
      ),
    );
    expect((err.getResponse() as any).message).toContain('“menu-board.jpg”');
    expect(h.prisma.client.schedule.create).not.toHaveBeenCalled();
    expect(h.prisma.client.schedule.deleteMany).not.toHaveBeenCalled();
    expect(h.prisma.client.schedule.updateMany).not.toHaveBeenCalled();
  });
});

describe('the sweep names every failed video, and GET /schedules hands the files back', () => {
  it('stamps the held rule with the names, records the files, and the list attaches them as pendingMediaFiles', async () => {
    const v1 = video('v1', 'Gym loop.mp4');
    const v2 = video('v2', 'Lobby welcome.mp4');
    const v3 = video('v3', 'Still encoding.mp4');
    const h = harness([], {});
    const held = {
      id: 'rule-1',
      tenantId: TENANT,
      playlistId: 'pl-1',
      screenId: 'lcd-1',
      screenGroupId: null,
      pendingMedia: true,
      isActive: false,
      pendingMediaError: null,
      // v1 twice: a playlist may repeat a file; it is named once.
      playlist: {
        items: [{ asset: v1 }, { asset: v2 }, { asset: v1 }, { asset: v3 }],
      },
      screen: { resolution: '1920 x 1080' },
      screenGroup: null,
    };
    h.prisma.client.schedule.findMany.mockResolvedValueOnce([held]);
    h.prisma.client.videoTranscodeJob.findMany.mockResolvedValueOnce([
      { assetId: 'v1', status: 'failed', reason: 'ffmpeg-failed' },
      { assetId: 'v2', status: 'skipped', reason: 'not-smaller' },
      { assetId: 'v3', status: 'running', reason: null },
    ]);
    await h.service.sweep();
    const stamp = h.prisma.client.schedule.updateMany.mock.calls[0][0];
    expect(stamp.where).toEqual({
      id: 'rule-1',
      tenantId: TENANT,
      pendingMedia: true,
      pendingMediaError: null,
    });
    expect(stamp.data.pendingMediaError).toBe(
      "These files can't be prepared for 1080p screens: “Gym loop.mp4”, “Lobby welcome.mp4”. Remove or replace them, then publish again. The previous content stays on screen.",
    );
    expect(h.auditRows).toHaveLength(1);
    expect(h.auditRows[0]).toEqual(
      expect.objectContaining({
        tenantId: TENANT,
        action: SCHEDULE_MEDIA_COPY_FAILED,
        targetType: 'Schedule',
        targetId: 'rule-1',
      }),
    );
    expect(JSON.parse(h.auditRows[0].details).files).toEqual([
      {
        assetId: 'v1',
        name: 'Gym loop.mp4',
        job: { status: 'failed', reason: 'ffmpeg-failed' },
      },
      {
        assetId: 'v2',
        name: 'Lobby welcome.mp4',
        job: { status: 'skipped', reason: 'not-smaller' },
      },
    ]);
    // No activation, no SYNC: the previous content stays on screen.
    expect(h.prisma.client.$transaction).not.toHaveBeenCalled();

    // GET /schedules: the stamped rule carries its files, machine-readable.
    const controller = new SchedulesController(
      h.prisma,
      { publish: jest.fn() } as any,
      { signMessage: jest.fn() } as any,
      { notify: jest.fn() } as any,
      h.service,
    );
    h.prisma.client.schedule.findMany.mockResolvedValueOnce([
      {
        id: 'rule-1',
        pendingMedia: true,
        pendingMediaError: stamp.data.pendingMediaError,
      },
      { id: 'rule-ok', pendingMedia: false, pendingMediaError: null },
    ]);
    const rows: any[] = await controller.list({
      user: { tenantId: TENANT },
    } as any);
    expect(rows[0].pendingMediaFiles).toEqual([
      { assetId: 'v1', name: 'Gym loop.mp4' },
      { assetId: 'v2', name: 'Lobby welcome.mp4' },
    ]);
    expect(rows[1].pendingMediaFiles).toBeUndefined();
    expect(h.prisma.client.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: TENANT,
          action: SCHEDULE_MEDIA_COPY_FAILED,
          targetId: { in: ['rule-1'] },
        },
      }),
    );
  });

  it('a stamp that did not land (the rule changed meanwhile) records nothing', async () => {
    const h = harness([], {});
    h.prisma.client.schedule.findMany.mockResolvedValueOnce([
      {
        id: 'rule-1',
        tenantId: TENANT,
        playlistId: 'pl-1',
        screenId: 'lcd-1',
        screenGroupId: null,
        pendingMediaError: null,
        playlist: { items: [{ asset: video('v1', 'a.mp4') }] },
        screen: { resolution: '1920x1080' },
        screenGroup: null,
      },
    ]);
    h.prisma.client.videoTranscodeJob.findMany.mockResolvedValueOnce([
      { assetId: 'v1', status: 'failed', reason: 'x' },
    ]);
    h.prisma.client.schedule.updateMany.mockResolvedValueOnce({ count: 0 });
    await h.service.sweep();
    expect(h.auditRows).toHaveLength(0);
  });

  it('a list with no failed rule never reads the audit log', async () => {
    const h = harness([], {});
    const controller = new SchedulesController(
      h.prisma,
      { publish: jest.fn() } as any,
      { signMessage: jest.fn() } as any,
      { notify: jest.fn() } as any,
      h.service,
    );
    h.prisma.client.schedule.findMany.mockResolvedValueOnce([
      { id: 'r', pendingMedia: true, pendingMediaError: null },
    ]);
    await controller.list({ user: { tenantId: TENANT } } as any);
    expect(h.prisma.client.auditLog.findMany).not.toHaveBeenCalled();
  });
});
