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
 * ── The target ("kiosk-safe") ────────────────────────────────────────────
 * H.264 (AVC), High profile at level 4.1 or below, 8-bit 4:2:0, at most
 * 1920 × 1080 in either orientation, at most 30 fps, a sane bitrate, the
 * MP4 index at the FRONT of the file ("fast start"), and AAC stereo audio or
 * none. That is what a 2014-era Rockchip box, an Android-9 Goodview LCD and a
 * Chromium-83 NovaStar controller all decode in hardware. A laptop plays far
 * more than that, which is exactly why a file "looks fine on my desk" and
 * stutters on the wall. The 2026-09-24 diagnosis of the Canva clip is in
 * docs/research/2026-09-24-video-choppiness/.
 *
 * ── Grades ───────────────────────────────────────────────────────────────
 *   red     — a fact that makes most kiosks stutter or refuse the file
 *             (non-H.264 codec, 10-bit colour, above 1080p, above 30 fps,
 *             an extreme bitrate)
 *   amber   — plays, but may hitch or start slowly (very high bitrate, the
 *             index at the end of the file, a variable frame rate, unusual
 *             audio, a non-MP4 container, an H.264 level above 4.1)
 *   green   — inside the target on every fact we know
 *   unknown — nothing probed yet (an upload from before the probe existed,
 *             an external URL, a file ffprobe could not read)
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

/** The kiosk-safe target every threshold below is measured against. */
export const KIOSK_SAFE_VIDEO = Object.freeze({
  codec: 'h264',
  maxLongEdge: 1920,
  maxShortEdge: 1080,
  /** 30 fps, with room for 29.97 / 30.0x timebases. */
  maxFps: 30.5,
  /** H.264 level 4.1 — the ceiling older hardware decoders advertise. */
  maxLevel: 41,
  pixFmt: 'yuv420p',
  /** Above this a file may hitch on Wi-Fi + eMMC; above `redBitrateKbps` it usually does. */
  amberBitrateKbps: 12_000,
  redBitrateKbps: 25_000,
  audioCodec: 'aac',
  maxAudioChannels: 2,
  audioSampleRates: [44_100, 48_000] as readonly number[],
});

/**
 * The export settings that satisfy the target, as one line an operator can
 * hand to whoever makes the video. Copy for the dashboards lives in i18n;
 * this is the canonical fact list.
 */
export const KIOSK_SAFE_EXPORT_SUMMARY =
  'MP4 · H.264 · 1920 × 1080 (or 1080 × 1920 portrait) · 30 fps · 8-bit colour · fast start · AAC stereo';

export type VideoEncodeGrade = 'green' | 'amber' | 'red' | 'unknown';

export type VideoEncodeReasonCode =
  | 'codec'
  | 'bit-depth'
  | 'resolution'
  | 'frame-rate'
  | 'level'
  | 'bitrate'
  | 'fast-start'
  | 'variable-frame-rate'
  | 'audio'
  | 'container';

export interface VideoEncodeReason {
  code: VideoEncodeReasonCode;
  severity: 'red' | 'amber';
  /** The numbers/names the sentence for this code interpolates. */
  detail: Record<string, string | number>;
}

export interface VideoEncodeVerdict {
  grade: VideoEncodeGrade;
  /** Red reasons first, then amber, in the order the checks run. */
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
 * Grade the facts. Pure, deterministic, tolerant of nulls: a null fact adds
 * no reason. `null` facts (nothing probed) grade `unknown`.
 */
export function gradeVideoEncode(facts: VideoEncodeFacts | null | undefined): VideoEncodeVerdict {
  if (!facts) return { grade: 'unknown', reasons: [] };
  const red: VideoEncodeReason[] = [];
  const amber: VideoEncodeReason[] = [];

  const codec = facts.codec ? facts.codec.toLowerCase() : null;
  if (codec && codec !== KIOSK_SAFE_VIDEO.codec) {
    red.push({ code: 'codec', severity: 'red', detail: { codec: videoCodecLabel(codec) } });
  }

  if (facts.pixFmt && !isEightBit420(facts.pixFmt)) {
    red.push({ code: 'bit-depth', severity: 'red', detail: { pixFmt: facts.pixFmt } });
  }

  const w = facts.width;
  const h = facts.height;
  const tooBig =
    w != null && h != null && w > 0 && h > 0 &&
    (Math.max(w, h) > KIOSK_SAFE_VIDEO.maxLongEdge || Math.min(w, h) > KIOSK_SAFE_VIDEO.maxShortEdge);
  if (tooBig) red.push({ code: 'resolution', severity: 'red', detail: { width: w as number, height: h as number } });

  const tooFast = facts.fps != null && facts.fps > KIOSK_SAFE_VIDEO.maxFps;
  if (tooFast) red.push({ code: 'frame-rate', severity: 'red', detail: { fps: round1(facts.fps as number) } });

  // Level is a consequence of size × rate; only mention it when neither of
  // those already explains it (a 4K file needs no second sentence about 5.1).
  if (
    codec === KIOSK_SAFE_VIDEO.codec &&
    facts.level != null &&
    facts.level > KIOSK_SAFE_VIDEO.maxLevel &&
    !tooBig &&
    !tooFast
  ) {
    amber.push({ code: 'level', severity: 'amber', detail: { level: (facts.level / 10).toFixed(1) } });
  }

  if (facts.bitrateKbps != null && facts.bitrateKbps > 0) {
    const mbps = round1(facts.bitrateKbps / 1000);
    if (facts.bitrateKbps >= KIOSK_SAFE_VIDEO.redBitrateKbps) {
      red.push({ code: 'bitrate', severity: 'red', detail: { mbps } });
    } else if (facts.bitrateKbps > KIOSK_SAFE_VIDEO.amberBitrateKbps) {
      amber.push({ code: 'bitrate', severity: 'amber', detail: { mbps } });
    }
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

  const reasons = [...red, ...amber];
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
export function gradeVideoProcessingMeta(meta: unknown): VideoEncodeVerdict {
  return gradeVideoEncode(videoEncodeFactsFromProcessingMeta(meta));
}
