import sharp from 'sharp';
import { MediaOptimizationService } from './media-optimization.service';

describe('upload and playback image bounds', () => {
  const service = new MediaOptimizationService();

  it('keeps the existing square upload cap and avoids resizing a 1330×1182 upload', async () => {
    const source = await sharp({
      create: { width: 1330, height: 1182, channels: 3, background: '#225588' },
    })
      .png({ palette: true, compressionLevel: 9 })
      .toBuffer();
    const result = await service.optimizeImageForUpload(
      source,
      'image/png',
      '.png',
      1920,
    );
    const output = await sharp(result.buffer).metadata();
    expect(output.width).toBe(1330);
    expect(output.height).toBe(1182);
  });

  it.each([6, 8])(
    'bounds an EXIF orientation %i image after rotation and strips the tag',
    async (orientation) => {
      const source = await sharp({
        create: {
          width: 1330,
          height: 1182,
          channels: 3,
          background: '#225588',
        },
      })
        .jpeg()
        .withMetadata({ orientation })
        .toBuffer();
      const result = await service.optimizeImageForUpload(
        source,
        'image/jpeg',
        '.jpg',
        1920,
        1080,
      );
      const output = await sharp(result.buffer).metadata();
      expect(result.optimized).toBe(true);
      expect(output.width).toBe(1080);
      expect(output.height).toBeGreaterThan(output.width);
      expect(output.height).toBeLessThanOrEqual(1920);
      expect(output.orientation).toBeUndefined();
    },
  );
});
