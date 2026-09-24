import { publicationOptimizationNotice } from '../publish-media-notice';

describe('publish-time optimization notice', () => {
  const video = { mimeType: 'video/mp4', processingMeta: { processedDimensions: { w: 3840, h: 2160 } } };
  const image = { mimeType: 'image/jpeg', processingMeta: { processedDimensions: { w: 3840, h: 2160 } } };

  it('tells the operator that 4K video and photos will publish after 1080p preparation', () => {
    expect(publicationOptimizationNotice([video, image], [{ resolution: '1920 x 1080' }]))
      .toContain('1 video and 1 image');
    expect(publicationOptimizationNotice([video, image], [{ resolution: '1920 x 1080' }]))
      .toContain('Publishing to those screens starts when the copy is ready');
  });

  it('leaves a 4K-only publish without a downgrade notice', () => {
    expect(publicationOptimizationNotice([video, image], [{ resolution: '3840 x 2160' }])).toBeNull();
  });
});
