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
 *     way as landscape): a picture whose short side is ≥ 2160 (4K UHD and up) is
 *     encoded at 2160; everything else is capped at 1080. Never upscaled. No
 *     edge ever exceeds 4096 (hardware H.264 decoders stop there), and the rung
 *     is judged on the picture AFTER that cap — a 5120×2160 ultra-wide becomes a
 *     2560×1080 on the 1080 rung, never a 4096×1728 that would read as oversize.
 *     The H.264 level follows the frame: 4.2 up to 1080p, 5.1 up to 3840×2160 at
 *     30 fps, 5.2 for DCI 4096×2160 (`maxLevelFor`).
 *   • Quality-targeted with a ceiling: `-crf 21` plus `-maxrate`/`-bufsize`
 *     — ~8 Mbps at 1080, ~16 Mbps at 2160. CRF spends bits where the picture
 *     needs them; the cap stops a noisy 4K camera file from staying near its
 *     camera bitrate.
 *   • Frame-rate ceiling: 30 fps on both rungs (2026-10-04; it was 60 at 1080).
 *     30 is the kiosk-safe target the dashboard grades against
 *     (`@cms/api-types` video-encode.ts); the first customer video that played
 *     "very choppy" was a 60 fps export. A source at twice a normal rate (60 /
 *     59.94 / 50 / 48) is HALVED (30 / 29.97 / 25 / 24) so every second frame is
 *     dropped evenly; any other rate above 30 is brought to 30. A
 *     variable-frame-rate source is made constant.
 *   • Colour: BT.709 limited range, SDR, tagged as such. HDR10 / HLG / BT.2020,
 *     BT.601 and full-range sources are converted FROM what they are tagged as;
 *     an untagged HD source is read as BT.709 (`assumedSourceMatrix`), exactly
 *     as players read it.
 *   • AAC 128 kbps stereo when the source has audio; metadata stripped (phone
 *     video carries GPS location in its tags).
 *
 * COMPATIBILITY BEFORE SIZE (2026-10-04, the media beta-test campaign).
 * The owner's rule: "support as many files as possible but they must work
 * 100% of the time." Until now the output replaced the original ONLY when it
 * was smaller — so an HEVC, VP9, AV1, 10-bit, HDR, interlaced, anamorphic or
 * rotated source whose H.264 copy came out bigger (efficient codecs usually
 * do) was served to screens AS UPLOADED, and Android signage players do not
 * decode those. `screenCompatibilityIssues` names every reason a file is not
 * something every player decodes; when it names any, the transcode is
 * REQUIRED and its output replaces the original whatever its size. Only a
 * source that is already screen-safe is transcoded for size alone, and only
 * then does "swap only when smaller" apply.
 *
 * An output must itself be screen-safe: for every shape the planner can emit,
 * `screenCompatibilityIssues` of the output is empty (the spec sweeps this), so
 * a converted file is never converted again.
 *
 * WHAT THE CALLER STILL ENFORCES: `verifyTranscodeOutput` must prove the
 * output is complete (same duration, still has its audio, the planned
 * dimensions, upright, square pixels, standard colour) before any swap, and the
 * pipeline refuses an output that reached its `-fs` disk bound (ffmpeg exits 0
 * with a short file; a source of unknown duration has nothing to compare
 * against). A truncated encode never reaches a screen.
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
  fpsCap: 30,
  label: '1080p',
};
export const RUNG_2160: RungSpec = {
  shortSide: 2160,
  maxrateBps: 16_000_000,
  bufsizeBps: 32_000_000,
  fpsCap: 30,
  label: '2160p',
};

