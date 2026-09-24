/**
 * transcode-profile.ts — the SIGNAGE PROFILE for uploaded video, as pure functions
 * (2026-09-23, 4K uploads). No Nest, no I/O, no ffmpeg: everything here is
 * decided from an ffprobe JSON document and a byte count, so the whole policy
 * is unit-testable on a runner that has no ffmpeg (CI runners are not
 * guaranteed to ship it; the production image is — the Dockerfile hard-fails
 * without ffmpeg, ffprobe and libx264).
 *
 * THE PROFILE (what a screen actually needs, never more):
 *   • H.264 High, 8-bit 4:2:0 (`yuv420p`) — the one codec every player target
 *     decodes in hardware: Android WebView, the Taurus LED controllers, Safari,
 *     Edge. MP4 with `+faststart` (the index up front, so playback starts before
 *     the file finishes arriving).
 *   • RESOLUTION RUNG from the SHORT side (so portrait video is judged the same
 *     way as landscape): a source whose short side is ≥ 2160 (4K UHD and up) is
 *     encoded at 2160; everything else is capped at 1080. Never upscaled.
 *   • Quality-targeted with a ceiling: `-crf 21` plus `-maxrate`/`-bufsize`
 *     — ~8 Mbps at 1080, ~16 Mbps at 2160. CRF spends bits where the picture
 *     needs them; the cap stops a noisy 4K camera file from staying near its
 *     camera bitrate.
 *   • Frame-rate ceiling: 60 fps at 1080, 30 fps at 2160. H.264 2160p60 needs
 *     level 5.2, which many signage SoCs cannot decode in hardware (they do 4K60
 *     only for HEVC/VP9); a 240 fps phone slow-mo clip has no business on a wall.
 *   • AAC 128 kbps stereo when the source has audio; metadata stripped (phone
 *     video carries GPS location in its tags).
 *
 * THE RULE THE CALLER ENFORCES WITH THESE: swap only when the output is
 * SMALLER than the source AND `verifyTranscodeOutput` proves it is complete
 * (same duration, still has its audio, the dimensions the plan asked for).
 * A truncated encode (a killed ffmpeg, the `-fs` disk bound tripping) is
 * smaller too — the duration check is what stops it from ever reaching a screen.
 */

/** x264 CRF for the signage profile. Lower = bigger / better; 21 is visually clean on a wall. */
export const TRANSCODE_CRF = 21;
/** x264 preset: the speed/size trade for a shared server CPU. */
export const TRANSCODE_PRESET = 'veryfast';
/** Encoder + decoder threads. The API process also delivers lockdown alerts — never take every core. */
export const TRANSCODE_THREADS = 2;
export const AUDIO_BITRATE = '128k';

export interface RungSpec {
  /** Target SHORT side in pixels. */
  shortSide: 1080 | 2160;
  maxrateBps: number;
  bufsizeBps: number;
  fpsCap: number;
  label: '1080p' | '2160p';
}

export const RUNG_1080: RungSpec = {
  shortSide: 1080,
  maxrateBps: 8_000_000,
  bufsizeBps: 16_000_000,
  fpsCap: 60,
  label: '1080p',
};
export const RUNG_2160: RungSpec = {
  shortSide: 2160,
  maxrateBps: 16_000_000,
  bufsizeBps: 32_000_000,
  fpsCap: 30,
  label: '2160p',
};

/** What we need from ffprobe, normalised. Dimensions are DISPLAY dimensions (rotation applied). */
export interface ProbeResult {
  hasVideo: boolean;
  width: number | null;
  height: number | null;
  rotation: number;
  durationS: number | null;
  videoCodec: string | null;
  pixFmt: string | null;
  fps: number | null;
  /** Overall bits/s (format), falling back to the video stream's. */
  bitRate: number | null;
  hasAudio: boolean;
  audioCodec: string | null;
  formatName: string | null;
}

