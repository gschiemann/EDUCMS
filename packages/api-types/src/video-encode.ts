/**
 * Video encode grading — will this file play well on signage hardware?
 *
 * Greg, 2026-09-24, after a 48 MB Canva export played "very choppy" on a
 * kiosk: "The video was exported from Canva and you really don't get any
 * options besides resolution… why can't we check the file for fps, the codec,
 * and anything else that the signage might not display properly… if the
 * content doesn't meet spec we should at least warn them."
 *
 * The API probes every uploaded video with ffprobe and writes the facts to
 * `Asset.processingMeta` (apps/api/src/storage/video-probe.ts). This module
 * turns those facts into ONE grade against a target that every qualified
 * kiosk decodes in hardware, plus machine-readable reasons the dashboard
 * turns into sentences. It is PURE and shared by the API and the web app so
 * the two can never disagree about what "will stutter" means.
 *
 * ── The target ────────────────────────────────────────────────────────────
 * H.264 (AVC), 8-bit 4:2:0, at most 30 fps, a bitrate in proportion to what
 * it shows, the MP4 index at the FRONT of the file ("fast start"), AAC stereo
 * audio or none — and a frame size that matches the screens it will play
 * on. The size half is the caller's `VideoEncodeTarget`: the largest panel in
 * the operator's fleet (a 4K fleet WANTS 3840 × 2160 files; a 1080p fleet
 * cannot show more than 1920 × 1080 and pays the decode for nothing). With no
 * fleet to read the target defaults to 1920 × 1080 and the size rules stay
 * quiet about "soft" files. Greg, 2026-09-24: "these are all 4k screens so
 * why would we recommend 1080? dont we want the max out of them?"
 *
 * ── Grades ───────────────────────────────────────────────────────────────
 *   red     — a fact that makes most players stutter or refuse the file
 *             (non-H.264 codec, 10-bit colour, larger than the biggest
 *             screen, more than ~60 fps, an extreme bitrate)
 *   amber   — plays, but may hitch or start slowly (above 30 fps, a very
 *             high bitrate for its size, the index at the end of the file,
 *             a variable frame rate, unusual audio, a non-MP4 container, an
 *             H.264 level above 5.1)
 *   green   — inside the target on every fact we know
 *   unknown — nothing probed yet (an upload from before the probe existed,
 *             an external URL, a file ffprobe could not read)
 *   plus INFO reasons that never change the grade: a file that uses only a
 *   fraction of the panel's pixels ("soft"), when the panel is known.
 *
 * A fact we do not know never counts against the file: a row probed by the
 * first, dimensions-only pass grades on codec, size and frame rate alone.
 */

export interface VideoEncodeFacts {
  /** ffprobe codec_name: 'h264', 'hevc', 'vp9', 'av1', 'mpeg4', 'prores', … */
  codec: string | null;
  /** ffprobe profile string: 'High', 'Main', 'High 10', 'High 4:2:2', 'Main 10', … */
  profile: string | null;
  /** ffprobe level as reported (H.264: 41 = 4.1). */
  level: number | null;
  /** ffprobe pix_fmt: 'yuv420p' is 8-bit 4:2:0; 'yuv420p10le' is 10-bit; … */
  pixFmt: string | null;
  /** DISPLAY size — a portrait phone clip is 1080 × 1920, not 1920 × 1080. */
  width: number | null;
  height: number | null;
  /** Average frame rate. */
  fps: number | null;
  variableFrameRate: boolean | null;
  bitrateKbps: number | null;
  /** MP4/MOV only: is the index ('moov') before the media? null = not applicable / unknown. */
  fastStart: boolean | null;
  /** ffprobe format_name, e.g. 'mov,mp4,m4a,3gp,3g2,mj2' or 'matroska,webm'. */
  container: string | null;
  /** The first audio stream, or null when the file has none. */
  audio: { codec: string | null; channels: number | null; sampleRate: number | null } | null;
}

/**
 * The screens a file is graded against: the LARGEST panel in the fleet,
 * landscape-normalised (long edge × short edge). `panelKnown` is false when
 * the caller has no fleet to read — the size rules then use 1920 × 1080 and
 * say nothing about "soft" files, because "soft on your screens" needs a
 * screen to be true of.
 */
export interface VideoEncodeTarget {
  panelWidth: number;
  panelHeight: number;
  panelKnown: boolean;
}

export const DEFAULT_ENCODE_TARGET: VideoEncodeTarget = Object.freeze({
  panelWidth: 1920,
  panelHeight: 1080,
  panelKnown: false,
});

