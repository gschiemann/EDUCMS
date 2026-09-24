/**
 * video-probe.ts — read what an uploaded video IS (frame size, duration, codec,
 * frame rate, rotation) with ffprobe, so `Asset.processingMeta` carries real
 * dimensions for a video the way sharp already records them for an image.
 *
 * WHY THIS EXISTS: `Asset` has no width/height columns. The media library reads
 * `processingMeta.processedDimensions ?? processingMeta.originalDimensions`
 * (`metaDims` in the assets page), and the ONLY writer of that JSON was the
 * sharp image optimizer — so every video row had NULL meta and the detail
 * panel's RESOLUTION tile said "—" for a 257 MB, 1920×1080 clip (operator
 * screenshot, 2026-09-24). The client-side fallback measures with
 * `new Image()`, which is image-only by design. This module makes the number.
 *
 * DESIGN RULES — deliberately the same shape as video-poster.ts, the other
 * plain-Node ffmpeg-family module here:
 *
 *  1. **It NEVER throws and it NEVER blocks an upload.** Every path resolves a
 *     `ProbeOutcome` — `{ ok: true, … }` or `{ ok: false, reason }`. A video
 *     without dimensions is an em dash in a panel; an upload that fails
 *     because ffprobe choked on a container is a broken product.
 *  2. **Hard-bounded.** ffprobe is SIGKILLed at `MEDIA_PROBE_TIMEOUT_MS`
 *     (default 15 s, under the poster's 20 s: it reads container headers, not
 *     frames, so anything longer is a wedged http read, not work).
 *  3. **No Nest, no DI, no @prisma/client.** Plain Node so the backfill script
 *     imports it under `tsx` without the API's module graph — one definition
 *     of the ffprobe argv AND of the JSON → `processingMeta` mapping, not two
 *     that drift.
 *  4. **A URL source must be proven ours.** `probeVideoFromUrl` refuses any
 *     URL outside the caller-built trusted prefix, exactly like the poster
 *     module: a stored `Asset.fileUrl` can be an arbitrary external address
 *     (`POST /assets/url`), and ffprobe speaks every protocol ffmpeg does, so
 *     feeding it a stored value is an SSRF surface. Callers rebuild the URL
 *     from `SUPABASE_URL` + the storage path; the stored value never gets in.
 *  5. **Display dimensions, not coded ones.** A phone clip shot in portrait is
 *     STORED as 1920×1080 with a 90° rotation flag and PLAYS as 1080×1920.
 *     Callers persist `displayWidth × displayHeight` (what the board shows);
 *     the coded size and the angle ride along under `probe` for forensics.
 */