const num = (v: unknown): number | null => {
  const n =
    typeof v === 'number'
      ? v
      : typeof v === 'string' && v.trim() !== ''
        ? Number(v)
        : NaN;
  return Number.isFinite(n) ? n : null;
};

/** "30000/1001" → 29.97; "0/0" → null. */
export function parseRate(v: unknown): number | null {
  if (typeof v !== 'string') return num(v);
  const [a, b] = v.split('/');
  const n = Number(a);
  const d = b === undefined ? 1 : Number(b);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0 || n === 0)
    return null;
  return n / d;
}

/** Parse `ffprobe -print_format json -show_format -show_streams` output. Never throws. */
export function parseProbe(json: unknown): ProbeResult {
  const doc = (json && typeof json === 'object' ? json : {}) as Record<
    string,
    any
  >;
  const streams: any[] = Array.isArray(doc.streams) ? doc.streams : [];
  // First REAL video stream: attached cover art (a PNG inside an .m4a/.mp4) is not the video.
  const v = streams.find(
    (s) => s?.codec_type === 'video' && !(s?.disposition?.attached_pic === 1),
  );
  const a = streams.find((s) => s?.codec_type === 'audio');
  const format = (
    doc.format && typeof doc.format === 'object' ? doc.format : {}
  ) as Record<string, any>;

  let rotation = 0;
  if (v) {
    const sd: any[] = Array.isArray(v.side_data_list) ? v.side_data_list : [];
    const fromSide = sd.map((x) => num(x?.rotation)).find((x) => x !== null);
    const fromTag = num(v.tags?.rotate);
    rotation = fromSide ?? fromTag ?? 0;
  }
  const quarterTurn = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const w = v ? num(v.width) : null;
  const h = v ? num(v.height) : null;

  const durationS = num(format.duration) ?? (v ? num(v.duration) : null);
  return {
    hasVideo: !!v,
    width: quarterTurn ? h : w,
    height: quarterTurn ? w : h,
    rotation,
    durationS: durationS !== null && durationS > 0 ? durationS : null,
    videoCodec: v?.codec_name ? String(v.codec_name).toLowerCase() : null,
    pixFmt: v?.pix_fmt ? String(v.pix_fmt).toLowerCase() : null,
    fps: v ? (parseRate(v.avg_frame_rate) ?? parseRate(v.r_frame_rate)) : null,
    bitRate: num(format.bit_rate) ?? (v ? num(v.bit_rate) : null),
    hasAudio: !!a,
    audioCodec: a?.codec_name ? String(a.codec_name).toLowerCase() : null,
    formatName:
      typeof format.format_name === 'string'
        ? format.format_name.toLowerCase()
        : null,
  };
}

/** The ffprobe argv (JSON out, format + streams). */
export function buildProbeArgs(input: string): string[] {
  return [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    input,
  ];
}

export interface TranscodePlan {
  rung: RungSpec;
  /** Output DISPLAY dimensions, both even. */
  width: number;
  height: number;
  /** Set when the source exceeds the rung's frame-rate ceiling. */
  fps: number | null;
  hasAudio: boolean;
}

export type PlanDecision =
  | { action: 'transcode'; plan: TranscodePlan }
  | {
      action: 'skip';
      reason: 'no-video-stream' | 'unknown-dimensions' | 'already-optimal';
    };

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** Which rung a source belongs on, from its short side. */
export function rungFor(width: number, height: number): RungSpec {
  return Math.min(width, height) >= RUNG_2160.shortSide ? RUNG_2160 : RUNG_1080;
}

/**
 * Decide what to do with a probed source. `already-optimal` means the source
 * already IS the profile (H.264 8-bit 4:2:0 in MP4, within the rung's size,
 * frame rate and bitrate, AAC/MP3 or no audio) — re-encoding it would burn a
 * server CPU for a file that is the same size or bigger.
 */
