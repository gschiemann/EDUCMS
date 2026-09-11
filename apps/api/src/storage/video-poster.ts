/**
 * video-poster.ts — extract ONE representative frame from a video with ffmpeg.
 *
 * WHY THIS EXISTS: `Asset` had no poster/thumbnail column, so the asset picker
 * drew every video tile as `<video preload="none">` → a blank grey rectangle.
 * An image renders because the browser can draw the file; a video cannot be a
 * thumbnail without an extracted frame. This module makes the frame.
 *
 * DESIGN RULES (the same shape as MediaOptimizationService's video path, which
 * is the other ffmpeg caller in this repo):
 *
 *  1. **It NEVER throws and it NEVER blocks an upload.** Every path returns a
 *     `PosterOutcome` — `{ ok: true, … }` or `{ ok: false, reason }`. A video
 *     that uploads fine but has no poster is a cosmetic gap; an upload that
 *     fails because ffmpeg choked is a broken product.
 *  2. **Hard-bounded.** ffmpeg is SIGKILLed at `MEDIA_POSTER_TIMEOUT_MS`
 *     (default 20s — deliberately well under MediaOptimizationService's 180s
 *     transcode budget, because one keyframe is not a transcode).
 *  3. **No Nest, no DI, no sharp, no @prisma/client.** Plain Node so
 *     `scripts/backfill-video-posters.ts` can import it under `tsx` without
 *     standing up the API's module graph — one definition of the ffmpeg
 *     arguments, not two that drift.
 *  4. **A URL source must be proven ours.** `extractVideoPosterFromUrl` refuses
 *     any URL outside the caller-supplied trusted prefix. We hand a real
 *     ffmpeg an input URL only when WE built it from `SUPABASE_URL` + a storage
 *     path; a stored `Asset.fileUrl` can be an arbitrary external address (see
 *     `POST /assets/url`), and feeding one to a media decoder that speaks a
 *     dozen protocols is an SSRF surface. Callers derive the path, then rebuild
 *     the URL — never pass the stored value through.
 */
import { spawn as nodeSpawn } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** The poster is always a JPEG — universally decodable, tiny, no alpha needed. */
export const POSTER_MIME = 'image/jpeg';
export const POSTER_EXT = '.jpg';

/**
 * Longest edge of the poster. 640px covers the picker's ~200px tiles at 2-3x
 * DPR and doubles as a `<video poster>` on a 1080p board without being a
 * second copy of the video's storage cost. Never UPSCALES (`min(W,iw)`).
 */
export const POSTER_MAX_WIDTH = intEnv('MEDIA_POSTER_MAX_WIDTH', 640);
/** ffmpeg mjpeg `-q:v` (2 = best … 31 = worst). 4 is visually clean at 640px. */
export const POSTER_JPEG_Q = intEnv('MEDIA_POSTER_JPEG_Q', 4);
/** SIGKILL budget for one frame grab. */
export const POSTER_TIMEOUT_MS = intEnv('MEDIA_POSTER_TIMEOUT_MS', 20_000);
/**
 * Where to grab the frame. 1s in skips the black/fade-in first frame that most
 * editors export. A video SHORTER than this yields no frame, so the extractor
 * automatically retries at 0s — see `SEEK_LADDER`.
 */
export const POSTER_SEEK_SECONDS = intEnv('MEDIA_POSTER_SEEK_SECONDS', 1);

/** Seek positions tried in order. The 0 retry is what makes sub-second clips work. */
const SEEK_LADDER = (): number[] =>
  POSTER_SEEK_SECONDS > 0 ? [POSTER_SEEK_SECONDS, 0] : [0];

/**
 * A poster is worth attempting for anything the platform accepts as video.
 * (Upload accepts video/mp4, video/webm, video/x-m4v; the check is broad on
 * purpose — ffmpeg decodes far more than the upload allowlist, and a mime we
 * can't decode simply comes back `{ ok: false }`.)
 */
export function isPosterableVideo(
  mimeType: string | null | undefined,
): boolean {
  return (mimeType || '').toLowerCase().startsWith('video/');
}

export type PosterOutcome =
  | {
      ok: true;
      buffer: Buffer;
      mimeType: string;
      ext: string;
      bytes: number;
      /** Which rung of the seek ladder produced the frame (forensics / tests). */
      seekSeconds: number;
    }
  | { ok: false; reason: string };

/** Injectable for tests — same shape as `child_process.spawn`. */
export type SpawnLike = typeof nodeSpawn;

export interface PosterOptions {
  spawnFn?: SpawnLike;
  timeoutMs?: number;
  maxWidth?: number;
  /** Overrides the seek ladder entirely (tests / one-off tuning). */
  seekSeconds?: number[];
}

/**
 * Build the ffmpeg argv for one frame grab. Exported so a unit test can assert
 * the contract (input seek, single frame, no audio, no upscale) without a
 * binary on the box — CI runners are not guaranteed to ship ffmpeg, the
 * production image is (Dockerfile hard-fails the build without it).
 *
 *  `-ss` BEFORE `-i` is an INPUT seek: on an http(s) input ffmpeg range-reads
 *  to the keyframe instead of streaming the whole file, so a poster for a 50 MB
 *  video costs a few hundred KB of egress rather than 50 MB.
 *  `-map 0:V:0` takes the first real video stream — capital V excludes attached
 *  cover art, which would otherwise be "the frame" for an audio-ish container.
 */
