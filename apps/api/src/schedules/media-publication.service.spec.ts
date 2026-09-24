import sharp from 'sharp';
import { MediaOptimizationService } from '../storage/media-optimization.service';
import { MediaPublicationService } from './media-publication.service';

const video = {
  id: 'asset-v', mimeType: 'video/mp4', fileUrl: 'https://example.com/4k.mp4',
  fileSize: 140_000_000, processingMeta: { processedDimensions: { w: 3840, h: 2160 } },
};

function setup(asset: any = video) {
  const playlist = { id: 'playlist-1', items: [{ asset }] };
  const tx = {
    asset: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    schedule: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    screen: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = { client: {
    playlist: { findFirst: jest.fn().mockResolvedValue(playlist) },
    screen: { findMany: jest.fn().mockResolvedValue([{ resolution: '1920 x 1080' }]) },
    schedule: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    videoTranscodeJob: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
  } };
  const jobs = { enqueueForRendition: jest.fn().mockResolvedValue(true) };
  const storage = {
    extractPath: jest.fn().mockReturnValue('tenant/4k.jpg'),
    publicUrlForPath: jest.fn((p: string) => `https://example.com/storage/v1/object/public/assets/${p}`),
    download: jest.fn(), upload: jest.fn().mockResolvedValue('url'), delete: jest.fn(),
  };
  const signer = { signMessage: jest.fn().mockReturnValue('signed-sync') };
  const redis = { publish: jest.fn().mockResolvedValue(undefined) };
  const service = new MediaPublicationService(
    prisma as any, jobs as any, redis as any, signer as any,
    storage as any, new MediaOptimizationService(),
  );
  // These tests focus on pending publications; skip the 15-minute legacy scan.
  (service as any).lastLegacyBackfillAt = Date.now();
  return { service, prisma, tx, jobs, storage, signer, redis };
}

describe('media publication gate', () => {
  it('queues a 1080p video copy and leaves the publish pending', async () => {
    const h = setup();
    expect(await h.service.prepare('tenant', 'playlist-1', 'screen-1')).toBe(true);
    expect(h.jobs.enqueueForRendition).toHaveBeenCalledWith({
      tenantId: 'tenant', assetId: 'asset-v', sourceUrl: video.fileUrl, sourceBytes: video.fileSize,
    });
  });

  it('rejects a publish clearly if a required copy cannot be queued', async () => {
    const h = setup();
    h.jobs.enqueueForRendition.mockResolvedValue(false);
    await expect(h.service.prepare('tenant', 'playlist-1', 'screen-1')).rejects.toMatchObject({
      response: { code: 'VIDEO_PLAYBACK_COPY_QUEUE_FAILED' },
      status: 503,
    });
    expect(h.prisma.client.schedule.findMany).not.toHaveBeenCalled();
  });

  it('preserves 4K images and stores an audited 1080p copy before publishing', async () => {
    const fileUrl = 'https://example.com/storage/v1/object/public/assets/tenant/4k.jpg';
    const image = { id: 'asset-i', mimeType: 'image/jpeg', fileUrl, fileSize: 100_000,
      processingMeta: { processedDimensions: { w: 3840, h: 2160 } } };
    const h = setup(image);
    h.storage.download.mockResolvedValue(await sharp({ create: {
      width: 3840, height: 2160, channels: 3, background: '#225588',
    } }).jpeg().toBuffer());
    expect(await h.service.prepare('tenant', 'playlist-1', 'screen-1')).toBe(false);
    expect(h.storage.upload).toHaveBeenCalledTimes(1);
    const data = h.tx.asset.updateMany.mock.calls[0][0].data.processingMeta;
    expect(data.renditions['1080p'].width).toBe(1920);
    expect(data.renditions['1080p'].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(h.tx.auditLog.create).toHaveBeenCalled();
  });

  it('keeps the old schedule active and reports a failed encode', async () => {
    const h = setup();
    h.prisma.client.schedule.findMany.mockResolvedValueOnce([{
      id: 'rule-1', tenantId: 'tenant', pendingMediaError: null,
      playlist: { items: [{ asset: video }] }, screen: { resolution: '1920 x 1080' },
      screenGroup: null,
    }]);
    h.prisma.client.videoTranscodeJob.findMany.mockResolvedValueOnce([
      { assetId: 'asset-v', status: 'failed', reason: 'ffmpeg-failed' },
    ]);
    await h.service.sweep();
    expect(h.prisma.client.schedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { pendingMediaError: expect.stringContaining('could not be prepared') },
    }));
    expect(h.prisma.client.$transaction).not.toHaveBeenCalled();
    expect(h.redis.publish).not.toHaveBeenCalled();
  });

  it('atomically activates a ready schedule and sends the player a sync', async () => {
    const ready = { ...video, processingMeta: {
      ...video.processingMeta,
      renditions: { '1080p': { url: 'https://example.com/1080.mp4', sha256: 'a'.repeat(64), size: 40_000_000 } },
    } };
    const h = setup(ready);
    h.prisma.client.schedule.findMany.mockResolvedValueOnce([{
      id: 'rule-1', tenantId: 'tenant', playlistId: 'playlist-1',
      playlist: { items: [{ asset: ready }] }, screen: { resolution: '1920 x 1080' },
      screenGroup: null, screenId: 'screen-1', screenGroupId: null,
      mode: 'replace', daysOfWeek: null, timeStart: null, timeEnd: null, priority: 0,
    }]);
    await h.service.sweep();
    expect(h.tx.schedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { pendingMedia: false, pendingMediaError: null },
    }));
    expect(h.tx.schedule.update).toHaveBeenCalledWith(expect.objectContaining({ data: { isActive: true } }));
    expect(h.tx.auditLog.create).toHaveBeenCalled();
    expect(h.redis.publish).toHaveBeenCalledWith('tenant:tenant', 'signed-sync');
  });
});