/** What we need from ffprobe, normalised. Dimensions are DISPLAY dimensions: square pixels, rotation applied (the stored size is `storedWidth` / `storedHeight`). */
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
  // ── facts the screen-compatibility check reads (2026-10-04) ──
  /** ffprobe profile ('High', 'High 10', 'Main 10', …) and level (41 = 4.1). */
  videoProfile: string | null;
  videoLevel: number | null;
  /** 'progressive', 'tt', 'bb', 'tb', 'bt' — null when ffprobe does not say. */
  fieldOrder: string | null;
  /** Pixel aspect ratio as a number; 1 = square pixels (also when unknown). */
  pixelAspect: number;
  /** ffprobe `color_space` — the YCbCr MATRIX ('bt709', 'smpte170m', 'bt2020nc', …); null when untagged. */
  colorSpace: string | null;
  colorTransfer: string | null;
  colorPrimaries: string | null;
  colorRange: string | null;
  /** The frame size as STORED: before the pixel aspect and any rotation are applied (null = unknown). */
  storedWidth: number | null;
  storedHeight: number | null;
  audioChannels: number | null;
  audioSampleRate: number | null;
  /** Average and nominal frame rates disagree: frames are not evenly spaced. */
  variableFrameRate: boolean;
  /** ISO-BMFF major brand: 'qt' for QuickTime (.mov), 'isom' / 'mp42' … for MP4. */
  majorBrand: string | null;
}

/** "4:3" → 1.333…; "1:1", "0:1", "N/A", garbage → 1. */
export function parsePixelAspect(v: unknown): number {
  if (typeof v !== 'string') return 1;
  const m = /^(\d+):(\d+)$/.exec(v.trim());
  if (!m) return 1;
  const n = Number(m[1]);
  const d = Number(m[2]);
  if (!Number.isFinite(n) || !Number.isFinite(d) || n <= 0 || d <= 0) return 1;
  const r = n / d;
  return Math.abs(r - 1) < 0.005 ? 1 : r;
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
  const codedW = v ? num(v.width) : null;
  const h = v ? num(v.height) : null;
  // DISPLAY width in SQUARE pixels: an anamorphic 1440×1080 (pixel aspect 4:3)
  // is a 1920×1080 picture. Applied before the rotation swap — the pixel
  // aspect describes the stored (coded) orientation.
  const pixelAspect = v ? parsePixelAspect(v.sample_aspect_ratio) : 1;
  const w = codedW !== null ? Math.max(1, Math.round(codedW * pixelAspect)) : null;

  const durationS = num(format.duration) ?? (v ? num(v.duration) : null);
  const avgFps = v ? parseRate(v.avg_frame_rate) : null;
  const nominalFps = v ? parseRate(v.r_frame_rate) : null;
  const tags = (format.tags && typeof format.tags === 'object' ? format.tags : {}) as Record<string, any>;
  const brand = typeof tags.major_brand === 'string' ? tags.major_brand.trim().toLowerCase() : null;
  return {
    hasVideo: !!v,
    width: quarterTurn ? h : w,
    height: quarterTurn ? w : h,
    videoProfile: v?.profile ? String(v.profile) : null,
    videoLevel: v ? num(v.level) : null,
    fieldOrder: v?.field_order ? String(v.field_order).toLowerCase() : null,
    pixelAspect,
    colorSpace: v?.color_space ? String(v.color_space).toLowerCase() : null,
    colorTransfer: v?.color_transfer ? String(v.color_transfer).toLowerCase() : null,
    colorPrimaries: v?.color_primaries ? String(v.color_primaries).toLowerCase() : null,
    colorRange: v?.color_range ? String(v.color_range).toLowerCase() : null,
    storedWidth: codedW,
    storedHeight: h,
    audioChannels: a ? num(a.channels) : null,
    audioSampleRate: a ? num(a.sample_rate) : null,
    // Same rule as the upload probe (video-probe.ts): more than 2 % apart.
    variableFrameRate:
      avgFps !== null && nominalFps !== null && Math.abs(avgFps - nominalFps) / nominalFps > 0.02,
    majorBrand: brand || null,
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
  /** Output DISPLAY dimensions in square pixels, both even. */
  width: number;
  height: number;
  /** Set when the output frame rate must differ from the source's (too fast, or variable). */
  fps: number | null;
  hasAudio: boolean;
  /** The source is interlaced: fields are woven into whole frames before scaling. */
  deinterlace?: boolean;
  /**
   * The YCbCr matrix to ASSUME for a source that does not say (an untagged HD
   * file). swscale assumes BT.601 for an untagged frame whatever its size, so
   * an HD file — which every player decodes as BT.709 — would come out with
   * shifted colours (a red box 250 → 228). Set only when the source carries no
   * matrix tag and no HDR / BT.2020 signal; a tagged source is never overridden.
   */
  sourceMatrix?: 'bt709';
}

/**
 * Every reason a file is NOT something every signage player decodes. Android
 * WebView on the fleet's SoCs decodes H.264 8-bit 4:2:0 in hardware and little
 * else; anything listed here has been seen to show black, sideways, squashed,
 * washed out or stuttering on real screens, or is refused by them outright.
 */
export type ScreenCompatibilityIssue =
  | 'codec' // not H.264 (HEVC, VP8/9, AV1, ProRes, MPEG-2/4, WMV, …)
  | 'pixel-format' // 10-bit, 4:2:2, 4:4:4, alpha, …
  | 'colour-range' // full-range ("JPEG") levels: crushed or washed on hardware decoders
  | 'hdr' // PQ / HLG / BT.2020: wrong colours on an SDR decode path
  | 'container' // not MP4 (WebM, Matroska, AVI, QuickTime .mov, MPEG-TS, …)
  | 'level' // an H.264 level above what the picture size needs / decoders advertise
  | 'interlaced'
  | 'pixel-aspect' // anamorphic: non-square pixels are shown squashed
  | 'rotation' // a rotation tag the player would have to apply itself
  | 'frame-rate' // above 30 fps
  | 'variable-frame-rate'
  | 'oversize' // larger than the rung it belongs on
  | 'audio-codec'
  | 'audio-channels'
  | 'audio-sample-rate'
  | 'duration-unknown';

/** The longest edge any rung may carry (DCI 4K). Wider strips are scaled down to it. */
export const MAX_LONG_EDGE = 4096;
const INTERLACED_FIELD_ORDERS = new Set(['tt', 'bb', 'tb', 'bt']);
const HDR_TRANSFERS = new Set(['smpte2084', 'arib-std-b67', 'smpte428', 'bt2020-10', 'bt2020-12']);
const SCREEN_AUDIO_CODECS = new Set(['aac', 'mp3']);
const SCREEN_AUDIO_RATES = new Set([44_100, 48_000]);

/** H.264 Annex A, Table A-1: the macroblock rate (MaxMBPS) level 5.1 allows. */
const H264_LEVEL_5_1_MAX_MBPS = 983_040;

/**
 * The highest H.264 level a picture of this size may declare at ≤ 30 fps and
 * still count as screen-safe: 4.2 up to 1080p (what a 1080p decoder advertises),
 * above that the level the FRAME itself needs. 5.1 carries 983,040 macroblocks
 * a second — 3840×2160 at 30 fps (32,400 MBs) fits, 4096×2160 (34,560 MBs) does
 * not and is written as 5.2 (measured with x264, 2026-10-04). A cap below what
 * the encoder must write would flag this profile's own output as not
 * screen-safe — and a DCI-4K source would be "converted" forever.
 */
export function maxLevelFor(width: number, height: number): number {
  if (width * height <= 1920 * 1088) return 42;
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16);
  return macroblocks * 30 <= H264_LEVEL_5_1_MAX_MBPS ? 51 : 52;
}