/** The size-independent half of the target every threshold below is measured against. */
export const KIOSK_SAFE_VIDEO = Object.freeze({
  codec: 'h264',
  /** 30 fps, with room for 29.97 / 30.0x timebases. */
  maxFps: 30.5,
  /** Past ~60 fps no signage player keeps up. */
  redFps: 61,
  /** H.264 level 5.1 is 4K30 — the ceiling common hardware decoders advertise. */
  maxLevel: 51,
  pixFmt: 'yuv420p',
  /**
   * Bitrate is judged against what the file SHOWS: 0.1 bits per pixel per
   * frame is a high-quality H.264 encode (1080p30 ≈ 6 Mbps, 4K30 ≈ 25 Mbps).
   * Three times that is wasteful and slow to download; six times is a
   * problem on Wi-Fi and kiosk storage. Files whose size or rate is unknown
   * fall back to the absolute ceilings.
   */
  referenceBitsPerPixel: 0.1,
  amberBitrateMultiple: 3,
  redBitrateMultiple: 6,
  amberBitrateKbpsAbsolute: 20_000,
  redBitrateKbpsAbsolute: 100_000,
  /**
   * A file whose long edge is at most this fraction of the panel's uses
   * a quarter of its pixels or fewer (1080p on 4K, 720p on 1440p) — it plays
   * fine, but the operator asked for the most out of the panel.
   */
  softFraction: 0.5,
  audioCodec: 'aac',
  maxAudioChannels: 2,
  audioSampleRates: [44_100, 48_000] as readonly number[],
});

/**
 * The export settings that satisfy the target, as one line an operator can
 * hand to whoever makes the video. Copy for the dashboards lives in i18n;
 * this is the canonical fact list.
 */
export function kioskSafeExportSummary(target: VideoEncodeTarget = DEFAULT_ENCODE_TARGET): string {
  const { panelWidth: w, panelHeight: h } = target;
  return `MP4 · H.264 · ${w} × ${h} (or ${h} × ${w} portrait) · 30 fps · 8-bit colour · fast start · AAC stereo`;
}

export type VideoEncodeGrade = 'green' | 'amber' | 'red' | 'unknown';

export type VideoEncodeReasonCode =
  | 'codec'
  | 'bit-depth'
  | 'resolution'
  | 'soft'
  | 'frame-rate'
  | 'level'
  | 'bitrate'
  | 'fast-start'
  | 'variable-frame-rate'
  | 'audio'
  | 'container';

export interface VideoEncodeReason {
  code: VideoEncodeReasonCode;
  /** `info` never changes the grade — it is advice, not a warning. */
  severity: 'red' | 'amber' | 'info';
  /** The numbers/names the sentence for this code interpolates. */
  detail: Record<string, string | number>;
}

export interface VideoEncodeVerdict {
  grade: VideoEncodeGrade;
  /** Red reasons first, then amber, then info, in the order the checks run. */
  reasons: VideoEncodeReason[];
}

/** 'hevc' → 'H.265 / HEVC' — the names people see on export dialogs. */
export function videoCodecLabel(codec: string | null | undefined): string {
  const c = (codec ?? '').toLowerCase();
  switch (c) {
    case 'h264':
      return 'H.264';
    case 'hevc':
    case 'h265':
      return 'H.265 / HEVC';
    case 'vp9':
      return 'VP9';
    case 'vp8':
      return 'VP8';
    case 'av1':
      return 'AV1';
    case 'mpeg4':
      return 'MPEG-4 Part 2';
    case 'mpeg2video':
      return 'MPEG-2';
    case 'prores':
      return 'ProRes';
    case 'dnxhd':
      return 'DNxHD';
    case 'mjpeg':
      return 'Motion JPEG';
    case 'wmv3':
    case 'vc1':
      return 'Windows Media';
    default:
      return c ? c.toUpperCase() : 'unknown codec';
  }
}

/** Container family from ffprobe's comma-separated format_name. */
function isMp4Family(container: string | null): boolean | null {
  if (!container) return null;
  const names = container.toLowerCase().split(',').map((s) => s.trim());
  return names.some((n) => n === 'mp4' || n === 'mov' || n === 'm4v' || n === 'm4a' || n === '3gp' || n === 'mj2');
}

