import { publicationOptimizationNotice } from '../publish-media-notice';

describe('publish-time optimization notice', () => {
  const video = { mimeType: 'video/mp4', processingMeta: { processedDimensions: { w: 3840, h: 2160 } } };
  const image = { mimeType: 'image/jpeg', processingMeta: { processedDimensions: { w: 3840, h: 2160 } } };

  it('tells the operator that 4K video and photos will publish after 1080p preparation', () => {
    expect(publicationOptimizationNotice([video, image], [{ resolution: '1920 x 1080' }]))
      .toContain('1 video and 1 image');
    expect(publicationOptimizationNotice([video, image], [{ resolution: '1920 x 1080' }]))
      .toContain('prepare it automatically before playback');
  });

  it('leaves a 4K-only publish without a downgrade notice', () => {
    expect(publicationOptimizationNotice([video, image], [{ resolution: '3840 x 2160' }])).toBeNull();
  });

  it('does not promise preparation again when a 1080p copy is already ready', () => {
    const ready = { ...video, processingMeta: { ...video.processingMeta, renditions: {
      '1080p': { url: 'https://example.com/1080.mp4', sha256: 'a'.repeat(64), size: 1000 },
    } } };
    expect(publicationOptimizationNotice([ready], [{ resolution: '1920 x 1080' }])).toBeNull();
  });
});
