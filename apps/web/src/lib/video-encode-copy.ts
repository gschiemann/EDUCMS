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
  DEFAULT_ENCODE_TARGET,
  gradeVideoProcessingMeta,
  videoEncodeFactsFromProcessingMeta,
  videoCodecLabel,
  type VideoEncodeFacts,
  type VideoEncodeReason,
  type VideoEncodeReasonCode,
  type VideoEncodeTarget,
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
  soft: 'soft',
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
export function videoEncodeState(
  asset: EncodeGradableAsset | null | undefined,
  now: number = Date.now(),
  target: VideoEncodeTarget = DEFAULT_ENCODE_TARGET,
): VideoEncodeState {
  if (!asset || !isVideoMime(asset.mimeType)) return { status: 'unknown', verdict: UNKNOWN, facts: null };
  const meta = asset.processingMeta;
  const facts = videoEncodeFactsFromProcessingMeta(meta);
  const verdict = gradeVideoProcessingMeta(meta, target);
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

/** Only the warnings — the pill shows up for these, never for an info note. */
export function encodeWarnings(verdict: VideoEncodeVerdict): VideoEncodeReason[] {
  return verdict.reasons.filter((r) => r.severity !== 'info');
}

/** The advice notes (a file that uses only part of the panel). */
export function encodeNotes(verdict: VideoEncodeVerdict): VideoEncodeReason[] {
  return verdict.reasons.filter((r) => r.severity === 'info');
}

/**
 * "H.264 · 1920 × 1080 · 30 fps · 8.2 Mbps" — what the probe saw, in one
 * line. Facts we lack are simply left out; an empty result means there is
 * nothing to print.
 */
export function encodeFactsLine(facts: VideoEncodeFacts | null): string {
  return encodeFacts(facts).map((f) => f.value).join(' · ');
}

export interface EncodeFact {
  /** i18n leaf under `assetsLib.encode.fact.*`. */
  key: 'codec' | 'size' | 'frameRate' | 'bitrate' | 'audio' | 'container' | 'fastStart' | 'colour';
  value: string;
}

/**
 * Every fact the probe found, as label/value pairs for the card. Greg,
 * 2026-09-24: "we should give the info we can get and then show suggested
 * specs if its different than standard". Unknown facts are left out —
 * never printed as a dash that looks like a measurement.
 */
export function encodeFacts(facts: VideoEncodeFacts | null): EncodeFact[] {
  if (!facts) return [];
  const out: EncodeFact[] = [];
  if (facts.codec) {
    const level = facts.level != null && facts.level > 0 ? ` ${(facts.level / 10).toFixed(1)}` : '';
    const profile = facts.profile ? ` ${facts.profile}${level}` : level;
    out.push({ key: 'codec', value: `${videoCodecLabel(facts.codec)}${profile}` });
  }
  if (facts.width && facts.height) out.push({ key: 'size', value: `${facts.width} × ${facts.height}` });
  if (facts.fps) {
    const fps = `${Math.round(facts.fps * 100) / 100} fps`;
    out.push({ key: 'frameRate', value: facts.variableFrameRate === true ? `${fps} (variable)` : fps });
  }
  if (facts.bitrateKbps) out.push({ key: 'bitrate', value: `${Math.round(facts.bitrateKbps / 100) / 10} Mbps` });
  if (facts.pixFmt) out.push({ key: 'colour', value: describePixFmt(facts.pixFmt) });
  if (facts.audio) {
    const a = facts.audio;
    const ch = a.channels === 1 ? 'mono' : a.channels === 2 ? 'stereo' : a.channels ? `${a.channels} ch` : '';
    const rate = a.sampleRate ? ` ${Math.round(a.sampleRate / 100) / 10} kHz` : '';
    out.push({ key: 'audio', value: `${(a.codec ?? 'unknown').toUpperCase()}${ch ? ` ${ch}` : ''}${rate}`.trim() });
  } else if (facts.container) {
    out.push({ key: 'audio', value: 'none' });
  }
  if (facts.container) out.push({ key: 'container', value: describeContainer(facts.container) });
  if (facts.fastStart === true) out.push({ key: 'fastStart', value: 'front of file' });
  else if (facts.fastStart === false) out.push({ key: 'fastStart', value: 'end of file' });
  return out;
}

/** 'yuv420p' → '8-bit 4:2:0'; 'yuv420p10le' → '10-bit 4:2:0'; 'yuv422p' → '8-bit 4:2:2'. */
export function describePixFmt(pixFmt: string): string {
  const p = pixFmt.toLowerCase();
  const bits = /p(\d{2})/.exec(p)?.[1] ?? '8';
  const sub = /4[0-4][0-4]/.exec(p)?.[0] ?? '420';
  return `${bits}-bit ${sub[0]}:${sub[1]}:${sub[2]}`;
}

/** 'mov,mp4,m4a,3gp,3g2,mj2' → 'MP4'; 'matroska,webm' → 'MKV/WebM'. */
export function describeContainer(container: string): string {
  const names = container.toLowerCase().split(',').map((s) => s.trim());
  if (names.includes('mp4') || names.includes('mov')) return 'MP4';
  if (names.includes('matroska') || names.includes('webm')) return 'MKV/WebM';
  if (names.includes('avi')) return 'AVI';
  if (names.includes('mpegts')) return 'MPEG-TS';
  return (names[0] ?? '').toUpperCase();
}

// ── the automatic fast-start fix (2026-09-24) ──────────────────────────────
//
// When the probe reads an MP4 whose index sits at the end, the API re-muxes
// it losslessly in the background and moves the row onto the copy
// (apps/api/src/storage/video-remux.ts), recording `processingMeta.remux`.
// The library needs two things from that: to keep polling until the fix
// lands, and to say afterwards that it happened.

/** The record the swap writes. Only `at` is load-bearing here. */
export interface EncodeRemuxRecord {
  at: string;
  bytesBefore?: number;
  bytesAfter?: number;
}

/** The swap record on a row, or null when the file was never re-muxed. */
export function encodeRemuxRecord(meta: unknown): EncodeRemuxRecord | null {
  if (!meta || typeof meta !== 'object') return null;
  const r = (meta as Record<string, unknown>).remux;
  if (!r || typeof r !== 'object') return null;
  const rec = r as Record<string, unknown>;
  if (typeof rec.at !== 'string' || !Number.isFinite(new Date(rec.at).getTime())) return null;
  return {
    at: rec.at,
    bytesBefore: typeof rec.bytesBefore === 'number' ? rec.bytesBefore : undefined,
    bytesAfter: typeof rec.bytesAfter === 'number' ? rec.bytesAfter : undefined,
  };
}

/**
 * How long after a probe read "index at the end" the library keeps asking
 * whether the fix has landed. The API runs one re-mux at a time per replica
 * and a large file takes a couple of minutes; a file the API decided not to
 * touch (emergency content, a shared file) simply stops being polled here.
 */
export const REMUX_LANDING_WINDOW_MS = 5 * 60 * 1000;

/** True while the API may still move this row onto its fast-start copy. */
export function remuxMayStillLand(asset: EncodeGradableAsset | null | undefined, now: number = Date.now()): boolean {
  if (!asset || !isVideoMime(asset.mimeType)) return false;
  const meta = asset.processingMeta;
  if (!meta || typeof meta !== 'object') return false;
  const m = meta as Record<string, unknown>;
  if (m.remux != null) return false;
  const probe = m.probe;
  if (!probe || typeof probe !== 'object' || (probe as Record<string, unknown>).fastStart !== false) return false;
  const probedAt = typeof m.probedAt === 'string' ? new Date(m.probedAt).getTime() : NaN;
  return Number.isFinite(probedAt) && now - probedAt >= 0 && now - probedAt < REMUX_LANDING_WINDOW_MS;
}

/** The library's poll period while anything about a video is still being worked out. */
export const ENCODE_CHECK_POLL_MS = 5_000;

/**
 * `useAssets` refetchInterval: 5 s while any video is still being probed or
 * its fast-start fix may still land, else off (no timer on an idle library —
 * the mobile-perf standard).
 */
export function libraryPollMs(assets: EncodeGradableAsset[], now: number = Date.now()): number | false {
  return assets.some((a) => videoEncodeState(a, now).status === 'checking' || remuxMayStillLand(a, now))
    ? ENCODE_CHECK_POLL_MS
    : false;
}
