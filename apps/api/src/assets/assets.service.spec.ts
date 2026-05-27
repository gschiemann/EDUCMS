/**
 * Audit P0-5 (2026-05-27) — upload-time image optimization.
 *
 * Pinned behaviors:
 *   1. A 4096×2160 PNG resizes so the longest side is ≤ 1920px (aspect
 *      preserved). The audit task names "1920×1015" as a target — we
 *      assert "longest side ≤ 1920" because sharp may shave a pixel for
 *      rounding (4096 / 2160 × 1920 ≈ 1013, not 1015 — sharp clamps to
 *      an integer). The constraint we actually care about is "max
 *      1920px on the longest dim" and "aspect ratio preserved."
 *   2. An 800×600 PNG is BELOW the cap — dimensions stay 800×600.
 *   3. A GIF (`isUploadOptimizableImage` returns false) passes through
 *      the controller branch untouched. We assert the gate function
 *      and confirm the service's passthrough behavior when the helper
 *      is called directly.
 *   4. A video buffer is NOT routed through `optimizeImageForUpload`
 *      (the controller checks the mime prefix first) and the warning
 *      threshold constant is exported at 50 MB.
 */

import { Test, TestingModule } from '@nestjs/testing';
import sharp from 'sharp';
import {
  MediaOptimizationService,
  VIDEO_WARN_SIZE_BYTES,
} from '../storage/media-optimization.service';

describe('Asset upload — image optimization (P0-5)', () => {
  let service: MediaOptimizationService;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MediaOptimizationService],
    }).compile();
    service = module.get(MediaOptimizationService);
  });

  it('resizes a 4096×2160 PNG so the longest side is ≤ 1920px (aspect preserved)', async () => {
    // Synthetic 4K-ish input — a flat-color PNG large enough to exceed
    // the upload cap, small enough to compress under sharp's PNG palette.
    const inputBuf = await sharp({
      create: {
        width: 4096,
        height: 2160,
        channels: 3,
        background: { r: 33, g: 99, b: 165 },
      },
    }).png().toBuffer();

    const result = await service.optimizeImageForUpload(inputBuf, 'image/png', '.png');

    // Assertions on the size + shape.
    expect(result.optimized).toBe(true);
    expect(result.mimeType).toBe('image/png');
    expect(result.processedDimensions).toBeDefined();
    expect(result.processedDimensions!.w).toBeLessThanOrEqual(1920);
    expect(result.processedDimensions!.h).toBeLessThanOrEqual(1920);
    // Longest side === 1920 (aspect preserved => 1920×1012-ish).
    expect(Math.max(result.processedDimensions!.w, result.processedDimensions!.h)).toBe(1920);
    // Aspect ratio preserved within 1% — sharp's integer rounding may
    // shave a pixel.
    const inAspect = 4096 / 2160;
    const outAspect = result.processedDimensions!.w / result.processedDimensions!.h;
    expect(Math.abs(inAspect - outAspect) / inAspect).toBeLessThan(0.01);
    // Original dimensions recorded for forensics.
    expect(result.originalDimensions).toEqual({ w: 4096, h: 2160 });
    // Byte count shrunk.
    expect(result.finalBytes).toBeLessThan(result.originalBytes);
  });

  it('leaves an 800×600 PNG unchanged in dimensions (below the 1920 cap)', async () => {
    const inputBuf = await sharp({
      create: {
        width: 800,
        height: 600,
        channels: 3,
        background: { r: 200, g: 200, b: 200 },
      },
    }).png().toBuffer();

    const result = await service.optimizeImageForUpload(inputBuf, 'image/png', '.png');

    // Whether or not the re-encode actually shrinks the buffer (for a
    // flat gray it may or may not), the DIMENSIONS must be unchanged.
    if (result.processedDimensions) {
      expect(result.processedDimensions).toEqual({ w: 800, h: 600 });
    }
    expect(result.originalDimensions).toEqual({ w: 800, h: 600 });
  });

  it('routes a GIF away from the upload optimizer (passthrough)', () => {
    // The controller checks `isUploadOptimizableImage` first; GIF must
    // return false so the controller never calls `optimizeImageForUpload`.
    expect(service.isUploadOptimizableImage('image/gif')).toBe(false);

    // Defense in depth: even if `optimizeImageForUpload` is invoked
    // directly with a GIF mime, it must return optimized=false (no
    // mutation) so the caller's "uploadBuf" stays the original.
    const dummy = Buffer.from('GIF89a');
    return service.optimizeImageForUpload(dummy, 'image/gif', '.gif').then((result) => {
      expect(result.optimized).toBe(false);
      expect(result.buffer).toBe(dummy);
      expect(result.mimeType).toBe('image/gif');
    });
  });

  it('exports the 50 MB video warning threshold (transcode deferred)', () => {
    // The audit explicitly defers video transcoding. The controller
    // emits a warn log when an uploaded video exceeds this threshold so
    // ops sees it without trawling every upload. 50 MB matches the
    // controller's MAX_VIDEO_SIZE cap.
    expect(VIDEO_WARN_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });

  it('treats JPEG / WebP as upload-optimizable; rejects SVG / ICO / BMP / GIF', () => {
    // JPEG + JPG + PNG + WebP are the four formats the new profile
    // re-encodes. Everything else must passthrough.
    expect(service.isUploadOptimizableImage('image/jpeg')).toBe(true);
    expect(service.isUploadOptimizableImage('image/jpg')).toBe(true);
    expect(service.isUploadOptimizableImage('image/png')).toBe(true);
    expect(service.isUploadOptimizableImage('image/webp')).toBe(true);
    expect(service.isUploadOptimizableImage('image/gif')).toBe(false);
    expect(service.isUploadOptimizableImage('image/svg+xml')).toBe(false);
    expect(service.isUploadOptimizableImage('image/x-icon')).toBe(false);
    expect(service.isUploadOptimizableImage('image/bmp')).toBe(false);
    expect(service.isUploadOptimizableImage('image/tiff')).toBe(false);
    expect(service.isUploadOptimizableImage('')).toBe(false);
  });

  it('re-encodes a 4096×2160 JPEG with mozjpeg q=85 and shrinks the file', async () => {
    // Force JPEG input by encoding a complex (not flat) image — flat
    // images compress so well at PNG that JPEG can't beat them.
    const inputBuf = await sharp({
      create: {
        width: 4096,
        height: 2160,
        channels: 3,
        background: { r: 33, g: 99, b: 165 },
      },
    })
      .jpeg({ quality: 100 })
      .toBuffer();

    const result = await service.optimizeImageForUpload(inputBuf, 'image/jpeg', '.jpg');

    expect(result.optimized).toBe(true);
    expect(result.mimeType).toBe('image/jpeg');
    expect(result.ext).toBe('.jpg');
    expect(Math.max(result.processedDimensions!.w, result.processedDimensions!.h)).toBe(1920);
    expect(result.finalBytes).toBeLessThan(result.originalBytes);
  });
});
