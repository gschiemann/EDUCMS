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
  /**
   * 2026-10-05 — what sharp made of the INPUT, for the upload content check
   * (assets/upload-content-verdict.ts). `sourceFormat` / `sourceCompression` are
   * sharp's own `metadata()` answer ('jpeg', 'png', 'heif' + 'hevc', 'svg' …);
   * `decodeFailure` is what it threw, when it threw. Before this the failure was
   * only logged and the original kept — a text file named .jpg ended "Ready".
   * Undefined when the optimizer never looked (not an optimizable type).
   */
  sourceFormat?: string | null;
  sourceCompression?: string | null;
  decodeFailure?: string | null;
  /**
   * The source was a format screens cannot draw (SVG, TIFF, AVIF … under a
   * JPEG / PNG / WebP name), so the re-encode replaces it even though it is not
   * smaller. Only with `convertNonScreenFormats` (see optimizeImageForUpload).
   */
  convertedForScreens?: boolean;
  /**
   * 2026-10-05 — these bytes ARE the stored upload, converted from another format
   * before the asset existed (a HEIC photo → JPEG, assets/heif-convert.ts); the
   * value names the original. Nothing is left to adopt (`optimized` is false); the
   * upload records it in processingMeta as `convertedFrom`.
   */
  convertedFrom?: string;
}

/**
 * Formats a screen draws from an `<img>` whatever the file is called (browsers
 * sniff the bytes). Anything else sharp can read (SVG, TIFF, AVIF/HEIF, …) shows
 * black on a screen when stored as uploaded.
 */
const SCREEN_IMAGE_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);

/**
 * Will the caller store the optimizer's re-encode in place of the original?
 * The upload path's rule, in one place (assets.controller.ts completeUpload and
 * the upload content check both read it): a re-encode that is smaller, or one
 * that replaces a format screens cannot draw.
 */
export function adoptsReencode(opt: OptimizedMedia, originalBytes: number): boolean {
  return opt.optimized && (opt.finalBytes < originalBytes || opt.convertedForScreens === true);
}

/**
 * Image-upload profile: max 3840px on the longest
 * side, JPEG q=85, WebP q=85, PNG lossless (palette + compressionLevel 9),
 * EXIF stripped, animated GIFs untouched. A screen-sized 1920px copy is
 * prepared when publishing to a 1080p screen; 4K screens keep 4K detail.
 */
export const UPLOAD_IMAGE_MAX_DIM = 3840;
export const UPLOAD_JPEG_QUALITY = 85;
export const UPLOAD_WEBP_QUALITY = 85;

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
   *     possible for tiny / pre-optimized inputs) — unless the source is a
   *     format screens cannot draw and `opts.convertNonScreenFormats` is set.
   *   - sharp threw (corrupt input, unrecognized format) — `decodeFailure`
   *     then says what it threw (2026-10-05).
   * Callers must always store the returned buffer + mime + ext, NOT the
   * inputs they passed in — the optimizer may switch JPEG→JPEG, PNG→PNG, etc.
   *
   * `opts.convertNonScreenFormats` (2026-10-05, the media-library upload only):
   * an SVG, TIFF or AVIF under a JPEG / PNG / WebP name used to be kept as
   * uploaded whenever its re-encode came out bigger — and a screen cannot draw
   * those bytes (an SVG served as image/png is black everywhere; AVIF is black on
   * a Chromium-83 LED controller). With the option the re-encode replaces them
   * whatever it weighs (`convertedForScreens`). Off by default so every other
   * caller — the multipart path that panic content uses, the 1080p publish copy —
   * behaves exactly as before.
   */
  async optimizeImageForUpload(
    buffer: Buffer,
    mimeType: string,
    ext: string,
    maxDimension = UPLOAD_IMAGE_MAX_DIM,
    maxShortDimension = maxDimension,
    opts: { convertNonScreenFormats?: boolean } = {},
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

    // What sharp recognised, kept outside the try so a decode that fails AFTER
    // the header read still reports the format (a HEIC reads fine, then fails).
    let meta: sharp.Metadata | null = null;
    const source = () => ({
      sourceFormat: meta?.format ?? null,
      sourceCompression:
        typeof (meta as { compression?: unknown } | null)?.compression === 'string'
          ? ((meta as { compression?: string }).compression as string)
          : null,
    });
    try {
      // First read metadata so we can record dimensions for processingMeta —
      // this is a cheap header parse, sharp does NOT decode the whole image.
      meta = await sharp(buffer, { failOn: 'none' }).metadata();
      const origW = typeof meta.width === 'number' ? meta.width : undefined;
      const origH = typeof meta.height === 'number' ? meta.height : undefined;
      const originalDimensions = origW && origH ? { w: origW, h: origH } : undefined;

      // Uploads cap both sides equally. Playback copies also bound the short
      // side: 1182×1330 fits a 1920px square but not a 1080×1920 panel.
      const needsResize =
        typeof origW === 'number' &&
        typeof origH === 'number' &&
        (Math.max(origW, origH) > maxDimension ||
          Math.min(origW, origH) > maxShortDimension);

      let pipeline = sharp(buffer, { failOn: 'none' }).rotate();
      if (needsResize) {
        // rotate() bakes EXIF into pixels before resize, so use the resulting
        // orientation for the rectangle (orientations 5–8 swap the axes).
        const swapsAxes = typeof meta.orientation === 'number' && meta.orientation >= 5;
        const portrait = swapsAxes ? origW! > origH! : origH! > origW!;
        pipeline = pipeline.resize({
          width: portrait ? maxShortDimension : maxDimension,
          height: portrait ? maxDimension : maxShortDimension,
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
      // already aggressively compressed.) Unless the original is a format no
      // screen draws and the caller asked for those to be converted.
      const screenDrawable = SCREEN_IMAGE_FORMATS.has(String(meta.format ?? ''));
      const convertedForScreens = !screenDrawable && opts.convertNonScreenFormats === true;
      if (!needsResize && outBuf.length >= buffer.length && !convertedForScreens) {
        return { ...passthrough(), originalDimensions, ...source() };
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
        ...source(),
        ...(convertedForScreens ? { convertedForScreens: true } : {}),
      };
    } catch (e: any) {
      this.logger.warn(
        `optimizeImageForUpload failed (${mimeType}); storing original: ${e?.message || e}`,
      );
      return { ...passthrough(), ...source(), decodeFailure: String(e?.message || e) };
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