import { spawn as nodeSpawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** SIGKILL budget for one probe. Headers only — 15 s is already generous. */
export const PROBE_TIMEOUT_MS = intEnv('MEDIA_PROBE_TIMEOUT_MS', 15_000);

/**
 * ffprobe prints only the entries we ask for; one stream + one format section
 * is a few hundred bytes. The cap is a memory ceiling against a pathological
 * container, not a size we expect to reach.
 */
const MAX_STDOUT_BYTES = 256 * 1024;

export type ProbeSuccess = {
  ok: true;
  /** Coded frame size as stored in the stream — BEFORE the rotation flag. */
  width: number;
  height: number;
  /** What a player shows: width/height swapped when rotation is 90° or 270°. */
  displayWidth: number;
  displayHeight: number;
  /** Stream duration, else container duration; null when neither is known. */
  durationMs: number | null;
  /** e.g. "h264", "hevc", "vp9". */
  codec: string | null;
  /** Average frame rate, e.g. 29.97; null when the container does not say. */
  fps: number | null;
  /** Normalised to 0 | 90 | 180 | 270 (a -90 display matrix reports 270). */
  rotation: number;
};

export type ProbeOutcome = ProbeSuccess | { ok: false; reason: string };

/** Injectable for tests — same shape as `child_process.spawn`. */
export type SpawnLike = typeof nodeSpawn;

export interface ProbeOptions {
  spawnFn?: SpawnLike;
  timeoutMs?: number;
}

/**
 * Build the ffprobe argv. Exported so a unit test can pin the contract without
 * a binary on the box — CI runners are not guaranteed to ship ffprobe; the
 * production image is (Dockerfile hard-fails the build without it).
 *
 *  `-select_streams V:0` — the first REAL video stream. Capital V excludes
 *  attached cover art, which would otherwise report a 600×600 JPEG as the
 *  "video" of an audio-ish container (same reason the poster uses `0:V:0`).
 *  `stream_side_data=rotation` is where ffprobe ≥ 5 reports the display-matrix
 *  angle; `stream_tags=rotate` is the legacy tag older muxers wrote. Both are
 *  requested so one parser covers every ffprobe the fleet of images has run.
 *  `format=duration` is the fallback for containers (WebM/Matroska) whose
 *  video stream carries no duration of its own.
 */
export function buildProbeArgs(input: string): string[] {
  return [
    '-v',
    'error',
    '-select_streams',
    'V:0',
    '-show_entries',
    'stream=width,height,codec_name,avg_frame_rate,duration' +
      ':stream_side_data=rotation:stream_tags=rotate:format=duration',
    '-of',
    'json',
    input,
  ];
}

/**
 * Probe bytes already in memory (the multipart upload path). `ext` only seeds
 * the temp filename so ffprobe's demuxer detection gets a hint.
 */
export async function probeVideoFromBuffer(
  buffer: Buffer,
  ext: string | null | undefined,
  opts: ProbeOptions = {},
): Promise<ProbeOutcome> {
  if (!buffer || buffer.length === 0)
    return { ok: false, reason: 'empty-buffer' };
  let dir: string | null = null;
  try {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'edu-probe-in-'));
    const inPath = path.join(dir, `in${safeExt(ext) || '.mp4'}`);
    await fs.writeFile(inPath, buffer);
    return await probeInput(inPath, opts);
  } catch (e) {
    return { ok: false, reason: `temp-io: ${errorMessage(e)}` };
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Probe by pointing ffprobe straight at an object URL — the cheap path for the
 * presign flow and the backfill, where the bytes live in Supabase. ffprobe
 * reads the container index (a faststart MP4's `moov` is at the front; one
 * muxed the other way costs a range request to the tail), never the frames,
 * so a 257 MB clip is probed for a few hundred KB of egress.
 *
 * `trustedPrefix` MUST be a prefix the caller constructed itself (e.g.
 * `${SUPABASE_URL}/storage/v1/object/public/assets/`). A URL outside it is
 * refused without spawning anything.
 */
export async function probeVideoFromUrl(
  url: string,
  trustedPrefix: string,
  opts: ProbeOptions = {},
): Promise<ProbeOutcome> {
  if (typeof url !== 'string' || !url) return { ok: false, reason: 'no-url' };
  if (!trustedPrefix || !url.startsWith(trustedPrefix)) {
    return { ok: false, reason: 'untrusted-source-url' };
  }
  return probeInput(url, opts);
}

/** Shared core: run ffprobe on one input, turn its JSON into an outcome. */
async function probeInput(
  input: string,
  opts: ProbeOptions,
): Promise<ProbeOutcome> {
  try {
    const run = await runFfprobe(buildProbeArgs(input), opts);
    if (!run.ok) return run;
    return parseProbeJson(run.stdout);
  } catch (e) {
    return { ok: false, reason: `probe: ${errorMessage(e)}` };
  }
}

/**
 * Turn ffprobe's `-of json` output into a `ProbeOutcome`. Exported so the
 * shapes (no rotation, `side_data_list` rotation, legacy `tags.rotate`,
 * missing width, garbage) are pinned by tests without a binary. Never throws.
 */
export function parseProbeJson(stdout: string): ProbeOutcome {
  let doc: unknown;
  try {
    doc = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: 'ffprobe-output-not-json' };
  }
  if (!isRecord(doc)) return { ok: false, reason: 'ffprobe-output-not-json' };

  const streams = Array.isArray(doc.streams) ? doc.streams : [];
  const stream = streams.find(isRecord);
  if (!stream) return { ok: false, reason: 'no-video-stream' };

  const width = asPositiveInt(stream.width);
  const height = asPositiveInt(stream.height);
  if (width === null || height === null) {
    return { ok: false, reason: 'no-video-dimensions' };
  }

  const rotation = readRotation(stream);
  const swap = rotation === 90 || rotation === 270;

  const format = isRecord(doc.format) ? doc.format : null;
  const durationMs =
    asDurationMs(stream.duration) ?? asDurationMs(format?.duration) ?? null;

  return {
    ok: true,
    width,
    height,
    displayWidth: swap ? height : width,
    displayHeight: swap ? width : height,
    durationMs,
    codec: typeof stream.codec_name === 'string' ? stream.codec_name : null,
    fps: asFps(stream.avg_frame_rate),
    rotation,
  };
}

/**
 * ffprobe ≥ 5 reports the display matrix under `side_data_list[].rotation`
 * (signed: a clockwise-90 phone clip is `-90`); older muxers wrote the
 * `rotate` tag as a string. The side data wins when both exist — it is what
 * the decoder actually honours. Anything unparseable is "no rotation".
 */
function readRotation(stream: Record<string, unknown>): number {
  const sideData = Array.isArray(stream.side_data_list)
    ? stream.side_data_list
    : [];
  for (const entry of sideData) {
    if (!isRecord(entry)) continue;
    const r = asFiniteNumber(entry.rotation);
    if (r !== null) return normaliseAngle(r);
  }
  const tags = isRecord(stream.tags) ? stream.tags : null;
  const legacy = asFiniteNumber(tags?.rotate);
  return legacy === null ? 0 : normaliseAngle(legacy);
}

/** -90 → 270, 450 → 90, 180 → 180; only right angles ever swap the axes. */
function normaliseAngle(deg: number): number {
  return ((Math.round(deg) % 360) + 360) % 360;
}

/** ffprobe writes seconds as a decimal string ("2.000000"); null unless > 0. */
function asDurationMs(v: unknown): number | null {
  const sec = asFiniteNumber(v);
  return sec !== null && sec > 0 ? Math.round(sec * 1000) : null;
}

