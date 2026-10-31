import { demotionExpiryCutoff, loadDemotedSources } from './playback-demotions';
import { selectVideoFile } from './video-rendition';

const NOW = new Date('2026-10-31T12:00:00.000Z');
const HASH = 'a'.repeat(64);
const COPY_HASH = 'b'.repeat(64);

const asset = {
  fileUrl: 'https://example.supabase.co/o.mp4',
  fileHash: HASH,
  fileSize: 500,
  mimeType: 'video/mp4',
  processingMeta: {
    renditions: {
      '1080p': { url: 'https://example.supabase.co/c.mp4', sha256: COPY_HASH, size: 100 },
    },
  },
};

describe('demotion expiry', () => {
  it('defaults to 72 hours, 0 never expires, junk falls back to the default', () => {
    expect(demotionExpiryCutoff(NOW, {})!.getTime()).toBe(NOW.getTime() - 72 * 3_600_000);
    expect(demotionExpiryCutoff(NOW, { VIDEO_DEMOTION_TTL_HOURS: '0' })).toBeNull();
    expect(demotionExpiryCutoff(NOW, { VIDEO_DEMOTION_TTL_HOURS: '24' })!.getTime()).toBe(
      NOW.getTime() - 24 * 3_600_000,
    );
    expect(demotionExpiryCutoff(NOW, { VIDEO_DEMOTION_TTL_HOURS: 'abc' })!.getTime()).toBe(
      NOW.getTime() - 72 * 3_600_000,
    );
  });

  it('the manifest read only asks for demotions newer than the cutoff', async () => {
    const findMany = jest.fn(async () => [{ sourceSha256: HASH }]);
    const set = await loadDemotedSources({ screenPlaybackDemotion: { findMany } }, 's', 't', NOW, {});
    expect(set.has(HASH)).toBe(true);
    const where = (findMany.mock.calls[0] as any[])[0].where;
    expect(where.clearedAt).toBeNull();
    expect(where.createdAt.gt.getTime()).toBe(NOW.getTime() - 72 * 3_600_000);
  });

  it('TTL 0 keeps the old sticky read (no createdAt filter)', async () => {
    const findMany = jest.fn(async () => []);
    await loadDemotedSources({ screenPlaybackDemotion: { findMany } }, 's', 't', NOW, {
      VIDEO_DEMOTION_TTL_HOURS: '0',
    });
    expect((findMany.mock.calls[0] as any[])[0].where.createdAt).toBeUndefined();
  });

  it('a 4K screen gets the original once the demotion is gone, the copy while it applies', () => {
    expect(selectVideoFile(asset, '3840×2160', false, false, new Set()).sha256).toBe(HASH);
    expect(selectVideoFile(asset, '3840×2160', false, false, new Set([HASH])).sha256).toBe(COPY_HASH);
    // Resolution alone never downgrades a 4K panel.
    expect(selectVideoFile(asset, '3840×2160').sha256).toBe(HASH);
    expect(selectVideoFile(asset, '2160×3840').sha256).toBe(HASH);
    expect(selectVideoFile(asset, '1920×1080').sha256).toBe(COPY_HASH);
  });
});
