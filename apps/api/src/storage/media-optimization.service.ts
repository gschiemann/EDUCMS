import { Injectable, Logger } from '@nestjs/common';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import sharp from 'sharp';

/**
 * Result of an optimization pass. When nothing was done (unsupported type,
 * already small, or an error) `optimized` is false and the ORIGINAL buffer /
 * mime / ext are returned unchanged — callers can use the result blindly.
 *
 * Dimensions are populated for image optimizations when sharp can read the
 * input metadata; left undefined for video / passthrough paths.
 */
export interface OptimizedMedia {
  buffer: Buffer;
  mimeType: string;
  ext: string; // includes leading dot, e.g. ".webp"
  optimized: boolean;
  originalBytes: number;
  finalBytes: number;
  originalDimensions?: { w: number; h: number };
  processedDimensions?: { w: number; h: number };
}

/**
 * Image-upload profile: max 3840px on the longest
 * side, JPEG q=85, WebP q=85, PNG lossless (palette + compressionLevel 9),
 * EXIF stripped, animated GIFs untouched. A screen-sized 1920px copy is
 * prepared when publishing to a 1080p screen; 4K screens keep 4K detail.
 */
const UPLOAD_IMAGE_MAX_DIM = 3840;
const UPLOAD_JPEG_QUALITY = 85;
const UPLOAD_WEBP_QUALITY = 85;

/**
 * Audit P0-5 (2026-05-27): the upload path does NOT transcode video tonight.
 * ffmpeg is heavy enough that a synchronous transcode could time out an
 * upload over a slow link, and the existing 50 MB per-video controller cap
 * already keeps egress bounded. We DO emit a warning when a stored video
 * exceeds this size so ops sees the candidate for the next-sprint pipeline.
 */
export const VIDEO_WARN_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Shrinks uploaded media to signage-appropriate size BEFORE it is stored, so
 * we never serve a 40 MB phone video or an 8 MB 4000px PNG to a wall that
 * displays it at 1080p. This is the permanent fix for storage egress: each
 * asset is optimized once at ingest and every screen/preview/CI fetch is of
 * the small version forever.
 *
 * Design rules:
 *  - Visually lossless on a screen. Defaults cap the longest image edge at
 *    3840px (4K) and video at 1080p with a high-quality CRF — a screen can't
 *    show more detail than that, so there is no perceptible quality loss.
 *  - NEVER fail an upload. Any error, timeout, or "didn't get smaller" path
 *    returns the original buffer untouched. Worst case == today's behavior.
 *  - Tunable via env without code changes (see the constants below).
 */
@Injectable()
export class MediaOptimizationService {
  private readonly logger = new Logger(MediaOptimizationService.name);

  // Longest edge for images. 3840 = 4K; a screen shows no more than this.
  private readonly IMAGE_MAX_DIM = intEnv('MEDIA_IMAGE_MAX_DIM', 3840);
  private readonly IMAGE_WEBP_QUALITY = intEnv('MEDIA_IMAGE_WEBP_QUALITY', 82);
  // Max video height (preserve aspect). 1080 = plenty for signage.
  private readonly VIDEO_MAX_HEIGHT = intEnv('MEDIA_VIDEO_MAX_HEIGHT', 1080);
  // x264 CRF: lower = higher quality / bigger. 23–26 is visually high.
  private readonly VIDEO_CRF = intEnv('MEDIA_VIDEO_CRF', 24);
  private readonly VIDEO_TIMEOUT_MS = intEnv('MEDIA_VIDEO_TIMEOUT_MS', 180_000);
  // Below this, an image isn't worth touching.
  private readonly IMAGE_MIN_BYTES = intEnv('MEDIA_IMAGE_MIN_BYTES', 50 * 1024);

  /**
   * Route by mime type. Returns the original untouched for anything we don't
   * handle. `keepFormat: true` keeps the input format/extension (used for
   * in-place re-optimization where the stored URL's extension must stay
   * valid — e.g. presigned uploads and the existing-asset backfill); the
   * default converts images to WebP for best compression at a fresh path.
   */
  async optimize(
    buffer: Buffer,
    mimeType: string,
    ext: string,
    opts: { keepFormat?: boolean } = {},
  ): Promise<OptimizedMedia> {
    const passthrough = (): OptimizedMedia => ({
      buffer,
      mimeType,
      ext,
      optimized: false,
      originalBytes: buffer.length,
      finalBytes: buffer.length,
    });

    try {
      if (this.isOptimizableImage(mimeType))
        return await this.optimizeImage(buffer, mimeType, ext, opts.keepFormat === true);
      if (this.isOptimizableVideo(mimeType)) return await this.optimizeVideo(buffer, mimeType, ext);
    } catch (e: any) {
      this.logger.warn(`Media optimize failed (${mimeType}); storing original: ${e?.message || e}`);
    }
    return passthrough();
  }