/** "30000/1001" → 29.97; "0/0" (unknown) → null. */
function asFps(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const [numRaw, denRaw = '1'] = v.split('/');
  const num = Number(numRaw);
  const den = Number(denRaw);
  if (!Number.isFinite(num) || !Number.isFinite(den) || num <= 0 || den <= 0)
    return null;
  return Math.round((num / den) * 1000) / 1000;
}

function asPositiveInt(v: unknown): number | null {
  const n = asFiniteNumber(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}

function asFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ── processingMeta mapping ──────────────────────────────────────────────────
// The API service and the backfill script both write the SAME keys; keeping
// the mapping here (plain Node) is what stops the two from drifting.

/** The keys one successful probe writes into `Asset.processingMeta`. */
export interface ProbeMeta {
  /** DISPLAY size — what `metaDims` on the assets page reads for a video. */
  originalDimensions: { w: number; h: number };
  /** Explicit null: a video is never re-encoded at upload, and the page reads
   *  `processedDimensions ?? originalDimensions`, so this must not shadow. */
  processedDimensions: null;
  durationMs: number | null;
  probe: {
    codec: string | null;
    fps: number | null;
    rotation: number;
    codedWidth: number;
    codedHeight: number;
  };
  /** ISO-8601, when the probe ran — the video equivalent of `transcodedAt`. */
  probedAt: string;
}

export function buildProbeMeta(
  outcome: ProbeSuccess,
  probedAt: Date = new Date(),
): ProbeMeta {
  return {
    originalDimensions: { w: outcome.displayWidth, h: outcome.displayHeight },
    processedDimensions: null,
    durationMs: outcome.durationMs,
    probe: {
      codec: outcome.codec,
      fps: outcome.fps,
      rotation: outcome.rotation,
      codedWidth: outcome.width,
      codedHeight: outcome.height,
    },
    probedAt: probedAt.toISOString(),
  };
}

/**
 * Merge a probe into whatever `processingMeta` already holds. Prisma's Json
 * column has no partial update, so the caller reads the row, merges here and
 * writes the whole value back; every key the probe does not own survives
 * (`originalSize`, `skippedReason`, a future field). Anything that is not a
 * JSON object — NULL, or garbage — is treated as empty rather than thrown at.
 */
export function mergeProbeMeta(
  existing: unknown,
  outcome: ProbeSuccess,
  probedAt: Date = new Date(),
): Record<string, unknown> & ProbeMeta {
  const base = isRecord(existing) ? existing : {};
  return { ...base, ...buildProbeMeta(outcome, probedAt) };
}

/**
 * Does this `processingMeta` already carry dimensions the page can show?
 * The backfill's candidate test AND its idempotency guard in one place: a row
 * that answers true is never probed again, whatever else it is missing.
 */
export function hasUsableDimensions(meta: unknown): boolean {
  if (!isRecord(meta)) return false;
  const d = meta.originalDimensions;
  // Real JSON numbers only — the same test as the media library's `metaDims`
  // (`typeof w === 'number'`) and the backfill SQL's `jsonb_typeof(...) =
  // 'number'`; a numeric STRING would count as "usable" here yet render "—".
  return isRecord(d) && isPositiveIntNumber(d.w) && isPositiveIntNumber(d.h);
}

function isPositiveIntNumber(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v > 0;
}

/** 75_400 → "1:15"; 3_725_000 → "1:02:05". For log lines and summaries. */
export function formatDurationMs(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return null;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`;
}

// ── process plumbing ────────────────────────────────────────────────────────

/**
 * Spawn ffprobe with a hard kill timer and capture its stdout. Mirrors the
 * poster module's runFfmpeg, but resolves an outcome carrying stdout instead
 * of a bare ok — the whole module is failure-tolerant by contract.
 */
function runFfprobe(
  args: string[],
  opts: ProbeOptions,
): Promise<{ ok: true; stdout: string } | { ok: false; reason: string }> {
  const spawnFn = opts.spawnFn ?? nodeSpawn;
  const timeoutMs = opts.timeoutMs ?? PROBE_TIMEOUT_MS;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (
      r: { ok: true; stdout: string } | { ok: false; reason: string },
    ) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    let proc: ReturnType<SpawnLike>;
    try {
      proc = spawnFn('ffprobe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      // A missing binary throws synchronously on some platforms.
      finish({ ok: false, reason: `spawn: ${errorMessage(e)}` });
      return;
    }
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      finish({ ok: false, reason: `timeout after ${timeoutMs}ms` });
    }, timeoutMs);
    proc.stdout?.on('data', (d: Buffer | string) => {
      if (stdout.length < MAX_STDOUT_BYTES) stdout += d.toString();
    });
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
      if (code === 0) finish({ ok: true, stdout });
      else
        finish({
          ok: false,
          reason: `ffprobe exited ${code}: ${stderr.trim().slice(-300)}`,
        });
    });
  });
}

/**
 * A thrown value's message without pretending it is an Error: a `reason`
 * string must never itself throw (e.g. on `undefined.message`).
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
