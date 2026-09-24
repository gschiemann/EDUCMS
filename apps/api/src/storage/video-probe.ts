/**
 * video-probe.ts — read what an uploaded video IS (frame size, duration, codec,
 * profile/level, pixel format, frame rate, bitrate, container, fast-start,
 * audio) with ffprobe, so `Asset.processingMeta` carries real dimensions for
 * a video the way sharp already records them for an image — and, since
 * probe version 2, every fact the signage-compatibility grader needs.
 *
 * WHY THIS EXISTS: `Asset` has no width/height columns. The media library reads
 * `processingMeta.processedDimensions ?? processingMeta.originalDimensions`
 * (`metaDims` in the assets page), and the ONLY writer of that JSON was the
 * sharp image optimizer — so every video row had NULL meta and the detail
 * panel's RESOLUTION tile said "—" for a 257 MB, 1920×1080 clip (operator
 * screenshot, 2026-09-24). The client-side fallback measures with
 * `new Image()`, which is image-only by design. This module makes the number.
 *
 * WHY VERSION 2 (operator, 2026-09-24): "The video was exported from Canva and
 * you really don't get any options besides resolution… why can't we check the
 * file for fps, the codec, and anything else that the signage might not
 * display properly… if the content doesn't meet spec we should at least warn
 * them." A signage box refuses (or stutters on) a 10-bit HEVC, a High 4:2:2
 * profile, a 60 fps 4K clip, a 40 Mbps bitrate, or an MP4 whose index sits at
 * the tail (no fast start — nothing renders until the whole file arrives).
 * The GRADER is a pure function elsewhere; this module's job is to record
 * every fact it reads, in one exact shape (`ProbeFacts`, `probeVersion: 2`).
 *
 * DESIGN RULES — deliberately the same shape as video-poster.ts, the other
 * plain-Node ffmpeg-family module here:
 *
 *  1. **It NEVER throws and it NEVER blocks an upload.** Every path resolves a
 *     `ProbeOutcome` — `{ ok: true, … }` or `{ ok: false, reason }`. A video
 *     without dimensions is an em dash in a panel; an upload that fails
 *     because ffprobe choked on a container is a broken product. The fast-
 *     start read is held to the same bar: any failure there is `null`, and a
 *     probe that already has its dimensions is never failed over it.
 *  2. **Hard-bounded.** ffprobe is SIGKILLed at `MEDIA_PROBE_TIMEOUT_MS`
 *     (default 15 s, under the poster's 20 s: it reads container headers, not
 *     frames, so anything longer is a wedged http read, not work). The one
 *     Range GET the fast-start check makes carries a 5 s AbortSignal.
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
 *     The fast-start Range GET re-asserts the same prefix before it fetches.
 *  5. **Display dimensions, not coded ones.** A phone clip shot in portrait is
 *     STORED as 1920×1080 with a 90° rotation flag and PLAYS as 1080×1920.
 *     Callers persist `displayWidth × displayHeight` (what the board shows);
 *     the coded size and the angle ride along under `probe` for forensics.
 *  6. **Cover art is not "the video".** Every stream is asked for (a probe
 *     needs the audio stream too), so the parser itself picks the first
 *     `codec_type: video` stream whose `disposition.attached_pic` is not set —
 *     the job `-select_streams V:0` used to do. An M4A with embedded cover art
 *     is "no video stream", never a 600×600 PNG "video".
 */
import { spawn as nodeSpawn } from 'child_process';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** SIGKILL budget for one probe. Headers only — 15 s is already generous. */
export const PROBE_TIMEOUT_MS = intEnv('MEDIA_PROBE_TIMEOUT_MS', 15_000);

/**
 * The shape marker written to `processingMeta.probe.probeVersion`. Bump it
 * when the recorded facts change; the backfill re-probes every video whose
 * marker differs (`hasCurrentProbe`), exactly once, and the API's upload-time
 * probe always writes the current one.
 */
export const PROBE_VERSION = 2 as const;

/** The buffer path walks this many leading bytes for the fast-start answer. */
export const FAST_START_SCAN_BYTES = 1024 * 1024;
/** The URL path issues ONE `Range: bytes=0-<this - 1>` GET for the same answer. */
export const FAST_START_RANGE_BYTES = 256 * 1024;
/** AbortSignal budget for that one request. */
export const FAST_START_FETCH_TIMEOUT_MS = 5_000;