export function planTranscode(probe: ProbeResult): PlanDecision {
  if (!probe.hasVideo) return { action: 'skip', reason: 'no-video-stream' };
  if (!probe.width || !probe.height)
    return { action: 'skip', reason: 'unknown-dimensions' };
  const rung = rungFor(probe.width, probe.height);
  const short = Math.min(probe.width, probe.height);
  const scale = short > rung.shortSide ? rung.shortSide / short : 1;
  let width = even(probe.width * scale);
  let height = even(probe.height * scale);
  // Pin the short side to exactly the rung when we downscale (float rounding must not give 2158).
  if (scale < 1) {
    if (probe.width <= probe.height) width = rung.shortSide;
    else height = rung.shortSide;
  }
  const fps =
    probe.fps !== null && probe.fps > rung.fpsCap + 0.01 ? rung.fpsCap : null;

  const alreadyOptimal =
    probe.videoCodec === 'h264' &&
    probe.pixFmt === 'yuv420p' &&
    (probe.formatName ?? '').includes('mp4') &&
    short <= rung.shortSide &&
    fps === null &&
    probe.bitRate !== null &&
    probe.bitRate <= rung.maxrateBps * 1.1 &&
    (!probe.hasAudio ||
      probe.audioCodec === 'aac' ||
      probe.audioCodec === 'mp3');
  if (alreadyOptimal) return { action: 'skip', reason: 'already-optimal' };

  return {
    action: 'transcode',
    plan: { rung, width, height, fps, hasAudio: probe.hasAudio },
  };
}

/** A second, decoder-safe copy for panels with at most a 1920×1080 framebuffer. */
export function plan1080Rendition(probe: ProbeResult): TranscodePlan | null {
  if (!probe.hasVideo || !probe.width || !probe.height) return null;
  const long = Math.max(probe.width, probe.height);
  const short = Math.min(probe.width, probe.height);
  if (long <= 1920 && short <= 1080) return null;
  const scale = Math.min(1, 1920 / long, 1080 / short);
  return {
    rung: RUNG_1080,
    width: even(probe.width * scale),
    height: even(probe.height * scale),
    fps: probe.fps !== null && probe.fps > 30.01 ? 30 : null,
    hasAudio: probe.hasAudio,
  };
}

/**
 * The ffmpeg argv for one transcode. `sizeLimitBytes` becomes `-fs`: ffmpeg
 * stops writing once the output reaches the SOURCE's size — an output that big
 * could never be swapped in anyway, and it bounds the temp disk to ~2× the
 * source. (A stopped encode is truncated; `verifyTranscodeOutput` rejects it.)
 */
export function buildTranscodeArgs(
  input: string,
  output: string,
  plan: TranscodePlan,
  opts: { sizeLimitBytes: number; threads?: number; level?: string },
): string[] {
  const threads = String(opts.threads ?? TRANSCODE_THREADS);
  const filters = [`scale=${plan.width}:${plan.height}:flags=lanczos`];
  if (plan.fps !== null) filters.push(`fps=${plan.fps}`);
  filters.push('format=yuv420p');
  return [
    '-hide_banner',
    '-nostdin',
    '-loglevel',
    'error',
    '-y',
    '-threads',
    threads,
    '-i',
    input,
    // First real video stream; first audio stream if there is one. Subtitle,
    // data and attachment streams are dropped, and so is every tag (GPS).
    '-map',
    '0:V:0',
    '-map',
    '0:a:0?',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-sn',
    '-dn',
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-profile:v',
    'high',
    ...(opts.level ? ['-level:v', opts.level] : []),
    '-preset',
    TRANSCODE_PRESET,
    '-crf',
    String(TRANSCODE_CRF),
    '-maxrate',
    String(plan.rung.maxrateBps),
    '-bufsize',
    String(plan.rung.bufsizeBps),
    '-threads',
    threads,
    ...(plan.hasAudio
      ? ['-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ac', '2']
      : ['-an']),
    '-movflags',
    '+faststart',
    '-fs',
    String(Math.max(1, Math.floor(opts.sizeLimitBytes))),
    '-progress',
    'pipe:1',
    '-nostats',
    output,
  ];
}