  isOptimizableImage(mimeType: string): boolean {
    // GIF (often animated) and SVG/ICO are left alone — re-encoding them
    // either loses animation or gains nothing.
    return ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/tiff', 'image/bmp'].includes(
      (mimeType || '').toLowerCase(),
    );
  }

  isOptimizableVideo(mimeType: string): boolean {
    return ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska'].includes(
      (mimeType || '').toLowerCase(),
    );
  }

  /**
   * Returns true for image mimes the upload-time profile resizes / re-encodes.
   * Animated GIFs are deliberately EXCLUDED — sharp's default WebP/JPEG encode
   * drops every frame past the first, so a "looping" GIF would silently become
   * a still. The original is uploaded untouched.
   */
  isUploadOptimizableImage(mimeType: string): boolean {
    return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(
      (mimeType || '').toLowerCase(),
    );
  }

  /**
   * Audit P0-5 (2026-05-27) — sharp-based resize for uploaded images.
   *   - Max 3840px on the longest side. Publishing prepares a 1920px copy
   *     separately when a selected screen is 1080p.
   *   - JPEG re-encoded at q=85 with mozjpeg (smaller than libjpeg-turbo for
   *     the same visual quality).
   *   - WebP re-encoded at q=85.
   *   - PNG re-encoded losslessly (palette + compressionLevel 9).
   *   - EXIF / metadata stripped (sharp's default — we call .rotate() first
   *     so the orientation tag is BAKED IN before metadata is dropped).
   *   - Animated GIFs: NOT routed here (caller checks isUploadOptimizableImage
   *     first). The original is uploaded untouched.
   *
   * Returns `optimized: false` and the ORIGINAL bytes if:
   *   - The processed buffer ended up larger than the original (rare but
   *     possible for tiny / pre-optimized inputs).
   *   - sharp threw (corrupt input, unrecognized format).
   * Callers must always store the returned buffer + mime + ext, NOT the
   * inputs they passed in — the optimizer may switch JPEG→JPEG, PNG→PNG, etc.
   */
  async optimizeImageForUpload(
    buffer: Buffer,
    mimeType: string,
    ext: string,
    maxDimension = UPLOAD_IMAGE_MAX_DIM,
  ): Promise<OptimizedMedia> {
    const passthrough = (): OptimizedMedia => ({
      buffer,
      mimeType,
      ext,
      optimized: false,
      originalBytes: buffer.length,
      finalBytes: buffer.length,
    });

    if (!this.isUploadOptimizableImage(mimeType)) return passthrough();

    try {
      // First read metadata so we can record dimensions for processingMeta —
      // this is a cheap header parse, sharp does NOT decode the whole image.
      const meta = await sharp(buffer, { failOn: 'none' }).metadata();
      const origW = typeof meta.width === 'number' ? meta.width : undefined;
      const origH = typeof meta.height === 'number' ? meta.height : undefined;
      const originalDimensions = origW && origH ? { w: origW, h: origH } : undefined;

      // Only resize when the longest dimension is over the cap; otherwise
      // we just re-encode (still strips EXIF, still re-compresses).
      const needsResize =
        typeof origW === 'number' &&
        typeof origH === 'number' &&
        Math.max(origW, origH) > maxDimension;

      let pipeline = sharp(buffer, { failOn: 'none' }).rotate();
      if (needsResize) {
        pipeline = pipeline.resize({
          width: maxDimension,
          height: maxDimension,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }

      const lower = (mimeType || '').toLowerCase();
      let outBuf: Buffer;
      let outMime: string;
      let outExt: string;
      if (lower === 'image/png') {
        outBuf = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
        outMime = 'image/png';
        outExt = ext || '.png';
      } else if (lower === 'image/webp') {
        outBuf = await pipeline.webp({ quality: UPLOAD_WEBP_QUALITY }).toBuffer();
        outMime = 'image/webp';
        outExt = ext || '.webp';
      } else {
        // image/jpeg + image/jpg
        outBuf = await pipeline.jpeg({ quality: UPLOAD_JPEG_QUALITY, mozjpeg: true }).toBuffer();
        outMime = 'image/jpeg';
        outExt = ext || '.jpg';
      }

      // If we didn't resize AND the encode produced a bigger buffer, fall
      // back to the original. (Re-encoding can balloon files that were
      // already aggressively compressed.)
      if (!needsResize && outBuf.length >= buffer.length) {
        return { ...passthrough(), originalDimensions };
      }

      // Read the OUT buffer's dimensions for the metadata record.
      let processedDimensions: { w: number; h: number } | undefined;
      try {
        const m2 = await sharp(outBuf).metadata();
        if (typeof m2.width === 'number' && typeof m2.height === 'number') {
          processedDimensions = { w: m2.width, h: m2.height };
        }
      } catch { /* dimensions are best-effort */ }

      return {
        buffer: outBuf,
        mimeType: outMime,
        ext: outExt,
        optimized: true,
        originalBytes: buffer.length,
        finalBytes: outBuf.length,
        originalDimensions,
        processedDimensions,
      };
    } catch (e: any) {
      this.logger.warn(
        `optimizeImageForUpload failed (${mimeType}); storing original: ${e?.message || e}`,
      );
      return passthrough();
    }
  }

  private async optimizeImage(
    buffer: Buffer,
    mimeType: string,
    ext: string,
    keepFormat: boolean,
  ): Promise<OptimizedMedia> {
    const unchanged = (): OptimizedMedia => ({
      buffer, mimeType, ext, optimized: false, originalBytes: buffer.length, finalBytes: buffer.length,
    });
    if (buffer.length < this.IMAGE_MIN_BYTES) return unchanged();

    const pipeline = sharp(buffer, { failOn: 'none' })
      .rotate() // honor EXIF orientation, then strip metadata
      .resize({
        width: this.IMAGE_MAX_DIM,
        height: this.IMAGE_MAX_DIM,
        fit: 'inside',
        withoutEnlargement: true,
      });

    let outBuf: Buffer;
    let outMime = 'image/webp';
    let outExt = '.webp';
    if (keepFormat) {
      // Re-encode in the SAME format so the stored URL's extension stays
      // valid (no reference rewrites). Resize alone is a big win for the
      // oversized originals; per-codec settings keep quality high.
      const lower = (mimeType || '').toLowerCase();
      if (lower === 'image/png') {
        outBuf = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
        outMime = 'image/png'; outExt = ext || '.png';
      } else if (lower === 'image/webp') {
        outBuf = await pipeline.webp({ quality: this.IMAGE_WEBP_QUALITY }).toBuffer();
        outMime = 'image/webp'; outExt = ext || '.webp';
      } else {
        outBuf = await pipeline.jpeg({ quality: this.IMAGE_WEBP_QUALITY, mozjpeg: true }).toBuffer();
        outMime = 'image/jpeg'; outExt = ext || '.jpg';
      }
    } else {
      outBuf = await pipeline.webp({ quality: this.IMAGE_WEBP_QUALITY }).toBuffer();
    }

    // Only adopt the result if it actually saved space.
    if (outBuf.length >= buffer.length) return unchanged();
    return {
      buffer: outBuf,
      mimeType: outMime,
      ext: outExt,
      optimized: true,
      originalBytes: buffer.length,
      finalBytes: outBuf.length,
    };
  }

  private async optimizeVideo(buffer: Buffer, mimeType: string, ext: string): Promise<OptimizedMedia> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-vid-'));
    const inPath = path.join(dir, `in${ext || '.mp4'}`);
    const outPath = path.join(dir, `out.mp4`);
    try {
      await fs.writeFile(inPath, buffer);
      await this.runFfmpeg([
        '-y',
        '-i', inPath,
        // Scale down to max height, preserve aspect, keep dims even (-2).
        '-vf', `scale=-2:'min(${this.VIDEO_MAX_HEIGHT},ih)'`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', String(this.VIDEO_CRF),
        '-pix_fmt', 'yuv420p', // broad player/WebView compatibility
        '-c:a', 'aac',
        '-b:a', '128k',
        '-movflags', '+faststart', // moov atom up front → instant playback
        outPath,
      ]);
      const out = await fs.readFile(outPath);
      if (out.length >= buffer.length) {
        return { buffer, mimeType, ext, optimized: false, originalBytes: buffer.length, finalBytes: buffer.length };
      }
      return {
        buffer: out,
        mimeType: 'video/mp4',
        ext: '.mp4',
        optimized: true,
        originalBytes: buffer.length,
        finalBytes: out.length,
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => {
        proc.kill('SIGKILL');
        reject(new Error(`ffmpeg timed out after ${this.VIDEO_TIMEOUT_MS}ms`));
      }, this.VIDEO_TIMEOUT_MS);
      proc.stderr.on('data', (d) => {
        stderr += d.toString();
        if (stderr.length > 8192) stderr = stderr.slice(-8192);
      });
      proc.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      proc.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-500)}`));
      });
    });
  }
}

function intEnv(name: string, def: number): number {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}