/**
 * ffprobe prints only the entries we ask for; every stream of a normal file
 * plus the format section is a few KB. The cap is a memory ceiling against a
 * pathological container, not a size we expect to reach.
 */
const MAX_STDOUT_BYTES = 256 * 1024;

/** The first audio stream, or null when the file has none. */
export type ProbeAudio = {
  /** e.g. "aac", "opus", "mp3". */
  codec: string | null;
  channels: number | null;
  /** Hz, e.g. 48000. */
  sampleRate: number | null;
};

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
  /** ffprobe codec_name of the first real video stream: "h264", "hevc", "vp9", "av1", "prores", … */
  codec: string | null;
  /** ffprobe profile string: "High", "Main", "High 10", "High 4:2:2", "Main 10", … */
  profile: string | null;
  /** ffprobe level as reported (h264 41 = 4.1; -99 / unknown → null). */
  level: number | null;
  /** "yuv420p", "yuv420p10le", "yuv422p", … */
  pixFmt: string | null;
  /** Average frame rate (avg_frame_rate), e.g. 29.97; null when the container does not say. */
  fps: number | null;
  /** Nominal / base frame rate (r_frame_rate), e.g. 30. */
  nominalFps: number | null;
  /** true when both rates are known and differ by more than 0.5 %; null when either is unknown. */
  variableFrameRate: boolean | null;
  /** Video stream bit_rate, else container bit_rate, else size ÷ duration; null when none is known. */
  bitrateKbps: number | null;
  /** Normalised to 0 | 90 | 180 | 270 (a -90 display matrix reports 270). */
  rotation: number;
  /** format.format_name as reported: "mov,mp4,m4a,3gp,3g2,mj2", "matroska,webm", … */
  container: string | null;
  /**
   * ISO-BMFF (mp4 / mov / m4v / 3gp) only: true when the top-level `moov` box
   * precedes `mdat` (progressive playback), false when `mdat` comes first,
   * null for other containers or when the bytes could not be read.
   */
  fastStart: boolean | null;
  audio: ProbeAudio | null;
};

export type ProbeOutcome = ProbeSuccess | { ok: false; reason: string };

/** Injectable for tests — same shape as `child_process.spawn`. */
export type SpawnLike = typeof nodeSpawn;
/** Injectable for tests — same shape as Node's global `fetch`. */
export type FetchLike = typeof fetch;

export interface ProbeOptions {
  spawnFn?: SpawnLike;
  timeoutMs?: number;
  /** The ONE Range GET the URL path makes for the fast-start answer. Defaults to global fetch. */
  fetchFn?: FetchLike;
  /** AbortSignal budget for that request; defaults to FAST_START_FETCH_TIMEOUT_MS. */
  fastStartTimeoutMs?: number;
}

/**
 * Build the ffprobe argv. Exported so a unit test can pin the contract without
 * a binary on the box — CI runners are not guaranteed to ship ffprobe; the
 * production image is (Dockerfile hard-fails the build without it).
 *
 *  No `-select_streams`: the grader wants the first AUDIO stream too, so every
 *  stream is printed and the parser (`parseProbeJson`) picks the first real
 *  video stream itself — `codec_type: video` with `disposition.attached_pic`
 *  unset, which is what `V:0` (capital V) used to select for us.
 *  `stream_side_data=rotation` is where ffprobe ≥ 5 reports the display-matrix
 *  angle; `stream_tags=rotate` is the legacy tag older muxers wrote. Both are
 *  requested so one parser covers every ffprobe the fleet of images has run.
 *  `format=duration` is the fallback for containers (WebM/Matroska) whose
 *  video stream carries no duration of its own; `format=bit_rate,size` are the
 *  bitrate fallbacks; `format=format_name` is the container.
 */
export function buildProbeArgs(input: string): string[] {
  return [
    '-v',
    'error',
    '-show_entries',
    'stream=index,codec_type,codec_name,profile,level,pix_fmt,width,height,' +
      'avg_frame_rate,r_frame_rate,bit_rate,duration,channels,sample_rate' +
      ':stream_disposition=attached_pic' +
      ':stream_side_data=rotation' +
      ':stream_tags=rotate' +
      ':format=format_name,duration,bit_rate,size',
    '-of',
    'json',
    input,
  ];
}