const UNSPECIFIED_MATRIX = new Set(['', 'unknown', 'unspecified', 'reserved']);

/**
 * The YCbCr matrix to assume for a source that does not tag one, or undefined
 * when the source says (never override a tag) or swscale's own default is right.
 * Players read an untagged HD picture as BT.709 and an untagged SD picture as
 * BT.601; swscale reads every untagged picture as BT.601, so converting an
 * untagged HD file to BT.709 without this hint turns a pure red 250 into 228
 * (measured 2026-10-04, ffmpeg 8.1). The HD test is mpv's: width ≥ 1280 or
 * height > 576, on the STORED frame (a rotated or anamorphic SD file is still SD).
 * An HDR / BT.2020 signal without a matrix is left to swscale.
 */
export function assumedSourceMatrix(probe: ProbeResult): 'bt709' | undefined {
  if (probe.colorSpace && !UNSPECIFIED_MATRIX.has(probe.colorSpace)) return undefined;
  if (
    probe.colorPrimaries === 'bt2020' ||
    (probe.colorTransfer && HDR_TRANSFERS.has(probe.colorTransfer))
  ) return undefined;
  const w = probe.storedWidth ?? probe.width ?? 0;
  const h = probe.storedHeight ?? probe.height ?? 0;
  return w >= 1280 || h > 576 ? 'bt709' : undefined;
}

