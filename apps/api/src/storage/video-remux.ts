/**
 * video-remux.ts — move an MP4's index (`moov`) in front of its samples
 * (`mdat`), LOSSLESSLY, so a screen can show the first frame before the whole
 * file has arrived ("fast start").
 *
 * WHY THIS EXISTS (operator, 2026-09-24): the playback grade flags an MP4
 * whose index sits at the END — a player has to fetch all of it before it can
 * render anything — and told the operator to re-export. "How do we change the
 * index placement?" With a re-MUX, not a re-encode:
 *
 *     ffmpeg -i in.mp4 -c copy -movflags +faststart out.mp4
 *
 * `-c copy` carries every video / audio / subtitle packet over bit for bit —
 * no decode, no encode, no quality change (checked with ffmpeg 6.1: identical
 * per-stream MD5s, packet tables, rotation and size before and after); only
 * the box order changes. `+faststart` makes the muxer write the file, then
 * shift `mdat` down and put `moov` in front of it. VideoPosterService runs
 * this for the operator after the upload probe reads `fastStart: false`.
 *
 * DESIGN RULES — the same shape as video-poster.ts / video-probe.ts:
 *
 *  1. **It NEVER throws.** Every path resolves `{ ok: true, … }` or
 *     `{ ok: false, reason }`, and a caller changes nothing on anything but
 *     ok: an MP4 with its index at the end still plays, it just starts late.
 *  2. **Hard-bounded.** Inputs above `MAX_REMUX_BYTES` are refused before
 *     anything is spawned; ffmpeg is SIGKILLed at a size-scaled budget
 *     (`remuxTimeoutMs`: 30 s + 1 s per 10 MB, capped at 10 minutes).
 *  3. **The output is verified before anyone can use it.** Its first bytes
 *     must read `moov` before `mdat` (`readIsoBmffFastStart` === true), or the
 *     outcome is `{ ok: false }` and the bytes are dropped. The service adds a
 *     second check on top (`remuxParityProblem`: the re-muxed file must probe
 *     as the same media).
 *  4. **No Nest, no DI, no @prisma/client.** Plain Node, like its siblings, so
 *     a script can import it under `tsx` without the API's module graph.
 */
import { spawn as nodeSpawn } from 'child_process';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  errorMessage,
  FAST_START_SCAN_BYTES,
  isIsoBmffFamily,
  mergeProbeMeta,
  readIsoBmffFastStart,
  type ProbeMeta,
  type ProbeOutcome,
  type ProbeSuccess,
  type SpawnLike,
} from './video-probe';

/** The re-muxed file is always written by ffmpeg's mp4 muxer. */
export const REMUX_OUTPUT_EXT = '.mp4';
export const REMUX_MIME = 'video/mp4';

/**
 * The largest input the re-mux accepts: 2 GiB. Above it the outcome is
 * `{ ok: false }` without spawning anything. Why this number:
 *
 *  - The output has to come back as ONE Buffer (`SupabaseStorageService
 *    .upload` takes a Buffer), and Node's `fs.readFile` refuses a file over
 *    2 GiB outright (`ERR_FS_FILE_TOO_LARGE` — verified on Node 22, the
 *    production image). Past this size the re-mux could not hand its result
 *    back at all, so trying would only burn disk and CPU.
 *  - Memory. The caller holds the input, the output lands beside it, and the
 *    upload copies it once more: roughly 3× the file at the peak, on the pod
 *    that also carries emergency delivery. The ceiling keeps one odd row from
 *    becoming an out-of-memory restart.
 *  - It is a guard, not a limit anyone meets: the upload cap is 500 MB
 *    (`MAX_VIDEO_SIZE`), so only a legacy or imported row could get near it.
 */
export const MAX_REMUX_BYTES = 2 * 1024 * 1024 * 1024;

/** Timeout = base + a slice per 10 MB, capped — a stream copy is I/O, not decode. */
export const REMUX_BASE_TIMEOUT_MS = 30_000;
export const REMUX_TIMEOUT_MS_PER_10_MB = 1_000;
export const REMUX_MAX_TIMEOUT_MS = 10 * 60_000;
const TEN_MB = 10 * 1024 * 1024;

/**
 * The SIGKILL budget for one re-mux of `bytes`: 30 s + 1 s per started
 * 10 MB, capped at 10 minutes. A 257 MB clip gets 56 s; the 500 MB upload
 * cap gets 80 s; nothing ever waits longer than 10 minutes.
 */