export function buildPosterArgs(
  input: string,
  outPath: string,
  seekSeconds: number,
  maxWidth: number = POSTER_MAX_WIDTH,
): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    ...(seekSeconds > 0 ? ['-ss', String(seekSeconds)] : []),
    '-i',
    input,
    '-map',
    '0:V:0',
    '-an',
    '-sn',
    '-dn',
    '-frames:v',
    '1',
    // Never upscale: min(maxWidth, iw). -2 keeps the height even.
    '-vf',
    `scale='min(${maxWidth},iw)':-2`,
    '-c:v',
    'mjpeg',
    '-q:v',
    String(POSTER_JPEG_Q),
    '-f',
    'image2',
    outPath,
  ];
}

/**
 * Extract a poster from bytes already in memory (the multipart upload path).
 * `ext` only seeds the temp filename so ffmpeg's demuxer probe gets a hint.
 */
export async function extractVideoPosterFromBuffer(
  buffer: Buffer,
  ext: string | null | undefined,
  opts: PosterOptions = {},
): Promise<PosterOutcome> {
  if (!buffer || buffer.length === 0)
    return { ok: false, reason: 'empty-buffer' };
  let dir: string | null = null;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-poster-in-'));
    const inPath = path.join(dir, `in${safeExt(ext) || '.mp4'}`);
    await fs.writeFile(inPath, buffer);
    return await extractToBuffer(inPath, opts);
  } catch (e: any) {
    return { ok: false, reason: `temp-io: ${e?.message ?? e}` };
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Extract a poster by pointing ffmpeg straight at an object URL — the cheap
 * path for the presign flow and the backfill, where the bytes live in Supabase
 * and downloading them whole would re-import up to the full per-video cap.
 *
 * `trustedPrefix` MUST be a prefix the caller constructed itself (e.g.
 * `${SUPABASE_URL}/storage/v1/object/public/assets/`). A URL outside it is
 * refused without spawning anything.
 */
export async function extractVideoPosterFromUrl(
  url: string,
  trustedPrefix: string,
  opts: PosterOptions = {},
): Promise<PosterOutcome> {
  if (typeof url !== 'string' || !url) return { ok: false, reason: 'no-url' };
  if (!trustedPrefix || !url.startsWith(trustedPrefix)) {
    return { ok: false, reason: 'untrusted-source-url' };
  }
  return extractToBuffer(url, opts);
}

/** Shared core: walk the seek ladder, return the first frame that lands. */
async function extractToBuffer(
  input: string,
  opts: PosterOptions,
): Promise<PosterOutcome> {
  const ladder =
    opts.seekSeconds && opts.seekSeconds.length
      ? opts.seekSeconds
      : SEEK_LADDER();
  let dir: string | null = null;
  let lastReason = 'no-frame';
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-poster-out-'));
    for (const seek of ladder) {
      const outPath = path.join(dir, `${randomUUID()}${POSTER_EXT}`);
      const args = buildPosterArgs(
        input,
        outPath,
        seek,
        opts.maxWidth ?? POSTER_MAX_WIDTH,
      );
      const run = await runFfmpeg(args, opts);
      if (!run.ok) {
        lastReason = run.reason;
        continue;
      }
      let out: Buffer;
      try {
        out = await fs.readFile(outPath);
      } catch {
        // ffmpeg exited 0 but wrote nothing: seeking past the end of a short
        // clip does exactly this. Fall through to the next rung.
        lastReason = `no-output-at-${seek}s`;
        continue;
      }
      if (out.length === 0) {
        lastReason = `empty-output-at-${seek}s`;
        continue;
      }
      return {
        ok: true,
        buffer: out,
        mimeType: POSTER_MIME,
        ext: POSTER_EXT,
        bytes: out.length,
        seekSeconds: seek,
      };
    }
    return { ok: false, reason: lastReason };
  } catch (e: any) {
    return { ok: false, reason: `extract: ${e?.message ?? e}` };
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Spawn ffmpeg with a hard kill timer. Mirrors
 * MediaOptimizationService.runFfmpeg, but resolves an outcome instead of
 * rejecting — the whole module is failure-tolerant by contract.
 */
function runFfmpeg(
  args: string[],
  opts: PosterOptions,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const timeoutMs = opts.timeoutMs ?? POSTER_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: { ok: true } | { ok: false; reason: string }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    let proc: ReturnType<SpawnLike>;
    try {
      proc = spawnFn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e: any) {
      // ffmpeg missing from PATH throws synchronously on some platforms.
      finish({ ok: false, reason: `spawn: ${e?.message ?? e}` });
      return;
    }
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish({ ok: false, reason: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    proc.stderr?.on('data', (d: Buffer | string) => {
      stderr += d.toString();
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });
    proc.on('error', (e: any) => {
      clearTimeout(timer);
      finish({ ok: false, reason: `spawn: ${e?.message ?? e}` });
    });
    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) finish({ ok: true });
      else
        finish({
          ok: false,
          reason: `ffmpeg exited ${code}: ${stderr.slice(-300)}`,
        });
    });
  });
}

/** Only a short, dot-led, alphanumeric extension reaches a temp filename. */
function safeExt(ext: string | null | undefined): string {
  const e = (ext || '').trim().toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(e) ? e : '';
}

function intEnv(name: string, def: number): number {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}