/** Why this file is not screen-safe as it is. Empty = every player decodes it. */
export function screenCompatibilityIssues(probe: ProbeResult): ScreenCompatibilityIssue[] {
  const out: ScreenCompatibilityIssue[] = [];
  if (!probe.hasVideo || !probe.width || !probe.height) return out;
  const short = Math.min(probe.width, probe.height);
  const long = Math.max(probe.width, probe.height);
  const rung = rungFor(probe.width, probe.height);

  if (probe.videoCodec !== 'h264') out.push('codec');
  const pix = probe.pixFmt ?? '';
  if (pix === 'yuvj420p' || probe.colorRange === 'pc' || probe.colorRange === 'jpeg') out.push('colour-range');
  if (pix && pix !== 'yuv420p' && pix !== 'yuvj420p') out.push('pixel-format');
  if (
    (probe.colorTransfer !== null && HDR_TRANSFERS.has(probe.colorTransfer)) ||
    probe.colorPrimaries === 'bt2020'
  ) out.push('hdr');
  // ffprobe names QuickTime and MP4 alike ("mov,mp4,m4a,…"); the major brand tells them apart.
  if (!(probe.formatName ?? '').includes('mp4') || probe.majorBrand === 'qt') out.push('container');
  if (
    probe.videoCodec === 'h264' && probe.videoLevel !== null &&
    probe.videoLevel > maxLevelFor(probe.width, probe.height)
  ) out.push('level');
  if (probe.fieldOrder !== null && INTERLACED_FIELD_ORDERS.has(probe.fieldOrder)) out.push('interlaced');
  if (Math.abs(probe.pixelAspect - 1) > 0.005) out.push('pixel-aspect');
  if (Math.round(probe.rotation) % 360 !== 0) out.push('rotation');
  if (probe.fps !== null && probe.fps > rung.fpsCap + 0.5) out.push('frame-rate');
  if (probe.variableFrameRate) out.push('variable-frame-rate');
  if (short > rung.shortSide || long > MAX_LONG_EDGE) out.push('oversize');
  if (probe.hasAudio) {
    if (!probe.audioCodec || !SCREEN_AUDIO_CODECS.has(probe.audioCodec)) out.push('audio-codec');
    if (probe.audioChannels !== null && probe.audioChannels > 2) out.push('audio-channels');
    if (probe.audioSampleRate !== null && !SCREEN_AUDIO_RATES.has(probe.audioSampleRate)) out.push('audio-sample-rate');
  }
  if (probe.durationS === null) out.push('duration-unknown');
  return out;
}

export type PlanDecision =
  | {
      action: 'transcode';
      plan: TranscodePlan;
      /**
       * true  — the source is not screen-safe: the output replaces it WHATEVER its size.
       * false — the source is screen-safe and only bigger than it needs to be: the
       *         output replaces it only when it is smaller.
       */
      required: boolean;
      issues: ScreenCompatibilityIssue[];
    }
  | {
      action: 'skip';
      reason: 'no-video-stream' | 'unknown-dimensions' | 'already-optimal';
    };

const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);

/** Which rung a source belongs on, from its short side. */
export function rungFor(width: number, height: number): RungSpec {
  return Math.min(width, height) >= RUNG_2160.shortSide ? RUNG_2160 : RUNG_1080;
}

/** The slowest rate a halved frame rate may land on: 47.952 → 23.976 is a real rate, 35 → 17.5 is not. */
const MIN_HALVED_FPS = 23.9;

/**
 * The output frame rate, or null to keep the source's. A source at TWICE a
 * normal rate — 60 / 59.94 / 50 / 48 / 47.952 — is halved (30 / 29.97 / 25 /
 * 24 / 23.976) so every second frame is dropped evenly; any other rate above
 * the cap (31–47 fps, 72, 90, 120, 240 …) goes to the cap; a variable rate
 * becomes its own average, constant. (The first cut halved everything up to
 * 61 fps, which turned a 35 fps source into 17.5 fps.)
 */