const MIN = 60_000;
/** Wall-clock budget floor / ceiling for one transcode. */
export const TRANSCODE_TIMEOUT_MIN_MS = 10 * MIN;
export const TRANSCODE_TIMEOUT_MAX_MS = 120 * MIN;
/** Seconds of wall clock allowed per second of video (0.125× realtime on a slow shared core). */
export const TRANSCODE_WALL_PER_MEDIA_SECOND = 8;

/** The SIGKILL budget for a source of this duration. */
export function transcodeTimeoutMs(durationS: number | null): number {
  if (durationS === null || !Number.isFinite(durationS) || durationS <= 0)
    return 60 * MIN;
  const want = durationS * TRANSCODE_WALL_PER_MEDIA_SECOND * 1000;
  return Math.round(
    Math.min(
      TRANSCODE_TIMEOUT_MAX_MS,
      Math.max(TRANSCODE_TIMEOUT_MIN_MS, want),
    ),
  );
}

/** Temp disk a job needs: the source, an output bounded by `-fs` at the source's size, and headroom. */
export function tempBytesNeeded(sourceBytes: number): number {
  return sourceBytes * 2 + 256 * 1024 * 1024;
}

export type OutputVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Prove an output is the WHOLE video before it may replace the original:
 * H.264 4:2:0, the planned dimensions, the source's duration (±max(1 s, 2 %)),
 * and still carrying audio when the source had it.
 */
export function verifyTranscodeOutput(
  source: ProbeResult,
  out: ProbeResult,
  plan: TranscodePlan,
): OutputVerdict {
  if (!out.hasVideo) return { ok: false, reason: 'output-has-no-video' };
  if (out.videoCodec !== 'h264')
    return { ok: false, reason: `output-codec-${out.videoCodec ?? 'unknown'}` };
  if (out.pixFmt !== 'yuv420p')
    return { ok: false, reason: `output-pixfmt-${out.pixFmt ?? 'unknown'}` };
  if (out.width !== plan.width || out.height !== plan.height) {
    return {
      ok: false,
      reason: `output-dims-${out.width}x${out.height}-expected-${plan.width}x${plan.height}`,
    };
  }
  if (source.hasAudio && !out.hasAudio)
    return { ok: false, reason: 'output-lost-audio' };
  if (out.durationS === null)
    return { ok: false, reason: 'output-duration-unknown' };
  if (source.durationS !== null) {
    const tolerance = Math.max(1, source.durationS * 0.02);
    if (Math.abs(out.durationS - source.durationS) > tolerance) {
      return {
        ok: false,
        reason: `output-duration-${out.durationS.toFixed(2)}s-vs-source-${source.durationS.toFixed(2)}s`,
      };
    }
  }
  return { ok: true };
}

/**
 * Fold ffmpeg `-progress pipe:1` output (key=value lines) into the latest
 * position in seconds. Returns null when the chunk carries no position.
 */
export function progressSecondsFrom(chunk: string): number | null {
  let latest: number | null = null;
  for (const line of chunk.split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (key === 'out_time_us' || key === 'out_time_ms') {
      // ffmpeg reports BOTH in microseconds (out_time_ms is a historical misnomer).
      const us = Number(value);
      if (Number.isFinite(us) && us >= 0) latest = us / 1_000_000;
    } else if (key === 'out_time' && latest === null) {
      const m = /^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(value);
      if (m) latest = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    }
  }
  return latest;
}

/** Percentage (0–99 while running; 100 is only ever written by the completion path). */
export function progressPercent(
  positionS: number,
  durationS: number | null,
): number | null {
  if (durationS === null || durationS <= 0 || !Number.isFinite(positionS))
    return null;
  return Math.max(0, Math.min(99, Math.floor((positionS / durationS) * 100)));
}