/**
 * Probe bytes already in memory (the multipart upload path). `ext` only seeds
 * the temp filename so ffprobe's demuxer detection gets a hint. The fast-start
 * answer is read from the first `FAST_START_SCAN_BYTES` of the same bytes.
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
    return await probeInput(inPath, opts, {
      ext: safeExt(ext) || null,
      fastStart: () =>
        Promise.resolve(
          readIsoBmffFastStart(buffer.subarray(0, FAST_START_SCAN_BYTES)),
        ),
    });
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
 * so a 257 MB clip is probed for a few hundred KB of egress. For an ISO-BMFF
 * container the fast-start answer costs ONE more Range GET of the first
 * 256 KB (`fetchIsoBmffFastStart`), against the same trusted prefix.
 *
 * `trustedPrefix` MUST be a prefix the caller constructed itself (e.g.
 * `${SUPABASE_URL}/storage/v1/object/public/assets/`). A URL outside it is
 * refused without spawning — or fetching — anything.
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
  return probeInput(url, opts, {
    ext: extOfUrl(url),
    fastStart: () => fetchIsoBmffFastStart(url, trustedPrefix, opts),
  });
}

/** How a source answers the fast-start question once ffprobe has named the container. */
interface FastStartSource {
  /** Extension hint, used only when ffprobe did not report a container. */
  ext: string | null;
  /** Never throws by contract; anything it does throw is `null`. */
  fastStart(): Promise<boolean | null>;
}

/**
 * Shared core: run ffprobe on one input, turn its JSON into an outcome, then
 * — for an ISO-BMFF container only — attach the fast-start answer. A
 * fast-start read that fails leaves `fastStart: null` on an otherwise
 * successful probe; it can never turn the probe into a failure.
 */
async function probeInput(
  input: string,
  opts: ProbeOptions,
  source: FastStartSource,
): Promise<ProbeOutcome> {
  try {
    const run = await runFfprobe(buildProbeArgs(input), opts);
    if (!run.ok) return run;
    const parsed = parseProbeJson(run.stdout);
    if (!parsed.ok) return parsed;
    if (!isIsoBmffFamily(parsed.container, source.ext)) return parsed;
    let fastStart: boolean | null = null;
    try {
      fastStart = await source.fastStart();
    } catch {
      fastStart = null;
    }
    return { ...parsed, fastStart };
  } catch (e) {
    return { ok: false, reason: `probe: ${errorMessage(e)}` };
  }
}

/**
 * Turn ffprobe's `-of json` output into a `ProbeOutcome`. Exported so the
 * shapes (no rotation, `side_data_list` rotation, legacy `tags.rotate`,
 * cover art first, no audio, every bitrate fallback, garbage) are pinned by
 * tests without a binary. Never throws. `fastStart` is always null here —
 * ffprobe does not report it; the caller reads it from the bytes.
 */
export function parseProbeJson(stdout: string): ProbeOutcome {
  let doc: unknown;
  try {
    doc = JSON.parse(stdout);
  } catch {
    return { ok: false, reason: 'ffprobe-output-not-json' };
  }
  if (!isRecord(doc)) return { ok: false, reason: 'ffprobe-output-not-json' };

  const streams = (Array.isArray(doc.streams) ? doc.streams : []).filter(
    isRecord,
  );
  const stream = streams.find(isRealVideoStream);
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
  const fps = asFps(stream.avg_frame_rate);
  const nominalFps = asFps(stream.r_frame_rate);
  const audioStream = streams.find((s) => s.codec_type === 'audio') ?? null;

  return {
    ok: true,
    width,
    height,
    displayWidth: swap ? height : width,
    displayHeight: swap ? width : height,
    durationMs,
    codec: asName(stream.codec_name),
    profile: asName(stream.profile),
    level: asLevel(stream.level),
    pixFmt: asName(stream.pix_fmt),
    fps,
    nominalFps,
    variableFrameRate: detectVariableFrameRate(fps, nominalFps),
    bitrateKbps: readBitrateKbps(stream, format, durationMs),
    rotation,
    container: asName(format?.format_name),
    fastStart: null,
    audio: audioStream
      ? {
          codec: asName(audioStream.codec_name),
          channels: asPositiveInt(audioStream.channels),
          sampleRate: asPositiveInt(audioStream.sample_rate),
        }
      : null,
  };
}

/**
 * The first REAL video stream: `codec_type: video` and not cover art. ffprobe
 * marks embedded artwork (an M4A's album cover, an MP4's `covr` item) with
 * `disposition.attached_pic: 1`; picking it would report a 600×600 PNG as
 * "the video" of an audio file — the exact case `-select_streams V:0` guarded.
 */