export function targetFps(probe: ProbeResult, cap: number): number | null {
  const fps = probe.fps;
  if (fps !== null && fps > cap + 0.5) {
    const half = fps / 2;
    return half >= MIN_HALVED_FPS && half <= cap + 0.5
      ? Math.round(half * 1000) / 1000
      : cap;
  }
  if (probe.variableFrameRate) {
    return fps !== null && fps >= 1 ? Math.min(cap, Math.round(fps * 1000) / 1000) : cap;
  }
  return null;
}

/**
 * Decide what to do with a probed source.
 *
 * `already-optimal` means the source already IS the profile — screen-safe on
 * every count (`screenCompatibilityIssues` is empty) and within the rung's
 * bitrate — so re-encoding it would burn a server CPU for nothing.
 */
export function planTranscode(probe: ProbeResult): PlanDecision {
  if (!probe.hasVideo) return { action: 'skip', reason: 'no-video-stream' };
  if (!probe.width || !probe.height)
    return { action: 'skip', reason: 'unknown-dimensions' };
  const short = Math.min(probe.width, probe.height);
  const long = Math.max(probe.width, probe.height);
  const longCap = long > MAX_LONG_EDGE ? MAX_LONG_EDGE / long : 1;
  // The rung belongs to the picture AS IT WILL BE after the long-edge cap: the
  // output must itself read as on its rung (`screenCompatibilityIssues` judges
  // it by the same short-side rule), and a 5120×2160 ultra-wide capped to
  // 4096×1728 is no longer a 2160-class picture — planned on the 2160 rung it
  // came out `oversize` and would be "converted" again forever.
  const rung = rungFor(probe.width * longCap, probe.height * longCap);
  const scale = Math.min(
    1,
    short > rung.shortSide ? rung.shortSide / short : 1,
    longCap,
  );
  let width = even(probe.width * scale);
  let height = even(probe.height * scale);
  // Pin the short side to exactly the rung when that is what bounded it (float rounding must not give 2158).
  if (scale < 1 && short * scale >= rung.shortSide - 1 && short > rung.shortSide) {
    if (probe.width <= probe.height) width = rung.shortSide;
    else height = rung.shortSide;
  }
  const issues = screenCompatibilityIssues(probe);
  const fps = targetFps(probe, rung.fpsCap);

  const withinBitrate =
    probe.bitRate !== null && probe.bitRate <= rung.maxrateBps * 1.1;
  if (issues.length === 0 && withinBitrate)
    return { action: 'skip', reason: 'already-optimal' };

  return {
    action: 'transcode',
    plan: {
      rung,
      width,
      height,
      fps,
      hasAudio: probe.hasAudio,
      deinterlace: issues.includes('interlaced'),
      sourceMatrix: assumedSourceMatrix(probe),
    },
    required: issues.length > 0,
    issues,
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
    fps: targetFps(probe, RUNG_1080.fpsCap),
    hasAudio: probe.hasAudio,
    sourceMatrix: assumedSourceMatrix(probe),
  };
}

/**
 * The ffmpeg argv for one transcode. `sizeLimitBytes` becomes `-fs`: ffmpeg
 * stops writing once the output reaches that size and exits 0 with a SHORT
 * file. For a size-only conversion the bound is the SOURCE's size (an output
 * that big could never be swapped in anyway); a required conversion gets more
 * room because H.264 can legitimately need more bits than HEVC / AV1 / VP9.
 * Either way a stopped encode is truncated — the caller refuses an output that
 * reached its bound, and `verifyTranscodeOutput` checks the duration.
 */
