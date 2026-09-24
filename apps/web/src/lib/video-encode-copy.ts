/**
 * Video encode grade → dashboard state + copy.
 *
 * The grade itself is computed by `@cms/api-types` (`gradeVideoProcessingMeta`,
 * shared with the API so the two never disagree about what "will stutter"
 * means). This module owns what the DASHBOARD adds on top:
 *
 *   - a fifth state, `checking`: a video uploaded moments ago whose ffprobe
 *     pass has not landed yet. The probe is fire-and-forget on the API
 *     (`VideoPosterService.kickOff`), so for a few seconds after an upload
 *     the row has no facts. That is not "unknown" — it is "not yet".
 *   - the map from a machine reason code to its i18n key, so every surface
 *     (Media Library card, tile badge, playlist row, playlist banner) prints
 *     the same sentence for the same fact.
 *
 * Greg, 2026-09-24: "if the content doesn't meet spec we should at least
 * warn them that they may have issues".
 */
import {
  gradeVideoProcessingMeta,
  videoEncodeFactsFromProcessingMeta,
  videoCodecLabel,
  type VideoEncodeFacts,
  type VideoEncodeReason,
  type VideoEncodeReasonCode,
  type VideoEncodeVerdict,
} from '@cms/api-types';

export type VideoEncodeStatus = 'green' | 'amber' | 'red' | 'checking' | 'unknown';

export interface VideoEncodeState {
  status: VideoEncodeStatus;
  verdict: VideoEncodeVerdict;
  facts: VideoEncodeFacts | null;
}

/**
 * How long after upload a video with no probe result still reads
 * "Checking…" rather than "Not checked". The probe normally lands within a
 * few seconds; ten minutes covers a cold API and a long download. Past that,
 * the honest word is "unknown" (§22 — copy states what the evidence proves).
 */
export const ENCODE_CHECKING_WINDOW_MS = 10 * 60 * 1000;

/** Reason code → the leaf under `assetsLib.encode.reason.*`. */
export const ENCODE_REASON_KEY: Record<VideoEncodeReasonCode, string> = {
  codec: 'codec',
  'bit-depth': 'bitDepth',
  resolution: 'resolution',
  'frame-rate': 'frameRate',
  level: 'level',
  bitrate: 'bitrate',
  'fast-start': 'fastStart',
  'variable-frame-rate': 'variableFrameRate',
  audio: 'audio',
  container: 'container',
};

export function encodeReasonKey(code: VideoEncodeReasonCode): string {
  return `assetsLib.encode.reason.${ENCODE_REASON_KEY[code]}`;
}

/** The `t` signature both next-intl and the Jest stand-in expose. */
export type EncodeTranslator = (key: string, values?: Record<string, string | number>) => string;

/** One reason → one sentence, with its numbers filled in. */
export function describeEncodeReason(t: EncodeTranslator, reason: VideoEncodeReason): string {
  return t(encodeReasonKey(reason.code), reason.detail);
}

export function isVideoMime(mime: unknown): boolean {
  return typeof mime === 'string' && mime.toLowerCase().startsWith('video/');
}

/** The minimum an asset row needs to carry for this module. */
export interface EncodeGradableAsset {
  mimeType?: string | null;
  processingMeta?: unknown;
  createdAt?: string | Date | null;
}

const UNKNOWN: VideoEncodeVerdict = { grade: 'unknown', reasons: [] };

/**
 * The dashboard state for one asset row. Non-videos are `unknown` with no
 * reasons (callers render nothing for them). A video with no probe facts is
 * `checking` while it is young enough that the probe may still land, and
 * `unknown` once a probe has demonstrably run (`probedAt` is stamped even
 * when ffprobe could not read the file) or the window has passed.
 */
export function videoEncodeState(asset: EncodeGradableAsset | null | undefined, now: number = Date.now()): VideoEncodeState {
  if (!asset || !isVideoMime(asset.mimeType)) return { status: 'unknown', verdict: UNKNOWN, facts: null };
  const meta = asset.processingMeta;
  const facts = videoEncodeFactsFromProcessingMeta(meta);
  const verdict = gradeVideoProcessingMeta(meta);
  if (verdict.grade !== 'unknown') return { status: verdict.grade, verdict, facts };

  const probed =
    !!meta && typeof meta === 'object' && typeof (meta as Record<string, unknown>).probedAt === 'string';
  if (probed) return { status: 'unknown', verdict, facts };

  const created = asset.createdAt ? new Date(asset.createdAt).getTime() : NaN;
  const young = Number.isFinite(created) && now - created >= 0 && now - created < ENCODE_CHECKING_WINDOW_MS;
  return { status: young ? 'checking' : 'unknown', verdict, facts };
}

/** True when the grade should be shown as a warning (a tile badge, a row pill). */
export function encodeWarns(status: VideoEncodeStatus): status is 'amber' | 'red' {
  return status === 'amber' || status === 'red';
}

/**
 * "H.264 · 1920 × 1080 · 30 fps · 8.2 Mbps" — what the probe saw, for the
 * green card, so an operator can tell the check was real. Facts we lack are
 * simply left out; an empty result means there is nothing to print.
 */
export function encodeFactsLine(facts: VideoEncodeFacts | null): string {
  if (!facts) return '';
  const parts: string[] = [];
  if (facts.codec) parts.push(videoCodecLabel(facts.codec));
  if (facts.width && facts.height) parts.push(`${facts.width} × ${facts.height}`);
  if (facts.fps) parts.push(`${Math.round(facts.fps * 10) / 10} fps`);
  if (facts.bitrateKbps) parts.push(`${Math.round(facts.bitrateKbps / 100) / 10} Mbps`);
  return parts.join(' · ');
}