function isRealVideoStream(stream: Record<string, unknown>): boolean {
  if (stream.codec_type !== 'video') return false;
  const disposition = isRecord(stream.disposition) ? stream.disposition : null;
  return asFiniteNumber(disposition?.attached_pic) !== 1;
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

/**
 * The stream's own bit_rate, else the container's, else what the file size
 * over the duration says; null when none of the three can be known. All in
 * kbit/s, rounded to a whole number — a grader compares against a ceiling,
 * not a fraction, and `size × 8 ÷ durationMs` IS kbit/s already.
 */
function readBitrateKbps(
  stream: Record<string, unknown>,
  format: Record<string, unknown> | null,
  durationMs: number | null,
): number | null {
  const fromStream = asPositiveNumber(stream.bit_rate);
  if (fromStream !== null) return Math.round(fromStream / 1000);
  const fromFormat = asPositiveNumber(format?.bit_rate);
  if (fromFormat !== null) return Math.round(fromFormat / 1000);
  const size = asPositiveNumber(format?.size);
  if (size !== null && durationMs !== null && durationMs > 0) {
    return Math.round((size * 8) / durationMs);
  }
  return null;
}

/**
 * Variable frame rate, as far as a container can tell: the average rate over
 * the whole stream (`avg_frame_rate`) drifting from the nominal one
 * (`r_frame_rate`) by more than 0.5 %. 29.97 against 30 (an NTSC clip) is
 * 0.1 % — constant; 24 against 30 is not. Unknown when either is.
 */
function detectVariableFrameRate(
  fps: number | null,
  nominalFps: number | null,
): boolean | null {
  if (fps === null || nominalFps === null) return null;
  return Math.abs(fps - nominalFps) / nominalFps > 0.005;
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

/**
 * ffprobe's `level` is an int, `-99` when the codec has none or the file does
 * not say. Anything negative is "unknown"; the rest is passed through as
 * reported (h264 41 = 4.1, hevc 120 = 4.0) — decoding it is the grader's job.
 */
function asLevel(v: unknown): number | null {
  const n = asFiniteNumber(v);
  return n !== null && n >= 0 ? n : null;
}

/** A non-empty string that is not ffprobe's literal "unknown"; else null. */
function asName(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.toLowerCase() !== 'unknown' ? s : null;
}

function asPositiveInt(v: unknown): number | null {
  const n = asFiniteNumber(v);
  return n !== null && Number.isInteger(n) && n > 0 ? n : null;
}

function asPositiveNumber(v: unknown): number | null {
  const n = asFiniteNumber(v);
  return n !== null && n > 0 ? n : null;
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

// ── fast start: is the index at the front? ──────────────────────────────────

/** ffprobe's demuxer name for the whole QuickTime / MP4 family. */
const ISO_BMFF_FORMATS = new Set(['mov', 'mp4', 'm4a', '3gp', '3g2', 'mj2']);
const ISO_BMFF_EXTS = new Set([
  '.mp4',
  '.m4v',
  '.mov',
  '.m4a',
  '.3gp',
  '.3g2',
  '.mj2',
]);

/**
 * Is this an ISO-BMFF container, i.e. one where "fast start" means anything?
 * ffprobe's `format_name` decides when it is known ("mov,mp4,m4a,3gp,3g2,mj2"
 * is one demuxer for the whole family); the file extension is only the
 * fallback for a probe that reported no container at all.
 */
export function isIsoBmffFamily(
  container: string | null | undefined,
  ext: string | null | undefined,
): boolean {
  if (container) {
    return container
      .split(',')
      .some((t) => ISO_BMFF_FORMATS.has(t.trim().toLowerCase()));
  }
  return !!ext && ISO_BMFF_EXTS.has(ext.toLowerCase());
}

/**
 * Walk the TOP-LEVEL boxes of an ISO-BMFF prefix and say whether `moov` (the
 * index every player needs before it can show a frame) precedes `mdat` (the
 * samples). Pure; exported for its unit tests.
 *
 *   true  — `moov` seen before any `mdat`: progressive / "fast start"
 *   false — `mdat` seen first: the index is at the tail, so nothing renders
 *           over http until the whole file has arrived
 *   null  — not a box sequence we can read, or the window ended before
 *           either box appeared (a truncated or unknown structure)
 *
 * A box is a 4-byte big-endian size + 4-char type. Size 1 → a 64-bit
 * `largesize` follows the type; size 0 → the box extends to end of file.
 * Only the header of each box is read, so a 1 MB window answers for a 4 GB
 * file: `ftyp` is a few dozen bytes and the first of `moov` / `mdat` follows
 * it (with at most a `free` / `wide` in between).
 */
export function readIsoBmffFastStart(bytes: Buffer): boolean | null {
  const len = bytes.length;
  let off = 0;
  while (off + 8 <= len) {
    const size32 = bytes.readUInt32BE(off);
    const type = bytes.toString('latin1', off + 4, off + 8);
    if (!isBoxType(type)) return null;

    let size: number;
    if (size32 === 1) {
      if (off + 16 > len) return null; // largesize cut off — unreadable header
      const large = bytes.readBigUInt64BE(off + 8);
      if (large < 16n) return null;
      size =
        large > BigInt(Number.MAX_SAFE_INTEGER)
          ? Number.MAX_SAFE_INTEGER
          : Number(large);
    } else if (size32 === 0) {
      // Extends to EOF: this is the last box, so it decides or nothing does.
      if (type === 'moov') return true;
      if (type === 'mdat') return false;
      return null;
    } else if (size32 < 8) {
      return null; // no box is smaller than its own header
    } else {
      size = size32;
    }

    if (type === 'moov') return true;
    if (type === 'mdat') return false;
    off += size;
  }
  return null;
}

/** Box types are four printable ASCII bytes ("ftyp", "moov", "mdat", "uuid", …). */
function isBoxType(type: string): boolean {
  if (type.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    const c = type.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) return false;
  }
  return true;
}

/**
 * The URL path's fast-start read: ONE `Range: bytes=0-262143` GET against the
 * object URL, walked with `readIsoBmffFastStart`. Rules, each of which is
 * pinned by a test:
 *   - the URL must sit under the trusted prefix (re-asserted here, so this
 *     helper is safe on its own — a stored `fileUrl` is never fetched);
 *   - a 206 is the range; a 200 means the server ignored the header, so the
 *     body is read only up to the same 256 KB and the rest is cancelled —
 *     never the whole object;
 *   - a hard budget (`fastStartTimeoutMs`, default 5 s) aborts the request,
 *     and the promise is raced against it too, so even a fetch that ignores
 *     its signal cannot wedge the probe;
 *   - any other status, a thrown fetch, a rejected body → null. Never a throw.
 */
export async function fetchIsoBmffFastStart(
  url: string,
  trustedPrefix: string,
  opts: ProbeOptions = {},
): Promise<boolean | null> {
  if (
    !trustedPrefix ||
    typeof url !== 'string' ||
    !url.startsWith(trustedPrefix)
  )
    return null;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') return null;
  const timeoutMs = opts.fastStartTimeoutMs ?? FAST_START_FETCH_TIMEOUT_MS;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await withAbort(
      fetchFn(url, {
        method: 'GET',
        headers: { Range: `bytes=0-${FAST_START_RANGE_BYTES - 1}` },
        signal: ac.signal,
      }),
      ac.signal,
    );
    if (res.status !== 206 && res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const prefix = await withAbort(
      readBodyPrefix(res, FAST_START_RANGE_BYTES),
      ac.signal,
    );
    return prefix.length === 0 ? null : readIsoBmffFastStart(prefix);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolve `p`, or reject the moment `signal` aborts — whichever comes first. */
function withAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => reject(new Error('fast-start fetch timed out'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e instanceof Error ? e : new Error(String(e)));
      },
    );
  });
}