export function buildTranscodeArgs(
  input: string,
  output: string,
  plan: TranscodePlan,
  opts: { sizeLimitBytes: number; threads?: number; level?: string },
): string[] {
  const threads = String(opts.threads ?? TRANSCODE_THREADS);
  // The order is the contract (ffmpeg has already applied any rotation tag —
  // autorotate is on — so every filter sees the picture upright):
  //   1. interlaced → whole frames, before anything scales the fields together;
  //   2. ONE scale that also makes the pixels square (the plan's width/height
  //      are display dimensions) and converts the colour to BT.709 limited
  //      range. With the output transfer / primaries / matrix named, swscale
  //      (ffmpeg ≥ 8) converts FROM whatever the source is tagged as —
  //      HDR10 (PQ), HLG, BT.2020, BT.601, full range. Measured 2026-10-04 on
  //      the production build (ffmpeg 8.1.2): a red test box that today's
  //      chain turned into 134/82/55 comes back as 250/17/9; an SDR source is
  //      unchanged to within two code values. A TAGGED source is read as it
  //      says; an UNTAGGED HD source is declared BT.709 (`in_color_matrix`,
  //      plan.sourceMatrix) — swscale would read it as BT.601 and shift the
  //      colours;
  //   3. square-pixel flag; 4. frame rate; 5. 8-bit 4:2:0.
  const filters: string[] = [];
  if (plan.deinterlace) filters.push('bwdif=mode=send_frame:parity=auto:deint=all');
  filters.push(
    `scale=${plan.width}:${plan.height}:flags=lanczos` +
      (plan.sourceMatrix ? `:in_color_matrix=${plan.sourceMatrix}` : '') +
      ':out_color_matrix=bt709:out_primaries=bt709:out_transfer=bt709:out_range=tv',
  );
  filters.push('setsar=1');
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
    // The file SAYS what it is: players pick their colour path from these tags.
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-color_range',
    'tv',
    ...(plan.hasAudio
      ? ['-c:a', 'aac', '-b:a', AUDIO_BITRATE, '-ac', '2', '-ar', '48000']
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
/**
 * The same allowance for a REQUIRED conversion (the source is not screen-safe).
 *
 * MEASURED 2026-10-05 on the production image (ffmpeg 8.1.2) at two threads,
 * 10-second clips with moving detail and grain, wall-seconds per media-second:
 *   4K30 H.264 8-bit → 2160            0.8
 *   4K30 HEVC 8-bit → 2160             1.3
 *   4K60 HEVC 10-bit HLG / PQ → 2160   2.4   (what a phone records: three times the H.264 case)
 *   the same clip → 1080               1.1
 * Production runs the first case at 1.3–1.6 on a quiet box and 4–5 on a busy
 * one (`video_transcode_jobs`, September), so the phone clip lands at 4–15 —
 * past the 8 a size-only job gets. A size-only job that times out costs
 * nothing: its source already plays. A required one that times out leaves a
 * file no screen may be given, for a clip that was only slow. 20 covers the
 * busy box; the 120-minute ceiling still ends an encode that has hung.
 */
export const TRANSCODE_WALL_PER_MEDIA_SECOND_REQUIRED = 20;

/** The SIGKILL budget for a source of this duration. */
export function transcodeTimeoutMs(
  durationS: number | null,
  opts: { required?: boolean } = {},
): number {
  if (durationS === null || !Number.isFinite(durationS) || durationS <= 0)
    return 60 * MIN;
  const perMediaSecond = opts.required
    ? TRANSCODE_WALL_PER_MEDIA_SECOND_REQUIRED
    : TRANSCODE_WALL_PER_MEDIA_SECOND;
  const want = durationS * perMediaSecond * 1000;
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
 * still carrying audio when the source had it — and screen-safe on every
 * count `screenCompatibilityIssues` knows.
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
  if (Math.round(out.rotation) % 360 !== 0)
    return { ok: false, reason: `output-rotation-${out.rotation}` };
  if (Math.abs(out.pixelAspect - 1) > 0.005)
    return { ok: false, reason: 'output-pixel-aspect' };
  if (out.fps !== null && out.fps > plan.rung.fpsCap + 0.5)
    return { ok: false, reason: `output-fps-${out.fps.toFixed(2)}` };
  if (out.colorTransfer !== null && HDR_TRANSFERS.has(out.colorTransfer))
    return { ok: false, reason: `output-transfer-${out.colorTransfer}` };
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
  // Last, the whole definition: the file that is about to be called screen-ready
  // must read as screen-safe by the SAME rule that sent its source here —
  // measured on the real output, not assumed from the plan. The checks above
  // name the common failures precisely; this one catches whatever they do not
  // (a level the encoder chose above the frame's cap, a container brand, an
  // audio layout), so `screen.ready: true` is never written on an assumption.
  const residual = screenCompatibilityIssues(out);
  if (residual.length > 0)
    return { ok: false, reason: `output-not-screen-safe-${residual.join('+')}` };
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