function isEightBit420(pixFmt: string): boolean {
  const p = pixFmt.toLowerCase();
  return p === 'yuv420p' || p === 'yuvj420p' || p === 'nv12' || p === 'nv21';
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Grade the facts against the target. Pure, deterministic, tolerant of
 * nulls: a null fact adds no reason. `null` facts (nothing probed) grade
 * `unknown`.
 */
export function gradeVideoEncode(
  facts: VideoEncodeFacts | null | undefined,
  target: VideoEncodeTarget = DEFAULT_ENCODE_TARGET,
): VideoEncodeVerdict {
  if (!facts) return { grade: 'unknown', reasons: [] };
  const red: VideoEncodeReason[] = [];
  const amber: VideoEncodeReason[] = [];
  const info: VideoEncodeReason[] = [];

  const panelLong = Math.max(target.panelWidth, target.panelHeight);
  const panelShort = Math.min(target.panelWidth, target.panelHeight);
  const panel = { panelWidth: panelLong, panelHeight: panelShort };

  const codec = facts.codec ? facts.codec.toLowerCase() : null;
  if (codec && codec !== KIOSK_SAFE_VIDEO.codec) {
    red.push({ code: 'codec', severity: 'red', detail: { codec: videoCodecLabel(codec) } });
  }

  if (facts.pixFmt && !isEightBit420(facts.pixFmt)) {
    red.push({ code: 'bit-depth', severity: 'red', detail: { pixFmt: facts.pixFmt } });
  }

  const w = facts.width;
  const h = facts.height;
  const sized = w != null && h != null && w > 0 && h > 0;
  const longEdge = sized ? Math.max(w as number, h as number) : null;
  const shortEdge = sized ? Math.min(w as number, h as number) : null;
  // Larger than the biggest screen: the player decodes pixels it can never
  // show, and pays for it in frames. Judged edge by edge so a 1080 × 1920
  // portrait clip is fine on a 1920 × 1080 fleet.
  const tooBig = longEdge != null && shortEdge != null && (longEdge > panelLong || shortEdge > panelShort);
  if (tooBig) {
    red.push({ code: 'resolution', severity: 'red', detail: { width: w as number, height: h as number, ...panel } });
  } else if (target.panelKnown && longEdge != null && longEdge <= panelLong * KIOSK_SAFE_VIDEO.softFraction) {
    info.push({ code: 'soft', severity: 'info', detail: { width: w as number, height: h as number, ...panel } });
  }

  const fps = facts.fps != null && facts.fps > 0 ? facts.fps : null;
  if (fps != null && fps >= KIOSK_SAFE_VIDEO.redFps) {
    red.push({ code: 'frame-rate', severity: 'red', detail: { fps: round1(fps) } });
  } else if (fps != null && fps > KIOSK_SAFE_VIDEO.maxFps) {
    amber.push({ code: 'frame-rate', severity: 'amber', detail: { fps: round1(fps) } });
  }

  if (codec === KIOSK_SAFE_VIDEO.codec && facts.level != null && facts.level > KIOSK_SAFE_VIDEO.maxLevel) {
    amber.push({ code: 'level', severity: 'amber', detail: { level: (facts.level / 10).toFixed(1) } });
  }

  if (facts.bitrateKbps != null && facts.bitrateKbps > 0) {
    const kbps = facts.bitrateKbps;
    const mbps = round1(kbps / 1000);
    // Reference: what a high-quality encode of THIS size and rate needs.
    const pixelRate = sized ? (w as number) * (h as number) * (fps ?? 30) : null;
    const referenceKbps = pixelRate != null ? (pixelRate * KIOSK_SAFE_VIDEO.referenceBitsPerPixel) / 1000 : null;
    const amberAt = referenceKbps != null
      ? Math.min(referenceKbps * KIOSK_SAFE_VIDEO.amberBitrateMultiple, KIOSK_SAFE_VIDEO.amberBitrateKbpsAbsolute * 5)
      : KIOSK_SAFE_VIDEO.amberBitrateKbpsAbsolute;
    const redAt = referenceKbps != null
      ? Math.min(referenceKbps * KIOSK_SAFE_VIDEO.redBitrateMultiple, KIOSK_SAFE_VIDEO.redBitrateKbpsAbsolute)
      : KIOSK_SAFE_VIDEO.redBitrateKbpsAbsolute;
    const detail = { mbps, width: w ?? 0, height: h ?? 0, fps: round1(fps ?? 30) };
    if (kbps >= redAt) red.push({ code: 'bitrate', severity: 'red', detail });
    else if (kbps > amberAt) amber.push({ code: 'bitrate', severity: 'amber', detail });
  }

  if (facts.fastStart === false) amber.push({ code: 'fast-start', severity: 'amber', detail: {} });

  if (facts.variableFrameRate === true) amber.push({ code: 'variable-frame-rate', severity: 'amber', detail: {} });

  if (facts.audio) {
    const a = facts.audio;
    const codecOff = !!a.codec && a.codec.toLowerCase() !== KIOSK_SAFE_VIDEO.audioCodec;
    const channelsOff = a.channels != null && a.channels > KIOSK_SAFE_VIDEO.maxAudioChannels;
    const rateOff = a.sampleRate != null && !KIOSK_SAFE_VIDEO.audioSampleRates.includes(a.sampleRate);
    if (codecOff || channelsOff || rateOff) {
      amber.push({
        code: 'audio',
        severity: 'amber',
        detail: {
          codec: (a.codec ?? 'unknown').toUpperCase(),
          channels: a.channels ?? 0,
          sampleRate: a.sampleRate ?? 0,
        },
      });
    }
  }

  const mp4 = isMp4Family(facts.container);
  if (mp4 === false) {
    amber.push({ code: 'container', severity: 'amber', detail: { container: (facts.container ?? '').split(',')[0].toUpperCase() } });
  }

  const reasons = [...red, ...amber, ...info];
  return { grade: red.length ? 'red' : amber.length ? 'amber' : 'green', reasons };
}

/**
 * Pull the facts out of `Asset.processingMeta` — the shape the API's probe
 * writes (`originalDimensions` + `probe.*`). Returns null when the row has no
 * probe at all, so the caller grades `unknown` rather than green.
 *
 * The first probe pass (dimensions only) wrote `probe.{codec,fps,rotation}`;
 * the second wrote the full fact set. Both shapes read here; missing facts
 * stay null and never count against the file.
 */
export function videoEncodeFactsFromProcessingMeta(meta: unknown): VideoEncodeFacts | null {
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, unknown>;
  const probe = m.probe && typeof m.probe === 'object' ? (m.probe as Record<string, unknown>) : null;
  const dims = m.originalDimensions && typeof m.originalDimensions === 'object'
    ? (m.originalDimensions as Record<string, unknown>)
    : null;
  // No probe block, no grade. Dimensions alone (an old image-optimizer-style
  // row, or a failed probe stamped over nothing) would grade a 1080p file
  // "green" knowing nothing about its codec, and "plays smoothly on every
  // screen" must never be said from a size.
  if (!probe) return null;

  const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

  const audioRaw = probe?.audio && typeof probe.audio === 'object' ? (probe.audio as Record<string, unknown>) : null;

  return {
    codec: str(probe?.codec),
    profile: str(probe?.profile),
    level: num(probe?.level),
    pixFmt: str(probe?.pixFmt),
    width: num(dims?.w),
    height: num(dims?.h),
    fps: num(probe?.fps),
    variableFrameRate: bool(probe?.variableFrameRate),
    bitrateKbps: num(probe?.bitrateKbps),
    fastStart: bool(probe?.fastStart),
    container: str(probe?.container),
    audio: audioRaw
      ? { codec: str(audioRaw.codec), channels: num(audioRaw.channels), sampleRate: num(audioRaw.sampleRate) }
      : null,
  };
}

/** One call for the dashboards: processingMeta in, verdict out. */
export function gradeVideoProcessingMeta(
  meta: unknown,
  target: VideoEncodeTarget = DEFAULT_ENCODE_TARGET,
): VideoEncodeVerdict {
  return gradeVideoEncode(videoEncodeFactsFromProcessingMeta(meta), target);
}

/**
 * Build a target from the panel sizes a fleet reports (`Screen.resolution`,
 * "3840×2160" / "1920x1080" / "1080x1920"). The largest long edge and the
 * largest short edge win, landscape-normalised, so a mixed fleet is graded
 * against its best screen. No parseable size → the default, `panelKnown`
 * false.
 */
export function encodeTargetFromResolutions(resolutions: Array<string | null | undefined>): VideoEncodeTarget {
  let long = 0;
  let short = 0;
  for (const r of resolutions) {
    if (typeof r !== 'string') continue;
    const m = /(\d{3,5})\s*[x×X]\s*(\d{3,5})/.exec(r);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) continue;
    long = Math.max(long, Math.max(a, b));
    short = Math.max(short, Math.min(a, b));
  }
  if (long === 0 || short === 0) return DEFAULT_ENCODE_TARGET;
  return { panelWidth: long, panelHeight: short, panelKnown: true };
}
