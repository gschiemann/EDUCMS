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
    screen: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = { client: {
    playlist: { findFirst: jest.fn().mockResolvedValue(playlist) },
    screen: { findMany: jest.fn().mockResolvedValue([{ resolution: '1920 x 1080' }]) },
    schedule: {
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    // The row that OWNS a file (fleet copies adopt its playback facts) — none by default.
    asset: { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
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

  it.each([[1182, 1330], [1330, 1182]])('publishes an already-compressed %i×%i image to the three-panel LED canvas', async (width, height) => {
    // Field failure: neither side exceeds 1920, but the short side exceeds
    // 1080. A square upload cap used to skip resizing and fail publication.
    const source = await sharp({ create: { width, height, channels: 3, background: '#225588' } })
      .png({ compressionLevel: 9, palette: true }).toBuffer();
    const fileUrl = 'https://example.com/storage/v1/object/public/assets/tenant/poster.png';
    const h = setup({ id: 'asset-poster', mimeType: 'image/png', fileUrl, fileSize: source.length,
      processingMeta: { processedDimensions: { w: width, h: height } } });
    h.storage.extractPath.mockReturnValue('tenant/poster.png');
    h.storage.download.mockResolvedValue(source);
    h.prisma.client.screen.findMany.mockResolvedValue([{ resolution: '1920×1080', canvasW: 960, canvasH: 1080 }]);
    expect(await h.service.prepare('tenant', 'playlist-1', 'poster-1')).toBe(false);
    const rendition = h.tx.asset.updateMany.mock.calls[0][0].data.processingMeta.renditions['1080p'];
    expect(Math.max(rendition.width, rendition.height)).toBeLessThanOrEqual(1920);
    expect(Math.min(rendition.width, rendition.height)).toBeLessThanOrEqual(1080);
    expect(rendition.width / rendition.height).toBeCloseTo(width / height, 2);
    const uploaded = h.storage.upload.mock.calls[0][1] as Buffer;
    const decoded = await sharp(uploaded).metadata();
    expect(decoded.width).toBe(rendition.width);
    expect(decoded.height).toBe(rendition.height);
    // Keep the original asset and the pinned canvas; only add an audited copy.
    expect(h.tx.asset.updateMany.mock.calls[0][0].data.fileUrl).toBeUndefined();
    expect(h.tx.screen.updateMany).not.toHaveBeenCalled();
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
    // 2026-10-05: the stamp NAMES the file (media-publication-names-files.spec.ts).
    expect(h.prisma.client.schedule.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { pendingMediaError: expect.stringContaining("“4k.mp4” can't be prepared for 1080p screens") },
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

  it('answers per rule: only the rules whose target needs a copy wait', async () => {
    const h = setup();
    h.prisma.client.screen.findMany.mockImplementation(async ({ where }: any) => {
      const ids = (where.OR as any[]).map((o) => o.id ?? `group:${o.screenGroupId}`);
      const res: Record<string, string> = { 'lcd-1080': '1920x1080', 'wall-4k': '3840x2160', 'group:lobby': '1920 x 1080' };
      return ids.filter((id) => res[id]).map((id) => ({ resolution: res[id] }));
    });
    const waiting = await h.service.prepareRules('tenant', 'playlist-1', [
      { id: 'r-1080', screenId: 'lcd-1080', screenGroupId: null },
      { id: 'r-4k', screenId: 'wall-4k', screenGroupId: null },
      { id: 'r-group', screenId: null, screenGroupId: 'lobby' },
      { id: 'r-unknown', screenId: 'gone', screenGroupId: null },
    ]);
    expect([...waiting].sort()).toEqual(['r-1080', 'r-group']);
    // The 4K wall plays the native file (Greg, 2026-09-26): nothing is queued for it,
    // and a rule whose target no longer exists never waits on anything.
    expect(h.jobs.enqueueForRendition).toHaveBeenCalledTimes(2);
  });

  describe('a fleet copy — a child row serving the source location\'s file', () => {
    const childVideo = { ...video, id: 'child-v', processingMeta: null,
      fileUrl: 'https://example.com/storage/v1/object/public/assets/hq/4k.mp4' };
    const ownerFacts = {
      processedDimensions: { w: 3840, h: 2160 },
      renditions: { '1080p': { url: 'https://example.com/hq-1080.mp4', sha256: 'b'.repeat(64), size: 40_000_000 } },
      remux: { previousStoragePath: 'hq/old.mp4' }, // not a playback fact: must NOT cross
    };

    it('adopts the owner\'s dimensions + 1080p copy and needs no job of its own', async () => {
      const h = setup(childVideo);
      h.storage.extractPath.mockReturnValue('hq/4k.mp4');
      h.prisma.client.asset.findFirst.mockResolvedValue({ processingMeta: ownerFacts });
      expect(await h.service.prepare('child', 'playlist-1', 'screen-1')).toBe(false);
      expect(h.prisma.client.asset.findFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: { tenantId: 'hq', fileUrl: childVideo.fileUrl },
      }));
      const write = h.prisma.client.asset.updateMany.mock.calls[0][0];
      expect(write.where).toEqual({ id: 'child-v', tenantId: 'child', fileUrl: childVideo.fileUrl });
      expect(write.data.processingMeta.renditions['1080p'].sha256).toBe('b'.repeat(64));
      expect(write.data.processingMeta.processedDimensions).toEqual({ w: 3840, h: 2160 });
      expect(write.data.processingMeta.remux).toBeUndefined();
      expect(h.jobs.enqueueForRendition).not.toHaveBeenCalled();
    });

    it('a copy of a 1080p source is never sent to the encoder once its size is known', async () => {
      const h = setup(childVideo);
      h.storage.extractPath.mockReturnValue('hq/1080.mp4');
      h.prisma.client.asset.findFirst.mockResolvedValue({ processingMeta: { processedDimensions: { w: 1920, h: 1080 } } });
      expect(await h.service.prepare('child', 'playlist-1', 'screen-1')).toBe(false);
      expect(h.jobs.enqueueForRendition).not.toHaveBeenCalled();
    });

    it('queues its own copy when the owner has none yet, and never writes back to the owner', async () => {
      const h = setup(childVideo);
      h.storage.extractPath.mockReturnValue('hq/4k.mp4');
      h.prisma.client.asset.findFirst.mockResolvedValue({ processingMeta: { processedDimensions: { w: 3840, h: 2160 } } });
      expect(await h.service.prepare('child', 'playlist-1', 'screen-1')).toBe(true);
      expect(h.jobs.enqueueForRendition).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'child', assetId: 'child-v' }));
      for (const call of h.prisma.client.asset.updateMany.mock.calls) expect(call[0].where.tenantId).toBe('child');
    });

    it('with no owner row (file not ours to share) the copy is queued as before — nothing adopted', async () => {
      const h = setup(childVideo);
      h.storage.extractPath.mockReturnValue('hq/4k.mp4');
      expect(await h.service.prepare('child', 'playlist-1', 'screen-1')).toBe(true);
      expect(h.prisma.client.asset.updateMany).not.toHaveBeenCalled();
    });

    it('prepares a 1080p IMAGE copy under the child\'s own folder from the owner\'s file', async () => {
      const fileUrl = 'https://example.com/storage/v1/object/public/assets/hq/4k.jpg';
      const image = { id: 'child-i', mimeType: 'image/jpeg', fileUrl, fileSize: 100_000,
        processingMeta: { processedDimensions: { w: 3840, h: 2160 } } };
      const h = setup(image);
      h.storage.extractPath.mockReturnValue('hq/4k.jpg');
      h.prisma.client.asset.findFirst.mockResolvedValue({ id: 'hq-i', processingMeta: image.processingMeta });
      h.storage.download.mockResolvedValue(await sharp({ create: {
        width: 3840, height: 2160, channels: 3, background: '#225588',
      } }).jpeg().toBuffer());
      expect(await h.service.prepare('child', 'playlist-1', 'screen-1')).toBe(false);
      expect(h.storage.download).toHaveBeenCalledWith('hq/4k.jpg');
      expect(h.storage.upload.mock.calls[0][0]).toMatch(/^child\/optimized\/renditions\//);
      expect(h.tx.asset.updateMany.mock.calls[0][0].where).toMatchObject({ id: 'child-i', tenantId: 'child' });
    });

    it('refuses to read a foreign file that no owner row serves', async () => {
      const fileUrl = 'https://example.com/storage/v1/object/public/assets/other/4k.jpg';
      const image = { id: 'child-i', mimeType: 'image/jpeg', fileUrl, fileSize: 100_000,
        processingMeta: { processedDimensions: { w: 3840, h: 2160 } } };
      const h = setup(image);
      h.storage.extractPath.mockReturnValue('other/4k.jpg');
      await expect(h.service.prepare('child', 'playlist-1', 'screen-1')).rejects.toMatchObject({
        response: { code: 'IMAGE_PLAYBACK_COPY_FAILED' },
      });
      expect(h.storage.download).not.toHaveBeenCalled();
    });
  });

  it('durably refreshes a legacy 1080p player still reporting the 4K source after its copy is ready', async () => {
    const ready = { ...video, processingMeta: {
      ...video.processingMeta,
      renditions: { '1080p': { url: 'https://example.com/1080.mp4', sha256: 'a'.repeat(64), size: 40_000_000 } },
    } };
    const h = setup(ready);
    h.prisma.client.schedule.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'rule-1', tenantId: 'tenant', playlistId: 'playlist-1',
        playlist: { items: [{ asset: ready }] },
        screen: { id: 'screen-1', resolution: '1920 x 1080', pendingRefreshAt: null,
          lastVideoReportAt: new Date(), lastVideoReport: { url: ready.fileUrl, width: 3840 } },
        screenGroup: null }]);
    (h.service as any).lastLegacyBackfillAt = 0;
    await h.service.sweep();
    expect(h.tx.screen.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'screen-1', tenantId: 'tenant', pendingRefreshAt: null },
    }));
    expect(h.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'AUTO_MEDIA_RENDITION_REFRESH' }),
    }));
    expect(h.signer.signMessage).toHaveBeenCalledWith('REFRESH_WEB', expect.objectContaining({
      scope: 'screen', scopeId: 'screen-1', jitterMs: 0,
    }));
    expect(h.redis.publish).toHaveBeenCalledWith('tenant:tenant', 'signed-sync');
  });
});