export function remuxTimeoutMs(bytes: number): number {
  const slices = Math.ceil(Math.max(0, bytes) / TEN_MB);
  return Math.min(
    REMUX_MAX_TIMEOUT_MS,
    REMUX_BASE_TIMEOUT_MS + slices * REMUX_TIMEOUT_MS_PER_10_MB,
  );
}

export type RemuxOutcome =
  | { ok: true; buffer: Buffer; bytesBefore: number; bytesAfter: number }
  | { ok: false; reason: string };

export interface RemuxOptions {
  /** SIGKILL budget; defaults to `remuxTimeoutMs(input size)`. */
  timeoutMs?: number;
  /** The binary to run; defaults to `ffmpeg` on PATH (the production image ships it). */
  ffmpegPath?: string;
  /** Injectable for tests — same shape as `child_process.spawn`. */
  spawn?: SpawnLike;
  /** Refuse inputs above this many bytes; defaults to `MAX_REMUX_BYTES`. */
  maxBytes?: number;
}

/** The two facts the re-mux decision reads — a `ProbeSuccess` or a stored `ProbeFacts` both carry them. */
export interface FastStartFacts {
  container?: string | null;
  fastStart?: boolean | null;
}

/**
 * Does this video need the re-mux? Only an MP4 / MOV-family container
 * (`format_name` names the ISO-BMFF demuxer) whose index was READ to be at the
 * end (`fastStart === false`). `null` — not ISO-BMFF, or the box order could
 * not be read — is never a reason to rewrite a file.
 */
export function needsFastStartRemux(
  probe: FastStartFacts | null | undefined,
): boolean {
  if (!probe || probe.fastStart !== false) return false;
  return !!probe.container && isIsoBmffFamily(probe.container, null);
}

/**
 * The ffmpeg argv for one re-mux. Exported so a unit test can pin the
 * contract without a binary on the box.
 *
 *  `-map 0:V` every real video stream (capital V leaves out attached cover
 *  art, which is no part of playback); `-map 0:a?` / `-map 0:s?` every audio
 *  and subtitle stream, if there are any — ffmpeg's default picks only ONE of
 *  each and would silently drop a second audio track. Data tracks are left to
 *  the muxer (a timecode track is re-created from the copied metadata).
 *  `-c copy` = no re-encode. `-f mp4` so the output never depends on the
 *  temp file's name.
 */
export function buildRemuxArgs(inPath: string, outPath: string): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-nostdin',
    '-y',
    '-i',
    inPath,
    '-map',
    '0:V',
    '-map',
    '0:a?',
    '-map',
    '0:s?',
    '-c',
    'copy',
    '-map_metadata',
    '0',
    '-movflags',
    '+faststart',
    '-f',
    'mp4',
    outPath,
  ];
}

/**
 * Re-mux `input.buffer` with its index in front. `ext` only seeds the temp
 * filename so ffmpeg's demuxer detection gets a hint. Resolves the re-muxed
 * bytes only when they read fast-start; never throws.
 */
