/**
 * "Will this video play on the screens?" — the dashboard's reading of
 * `processingMeta.screen` (2026-10-05, the screen-ready gate).
 *
 * The verdict itself is read with `readScreenStamp` from `@cms/api-types` —
 * the SAME function the API's manifest gate uses (`withheldFromScreens`), so
 * a video the library says is "converting" or "can't play" is exactly a video
 * the screens are not being handed. This module only decides what to SAY:
 *
 *   converting — the upload found the file is not screen-safe as uploaded
 *                (HEVC, HDR, 60 fps, WebM …) and its conversion is queued or
 *                running; screens skip it until the copy is ready;
 *   failed     — the conversion failed or could not run; screens skip it;
 *                the operator is told why, in plain words, and what to do;
 *   converted  — screens play a converted copy; say what it was converted from;
 *   null       — nothing to add: ready as uploaded, or no verdict (unknown —
 *                every video from before the verdict existed).
 *
 * The transcode job's live state, when the page has it, wins over a stamp
 * that has not caught up yet: a job queued or running means "converting"
 * (with its progress) whatever the row last said.
 */
import { readScreenStamp, videoCodecLabel, type ScreenStamp } from '@cms/api-types';
import { isOptimizing, type VideoOptimization } from '@/hooks/use-video-optimization';

/** Why a conversion did not produce a playable copy — one plain sentence each. */
export type ScreenFailureReason = 'unreadable' | 'tooSlow' | 'couldNotRun' | 'failed';

export type ScreenReadiness =
  | { kind: 'converting'; progress: number | null; queued: boolean }
  | { kind: 'failed'; reason: ScreenFailureReason }
  | { kind: 'converted'; from: string[]; codecIn: string | null };

/** The slice of an asset row this module reads. */
export interface ScreenReadinessAsset {
  mimeType?: string | null;
  processingMeta?: unknown;
}

/** Job outcomes that mean the conversion never got to try (no room, never queued, …). */
const COULD_NOT_RUN = new Set([
  'insufficient-temp-disk',
  'source-size-unknown',
  'stalled',
  'expired',
  'not-queued',
  'asset-archived',
  'external-url',
  'not-video',
]);
/** Outcomes that mean the FILE itself could not be read as a video. */
const UNREADABLE = new Set(['probe-failed', 'no-video-stream', 'unknown-dimensions']);

export function screenFailureReason(stamp: Pick<ScreenStamp, 'issues' | 'error'>): ScreenFailureReason {
  const error = stamp.error ?? '';
  if (stamp.issues.includes('unreadable') || UNREADABLE.has(error)) return 'unreadable';
  if (error === 'timeout') return 'tooSlow';
  if (COULD_NOT_RUN.has(error)) return 'couldNotRun';
  return 'failed';
}

function isVideo(mime: unknown): boolean {
  return typeof mime === 'string' && mime.toLowerCase().startsWith('video/');
}

/** `processingMeta.transcode.codecIn` — the codec the converted copy replaced. */
function codecIn(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const t = (meta as { transcode?: unknown }).transcode;
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const c = (t as { codecIn?: unknown }).codecIn;
  return typeof c === 'string' && c ? c : null;
}

/**
 * What to say about this video on screens. `job` is the transcode job as the
 * page knows it (the list row's `transcodeJob`, or the live poll's answer).
 */
export function screenReadinessOf(
  asset: ScreenReadinessAsset | null | undefined,
  job?: VideoOptimization | null,
): ScreenReadiness | null {
  if (!asset || !isVideo(asset.mimeType)) return null;
  const stamp = readScreenStamp(asset.processingMeta);
  if (!stamp) return null;
  if (stamp.ready) {
    return stamp.convertedFrom.length
      ? { kind: 'converted', from: stamp.convertedFrom, codecIn: codecIn(asset.processingMeta) }
      : null;
  }
  // Not ready. A job that is queued or running is converting it right now —
  // whatever the row last said (a retry after a failure, a re-queue).
  if (job && isOptimizing(job)) {
    return {
      kind: 'converting',
      progress: job.status === 'running' && typeof job.progress === 'number' ? job.progress : null,
      queued: job.status === 'queued',
    };
  }
  if (stamp.pending) {
    // Alert media is never converted (the job ends `emergency-content`), and
    // alerts play it as uploaded: the job's own sentence says so — "converting"
    // would never come true.
    if (job && job.reason === 'emergency-content') return null;
    return { kind: 'converting', progress: null, queued: false };
  }
  return { kind: 'failed', reason: screenFailureReason(stamp) };
}

/** True when the screens are NOT playing this video (converting, or failed). */
export function notPlayingOnScreens(r: ScreenReadiness | null): boolean {
  return !!r && (r.kind === 'converting' || r.kind === 'failed');
}

/**
 * Issue code → the leaf under `assetsLib.screenReady.issue.*`. Several codes
 * share one plain label (three audio problems are "audio screens can't play").
 */
export const SCREEN_ISSUE_LABEL_KEY: Readonly<Record<string, string>> = {
  codec: 'codecUnknown',
  hdr: 'hdr',
  'pixel-format': 'pixelFormat',
  'colour-range': 'colourRange',
  'frame-rate': 'frameRate',
  'variable-frame-rate': 'variableFrameRate',
  container: 'container',
  interlaced: 'interlaced',
  rotation: 'rotation',
  'pixel-aspect': 'pixelAspect',
  oversize: 'oversize',
  level: 'level',
  'audio-codec': 'audio',
  'audio-channels': 'audio',
  'audio-sample-rate': 'audio',
  'duration-unknown': 'durationUnknown',
};

/** The `t` signature next-intl and the Jest stand-in both expose. */
export type ScreenReadyTranslator = (key: string, values?: Record<string, string | number>) => string;

/**
 * "H.265 / HEVC, HDR, over 30 fps" — what a converted copy was converted FROM,
 * in the words people see on export dialogs, joined the locale's way. The
 * codec is named when the row recorded it (`transcode.codecIn`); unknown codes
 * are left out rather than shown raw.
 */
export function convertedFromLabel(
  t: ScreenReadyTranslator,
  r: Extract<ScreenReadiness, { kind: 'converted' }>,
): string {
  const labels: string[] = [];
  for (const code of r.from) {
    const label =
      code === 'codec' && r.codecIn
        ? videoCodecLabel(r.codecIn)
        : SCREEN_ISSUE_LABEL_KEY[code]
          ? t(`assetsLib.screenReady.issue.${SCREEN_ISSUE_LABEL_KEY[code]}`)
          : null;
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels.join(t('assetsLib.screenReady.listSeparator'));
}

/** The full sentence for a failed conversion: what happened, and what to do. */
export function screenFailedSentence(
  t: ScreenReadyTranslator,
  r: Extract<ScreenReadiness, { kind: 'failed' }>,
): string {
  return t('assetsLib.screenReady.failed', { reason: t(`assetsLib.screenReady.reason.${r.reason}`) });
}
