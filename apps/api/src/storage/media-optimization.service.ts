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
 */
export interface OptimizedMedia {
  buffer: Buffer;
  mimeType: string;
  ext: string; // includes leading dot, e.g. ".webp"
  optimized: boolean;
  originalBytes: number;
  finalBytes: number;
}

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