export async function remuxFastStart(
  input: { buffer: Buffer; ext?: string | null },
  opts: RemuxOptions = {},
): Promise<RemuxOutcome> {
  const buffer = input?.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0)
    return { ok: false, reason: 'empty-buffer' };
  const maxBytes = opts.maxBytes ?? MAX_REMUX_BYTES;
  if (buffer.length > maxBytes) {
    return {
      ok: false,
      reason: `too-large: ${buffer.length} bytes is over the ${maxBytes}-byte re-mux ceiling`,
    };
  }
  let dir: string | null = null;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-remux-'));
    const inPath = path.join(dir, `in${safeExt(input.ext) || '.mp4'}`);
    const outPath = path.join(dir, `out${REMUX_OUTPUT_EXT}`);
    await fs.writeFile(inPath, buffer);
    const run = await runFfmpeg(buildRemuxArgs(inPath, outPath), {
      spawn: opts.spawn ?? nodeSpawn,
      ffmpegPath: opts.ffmpegPath || 'ffmpeg',
      timeoutMs: opts.timeoutMs ?? remuxTimeoutMs(buffer.length),
    });
    if (!run.ok) return run;
    let out: Buffer;
    try {
      out = await fs.readFile(outPath);
    } catch (e) {
      return { ok: false, reason: `no-output: ${errorMessage(e)}` };
    }
    if (out.length === 0) return { ok: false, reason: 'empty-output' };
    const fastStart = readIsoBmffFastStart(
      out.subarray(0, FAST_START_SCAN_BYTES),
    );
    if (fastStart !== true) {
      return {
        ok: false,
        reason: `output-not-fast-start: the re-muxed file reads ${
          fastStart === false ? 'mdat before moov' : 'no readable box order'
        }`,
      };
    }
    return {
      ok: true,
      buffer: out,
      bytesBefore: buffer.length,
      bytesAfter: out.length,
    };
  } catch (e) {
    return { ok: false, reason: `remux: ${errorMessage(e)}` };
  } finally {
    if (dir)
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// ── is the re-muxed file the same media? ────────────────────────────────────

/** How far a stream copy's duration may move (edit-list rounding) before it counts as lost media. */
const DURATION_TOLERANCE_MS = 250;
const DURATION_TOLERANCE_RATIO = 0.01;

/**
 * Compare the ORIGINAL's probe with the re-muxed file's. Returns null when
 * the output is the same media with its index in front — it probes, reads
 * fast-start, and has the same video codec, coded size, rotation, audio
 * codec / channels and (within 1 % or 250 ms) duration — else a short
 * reason. A stream copy cannot change any of these; if one moved, the
 * re-mux lost something and must not replace the file.
 */
export function remuxParityProblem(
  before: ProbeSuccess,
  after: ProbeOutcome,
): string | null {
  if (!after.ok) return `the re-muxed file does not probe (${after.reason})`;
  if (after.fastStart !== true)
    return 'the re-muxed file does not read fast-start';
  const diffs: string[] = [];
  if (after.codec !== before.codec)
    diffs.push(`codec ${before.codec} → ${after.codec}`);
  if (after.width !== before.width || after.height !== before.height)
    diffs.push(
      `size ${before.width}×${before.height} → ${after.width}×${after.height}`,
    );
  if (after.rotation !== before.rotation)
    diffs.push(`rotation ${before.rotation}° → ${after.rotation}°`);
  const audioBefore = describeAudio(before);
  const audioAfter = describeAudio(after);
  if (audioAfter !== audioBefore)
    diffs.push(`audio ${audioBefore} → ${audioAfter}`);
  if (before.durationMs !== null) {
    const tolerance = Math.max(
      DURATION_TOLERANCE_MS,
      before.durationMs * DURATION_TOLERANCE_RATIO,
    );
    if (
      after.durationMs === null ||
      Math.abs(after.durationMs - before.durationMs) > tolerance
    )
      diffs.push(`duration ${before.durationMs} → ${after.durationMs} ms`);
  }
  return diffs.length
    ? `the re-muxed file is not the same media: ${diffs.join('; ')}`
    : null;
}

function describeAudio(p: ProbeSuccess): string {
  return p.audio
    ? `${p.audio.codec ?? 'unknown'}/${p.audio.channels ?? '?'}ch`
    : 'none';
}

// ── where the re-muxed copy lives, and what the row records ─────────────────

/**
 * The bucket path of the re-muxed copy: beside the original, same folder,
 * `<basename>-faststart-<token>.mp4`. The token is fresh per attempt because
 * two replicas can re-mux the same row at once (the hourly leader and an
 * operator's "Check this file" on another pod): only one swap wins, and the
 * loser must be able to delete ITS copy with no chance of deleting the
 * winner's. It also means a published object is never overwritten in place —
 * assets are served `max-age=31536000`, so a CDN edge would keep the old
 * bytes. A basename is never a bare UUID, so `isMintedUploadPath` refuses it
 * and `POST /assets/complete-upload` can never claim the copy.
 */
export function remuxStoragePath(
  originalPath: string,
  token: string = randomBytes(4).toString('hex'),
): string {
  const dir = path.posix.dirname(originalPath);
  const ext = path.posix.extname(originalPath);
  const base =
    path.posix
      .basename(originalPath, ext)
      .replace(/-faststart-[0-9a-f]+$/i, '') || 'video';
  const name = `${base}-faststart-${token}${REMUX_OUTPUT_EXT}`;
  return dir === '.' || dir === '' ? name : `${dir}/${name}`;
}

/**
 * `processingMeta.remux` — written once, by the swap that moved the row onto
 * the fast-start copy. The original object is KEPT (see VideoPosterService:
 * copies of its URL live on outside this row) and `previousStoragePath` is
 * how the asset DELETE path, or a later sweep, finds it again.
 */
export interface RemuxMeta {
  /** ISO-8601, when the swap was written. */
  at: string;
  reason: 'fast-start';
  /** Bucket path of the original (index-at-the-end) object, still in storage. */
  previousStoragePath: string;
  bytesBefore: number;
  bytesAfter: number;
}

export function buildRemuxMeta(
  facts: {
    previousStoragePath: string;
    bytesBefore: number;
    bytesAfter: number;
  },
  at: Date = new Date(),
): RemuxMeta {
  return {
    at: at.toISOString(),
    reason: 'fast-start',
    previousStoragePath: facts.previousStoragePath,
    bytesBefore: facts.bytesBefore,
    bytesAfter: facts.bytesAfter,
  };
}

/**
 * The swap's `processingMeta`: the RE-MUXED file's own probe merged over what
 * the row holds (`mergeProbeMeta` — every key the probe does not own
 * survives, a stale failure stamp is cleared), plus the `remux` record. So
 * `probe.fastStart` is a MEASURED true, read from the new bytes, not an
 * assertion — and the row still carries a current probe, so the auto-heal
 * cron's `needsProbeSql` never selects it again.
 */
export function mergeRemuxMeta(
  existing: unknown,
  remuxedProbe: ProbeSuccess,
  remux: RemuxMeta,
  probedAt: Date = new Date(),
): Record<string, unknown> & ProbeMeta & { remux: RemuxMeta } {
  return { ...mergeProbeMeta(existing, remuxedProbe, probedAt), remux };
}

/**
 * The idempotency guard: has this row already been moved onto a fast-start
 * copy (`remux` present), or does its stored probe already read fast-start?
 * Either way a second pass must not re-mux it again.
 */
export function alreadyFastStart(meta: unknown): boolean {
  if (!isRecord(meta)) return false;
  if (meta.remux !== undefined && meta.remux !== null) return true;
  return isRecord(meta.probe) && meta.probe.fastStart === true;
}

/**
 * Did this probe read the ORIGINAL of a row that has since moved onto its
 * fast-start copy? True when the row carries a remux record and the probe's
 * source is either in-memory bytes (an upload's own buffer IS the original) or
 * the recorded original's path. Such a probe — a "Check this file" that read
 * the old URL just before the swap, a retried upload job — must not overwrite
 * the copy's facts with the original's `fastStart: false`.
 */
export function probedReplacedOriginal(
  meta: unknown,
  probedPath: string | null | undefined,
): boolean {
  if (!isRecord(meta) || !isRecord(meta.remux)) return false;
  return !probedPath || probedPath === meta.remux.previousStoragePath;
}

/**
 * The kept original a row still owns, for the asset DELETE path: the path the
 * swap recorded, accepted only in the shape the swap writes — under the row's
 * own tenant folder, no traversal. Anything else is null and nothing is
 * deleted.
 */
export function retainedOriginalPath(
  meta: unknown,
  tenantId: string,
): string | null {
  if (!tenantId || !isRecord(meta) || !isRecord(meta.remux)) return null;
  const p = meta.remux.previousStoragePath;
  if (typeof p !== 'string' || !p.startsWith(`${tenantId}/`)) return null;
  if (p.includes('..') || p.includes('\\') || p.length <= tenantId.length + 1)
    return null;
  return p;
}

// ── process plumbing ────────────────────────────────────────────────────────

/**
 * Spawn ffmpeg with a hard kill timer. Mirrors the poster module's runFfmpeg,
 * resolving an outcome instead of rejecting — the module is failure-tolerant
 * by contract.
 */
function runFfmpeg(
  args: string[],
  run: { spawn: SpawnLike; ffmpegPath: string; timeoutMs: number },
): Promise<{ ok: true } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: { ok: true } | { ok: false; reason: string }) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    let proc: ReturnType<SpawnLike>;
    try {
      proc = run.spawn(run.ffmpegPath, args, {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (e) {
      // A missing binary throws synchronously on some platforms.
      finish({ ok: false, reason: `spawn: ${errorMessage(e)}` });
      return;
    }
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish({ ok: false, reason: `timeout after ${run.timeoutMs}ms` });
    }, run.timeoutMs);
    proc.stderr?.on('data', (d: Buffer | string) => {
      stderr += d.toString();
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });
    proc.on('error', (e: Error) => {
      clearTimeout(timer);
      finish({ ok: false, reason: `spawn: ${errorMessage(e)}` });
    });
    proc.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (code === 0) finish({ ok: true });
      else
        finish({
          ok: false,
          reason: `ffmpeg exited ${code}: ${stderr.trim().slice(-300)}`,
        });
    });
  });
}

/** Only a short, dot-led, alphanumeric extension reaches a temp filename. */
function safeExt(ext: string | null | undefined): string {
  const e = (ext || '').trim().toLowerCase();
  return /^\.[a-z0-9]{1,8}$/.test(e) ? e : '';
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