/**
 * Read at most `maxBytes` of a response body and cancel the rest. This is
 * what makes a 200 (the server ignored our Range) cost 256 KB, not the file.
 */
async function readBodyPrefix(
  res: Response,
  maxBytes: number,
): Promise<Buffer> {
  const body = res.body;
  if (!body) {
    return Buffer.from(await res.arrayBuffer()).subarray(0, maxBytes);
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.byteLength > 0) {
        chunks.push(
          Buffer.from(value.buffer, value.byteOffset, value.byteLength),
        );
        total += value.byteLength;
      }
    }
  } finally {
    reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

// ── processingMeta mapping ──────────────────────────────────────────────────
// The API service and the backfill script both write the SAME keys; keeping
// the mapping here (plain Node) is what stops the two from drifting.

/**
 * `processingMeta.probe` — probe version 2. THE contract the grader reads;
 * every key is always present (null when the container does not say).
 */
export interface ProbeFacts {
  probeVersion: typeof PROBE_VERSION;
  codec: string | null;
  profile: string | null;
  level: number | null;
  pixFmt: string | null;
  fps: number | null;
  nominalFps: number | null;
  variableFrameRate: boolean | null;
  bitrateKbps: number | null;
  rotation: number;
  codedWidth: number;
  codedHeight: number;
  container: string | null;
  fastStart: boolean | null;
  audio: ProbeAudio | null;
}

/** The keys one successful probe writes into `Asset.processingMeta`. */
export interface ProbeMeta {
  /** DISPLAY size — what `metaDims` on the assets page reads for a video. */
  originalDimensions: { w: number; h: number };
  /** Explicit null: a video is never re-encoded at upload, and the page reads
   *  `processedDimensions ?? originalDimensions`, so this must not shadow. */
  processedDimensions: null;
  durationMs: number | null;
  probe: ProbeFacts;
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
      probeVersion: PROBE_VERSION,
      codec: outcome.codec,
      profile: outcome.profile,
      level: outcome.level,
      pixFmt: outcome.pixFmt,
      fps: outcome.fps,
      nominalFps: outcome.nominalFps,
      variableFrameRate: outcome.variableFrameRate,
      bitrateKbps: outcome.bitrateKbps,
      rotation: outcome.rotation,
      codedWidth: outcome.width,
      codedHeight: outcome.height,
      container: outcome.container,
      fastStart: outcome.fastStart,
      audio: outcome.audio
        ? {
            codec: outcome.audio.codec,
            channels: outcome.audio.channels,
            sampleRate: outcome.audio.sampleRate,
          }
        : null,
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
 * A success also CLEARS an earlier failure stamp (`probeFailed`,
 * `probeFailedVersion`): facts and "the probe failed" must never coexist.
 */
export function mergeProbeMeta(
  existing: unknown,
  outcome: ProbeSuccess,
  probedAt: Date = new Date(),
): Record<string, unknown> & ProbeMeta {
  const base: Record<string, unknown> = isRecord(existing)
    ? { ...existing }
    : {};
  for (const key of PROBE_FAILURE_KEYS) delete base[key];
  return { ...base, ...buildProbeMeta(outcome, probedAt) };
}

// ── a FAILED probe stamps the row too ───────────────────────────────────────
// The dashboard grades playback from `processingMeta`: a video with no facts
// reads "Checking the encoding…" and the Media Library polls until either
// facts land or `probedAt` is a string ("Encoding not checked yet"). A probe
// that fails and writes NOTHING therefore keeps an unreadable file polling for
// ten minutes. So a failure writes the three keys below — and only those; the
// dimensions and any other key are untouched.

/** `probeFailed` is a short, single-line reason — a label, not a stack trace. */
export const PROBE_FAILURE_REASON_MAX = 160;

const PROBE_FAILURE_KEYS = ['probeFailed', 'probeFailedVersion'] as const;

/** The keys one FAILED probe writes into `Asset.processingMeta`. */
export interface ProbeFailureMeta {
  /** ISO-8601, when the probe ran — the same key a success writes, so the
   *  dashboard's "did a probe run?" test is one key either way. */
  probedAt: string;
  /** Why, e.g. "no-video-stream", "ffprobe exited 1: Invalid data found…". */
  probeFailed: string;
  /**
   * The probe version that failed. The backfill retries a failed row ONCE per
   * version: a failure stamped by an older version (or with no version at all)
   * is a candidate again, one stamped by the current version is not — a
   * permanently unreadable file must not be re-probed on every run.
   */
  probeFailedVersion: typeof PROBE_VERSION;
}

export function buildProbeFailureMeta(
  reason: string,
  probedAt: Date = new Date(),
): ProbeFailureMeta {
  return {
    probedAt: probedAt.toISOString(),
    probeFailed: shortReason(reason),
    probeFailedVersion: PROBE_VERSION,
  };
}

/**
 * Merge a failure stamp over whatever `processingMeta` already holds — the
 * same read → merge → write path as a success, so every other key survives
 * and `originalDimensions` etc. are never touched. Callers skip the write
 * entirely when the row already carries a current probe (`hasCurrentProbe`):
 * a stamp must never contradict facts that are already there.
 */
export function mergeProbeFailure(
  existing: unknown,
  reason: string,
  probedAt: Date = new Date(),
): Record<string, unknown> & ProbeFailureMeta {
  const base = isRecord(existing) ? existing : {};
  return { ...base, ...buildProbeFailureMeta(reason, probedAt) };
}

/** One line, trimmed, capped — a reason string must be a label, not a log. */
function shortReason(reason: string): string {
  const one = String(reason ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return (one || 'unknown').slice(0, PROBE_FAILURE_REASON_MAX);
}

/**
 * Does this `processingMeta` already carry dimensions the page can show?
 * The same test as the media library's `metaDims` (`typeof w === 'number'`)
 * and the backfill SQL's `jsonb_typeof(...) = 'number'`; a numeric STRING
 * would count as "usable" here yet render "—".
 */
export function hasUsableDimensions(meta: unknown): boolean {
  if (!isRecord(meta)) return false;
  const d = meta.originalDimensions;
  return isRecord(d) && isPositiveIntNumber(d.w) && isPositiveIntNumber(d.h);
}

/**
 * Does this `processingMeta` carry a probe of the CURRENT shape — usable
 * dimensions AND `probe.probeVersion === PROBE_VERSION`? A row that answers
 * true is never probed again; a row probed by an older version is probed
 * exactly once more, and then answers true.
 */
export function hasCurrentProbe(meta: unknown): boolean {
  if (!hasUsableDimensions(meta)) return false;
  const probe = (meta as Record<string, unknown>).probe;
  return isRecord(probe) && probe.probeVersion === PROBE_VERSION;
}

/**
 * Did the CURRENT probe version already fail on this row (`probeFailed` +
 * `probeFailedVersion === PROBE_VERSION`)? A failure with no version, or an
 * older one, does not count — it earns one more attempt.
 */
export function hasCurrentProbeFailure(meta: unknown): boolean {
  return (
    isRecord(meta) &&
    typeof meta.probeFailed === 'string' &&
    meta.probeFailedVersion === PROBE_VERSION
  );
}

/**
 * The backfill's candidate test and its idempotency guard in one place — the
 * in-process twin of `NEEDS_PROBE` in scripts/backfill-video-posters.ts. A
 * row needs a probe unless the current version has already produced facts
 * (`hasCurrentProbe`) or already failed on it (`hasCurrentProbeFailure`).
 */
export function needsProbe(meta: unknown): boolean {
  return !hasCurrentProbe(meta) && !hasCurrentProbeFailure(meta);
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

/**
 * One line of what a probe found, for the API log and the backfill summary:
 * "1920×1080 · 1:15 · h264 High L41 · 30 fps · 4523 kbps · moov first ·
 * aac 2ch (rotated 90°, coded 1080×1920)". Unknown facts are simply absent.
 */
export function describeProbe(p: ProbeSuccess): string {
  const parts = [`${p.displayWidth}×${p.displayHeight}`];
  const dur = formatDurationMs(p.durationMs);
  if (dur) parts.push(dur);
  if (p.codec) {
    parts.push(
      p.codec +
        (p.profile ? ` ${p.profile}` : '') +
        (typeof p.level === 'number' ? ` L${p.level}` : ''),
    );
  }
  if (p.fps)
    parts.push(`${p.fps} fps${p.variableFrameRate ? ' (variable)' : ''}`);
  if (p.bitrateKbps) parts.push(`${p.bitrateKbps} kbps`);
  if (typeof p.fastStart === 'boolean')
    parts.push(p.fastStart ? 'moov first' : 'moov last');
  if (p.audio) {
    parts.push(
      (p.audio.codec ?? 'audio') +
        (p.audio.channels ? ` ${p.audio.channels}ch` : ''),
    );
  }
  const rotated = p.rotation
    ? ` (rotated ${p.rotation}°, coded ${p.width}×${p.height})`
    : '';
  return parts.join(' · ') + rotated;
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

/** The extension of a URL's path ("…/abc.MP4?x=1" → ".mp4"), or null. */
function extOfUrl(url: string): string | null {
  try {
    const p = new URL(url).pathname;
    const dot = p.lastIndexOf('.');
    if (dot > p.lastIndexOf('/')) return safeExt(p.slice(dot)) || null;
  } catch {
    /* not a URL — no hint */
  }
  return null;
}

function intEnv(name: string, def: number): number {
  const v = parseInt(process.env[name] || '', 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}
