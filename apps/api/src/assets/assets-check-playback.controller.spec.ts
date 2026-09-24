/**
 * assets-check-playback.controller.spec.ts — `POST /assets/:id/check-playback`.
 *
 * The on-demand half of the encode grade (2026-09-24): a video from before
 * the upload probe existed has no facts, and the operator looking at it gets
 * the same probe + poster pass with one click instead of waiting for a
 * backfill. Pins: tenant scoping, videos only, library files only (never a
 * linked URL), and that the answer is the FRESH row.
 */
import { HttpException } from '@nestjs/common';
import { AssetsController } from './assets.controller';

const PREFIX = 'https://proj.supabase.co/storage/v1/object/public/assets/';

function makeController(rows: any[]) {
  const findFirst = jest.fn((args: any) => {
    const hit = rows.find(
      (r) => r.id === args?.where?.id && r.tenantId === args?.where?.tenantId,
    );
    return Promise.resolve(hit ? { ...hit } : null);
  });
  const prisma = { client: { asset: { findFirst } } } as any;
  const storage = {
    extractPath: (u: string) =>
      u.startsWith(PREFIX) ? u.slice(PREFIX.length) : null,
  } as any;
  const videoPoster = {
    processVideo: jest.fn((args: any) => {
      // The real service persists; here the row simply "gains" its facts.
      const row = rows.find((r) => r.id === args.assetId);
      if (row)
        row.processingMeta = {
          originalDimensions: { w: 1920, h: 1080 },
          probe: { codec: 'h264' },
        };
      return Promise.resolve({
        probed: true,
        posterUrl: `${PREFIX}t1/posters/x.jpg`,
      });
    }),
  } as any;
  const controller = new AssetsController(
    prisma,
    storage,
    {} as any,
    {} as any,
    {} as any,
    videoPoster,
  );
  return { controller, videoPoster, findFirst };
}

const req = { user: { id: 'u1', tenantId: 't1' } };

describe('POST /assets/:id/check-playback', () => {
  it('404s for an asset outside the caller tenant', async () => {
    const { controller, videoPoster } = makeController([
      {
        id: 'a1',
        tenantId: 'OTHER',
        mimeType: 'video/mp4',
        fileUrl: `${PREFIX}OTHER/v.mp4`,
        originalName: 'v.mp4',
      },
    ]);
    await expect(controller.checkPlayback(req, 'a1')).rejects.toMatchObject({
      status: 404,
    });
    expect(videoPoster.processVideo).not.toHaveBeenCalled();
  });

  it('400s for a non-video', async () => {
    const { controller, videoPoster } = makeController([
      {
        id: 'a1',
        tenantId: 't1',
        mimeType: 'image/png',
        fileUrl: `${PREFIX}t1/p.png`,
        originalName: 'p.png',
      },
    ]);
    const err = await controller.checkPlayback(req, 'a1').catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect((err as HttpException).getResponse()).toMatchObject({
      code: 'ASSET_NOT_VIDEO',
    });
    expect(videoPoster.processVideo).not.toHaveBeenCalled();
  });

  it('400s for a linked URL — we never point ffprobe at bytes we do not own', async () => {
    const { controller, videoPoster } = makeController([
      {
        id: 'a1',
        tenantId: 't1',
        mimeType: 'video/mp4',
        fileUrl: 'https://cdn.example.com/clip.mp4',
        originalName: 'clip.mp4',
      },
    ]);
    const err = await controller.checkPlayback(req, 'a1').catch((e) => e);
    expect((err as HttpException).getResponse()).toMatchObject({
      code: 'ASSET_EXTERNAL_URL',
    });
    expect(videoPoster.processVideo).not.toHaveBeenCalled();
  });

  it('runs the probe + poster pass on the stored file and returns the fresh row', async () => {
    const { controller, videoPoster, findFirst } = makeController([
      {
        id: 'a1',
        tenantId: 't1',
        mimeType: 'video/mp4',
        fileUrl: `${PREFIX}t1/uploads/v.mp4`,
        originalName: 'Pro Series.mp4',
        processingMeta: null,
      },
    ]);
    const out = await controller.checkPlayback(req, 'a1');
    expect(videoPoster.processVideo).toHaveBeenCalledWith({
      assetId: 'a1',
      tenantId: 't1',
      mimeType: 'video/mp4',
      storagePath: 't1/uploads/v.mp4',
      ext: '.mp4',
    });
    expect(out.probed).toBe(true);
    expect(out.asset.processingMeta).toMatchObject({
      probe: { codec: 'h264' },
    });
    // Read back AFTER the pass, tenant-scoped, with the list's relations.
    const last = findFirst.mock.calls[findFirst.mock.calls.length - 1][0];
    expect(last.where).toEqual({ id: 'a1', tenantId: 't1' });
    expect(last.include).toBeDefined();
  });
});
