/** Normal continuous playback only. A reset retains one source-resolution
 * frame until the replacement pipeline presents a frame; never a second decoder.
 */
import { nativeCall, nativeHas } from './nativeBridge';
import { requestDiagnosticsUpload } from './playbackSafety';

const MAX_FRAME_PIXELS = 3840 * 2160;
let lastUploadAt = -Infinity;
let lastProgressiveAt = -Infinity;
let progressiveSamples = 0;

export function retainVideoFrame(video: HTMLVideoElement, canvas: HTMLCanvasElement): boolean {
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight ||
      video.videoWidth * video.videoHeight > MAX_FRAME_PIXELS) return false;
  try {
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) { releaseVideoFrame(canvas); return false; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.style.display = 'block';
    return true;
  } catch { releaseVideoFrame(canvas); return false; }
}

export function releaseVideoFrame(canvas: HTMLCanvasElement): void {
  canvas.style.display = 'none';
  // Release the ~32 MiB 4K backing store as soon as a real frame returns.
  canvas.width = 0; canvas.height = 0;
}

/** Report states, never URLs, credentials or content. Android persists this
 * warning; request its existing authenticated upload after that log write.
 * All mounts share the cooldown so repeated errors cannot flood ingestion.
 */
export function reportContinuousFailure(reason: string, video: HTMLVideoElement, pump?: object,
  stage: 'continuous loop fallback' | 'native startup failed' = 'continuous loop fallback'): void {
  try {
    const buffered = Array.from({ length: Math.min(video.buffered.length, 3) }, (_, i) =>
      [video.buffered.start(i), video.buffered.end(i)].map(n => Math.round(n * 1000) / 1000));
    const safeReason = /^[a-z0-9:-]{1,64}$/i.test(reason) ? reason : 'pipeline-error';
    console.warn(`[Player] ${stage}: ${safeReason} ${JSON.stringify({
      time: Math.round(video.currentTime * 1000) / 1000, ready: video.readyState,
      network: video.networkState, error: video.error?.code ?? 0,
      paused: video.paused, seeking: video.seeking, buffered, pump,
    })}`);
  } catch { /* Diagnostics must never prevent recovery on a damaged element. */ }
  if (reason !== 'blocked') scheduleDiagnosticsUpload();
}

function scheduleDiagnosticsUpload(): void {
  try {
    if (Date.now() - lastUploadAt < 60_000 || !nativeHas('uploadDiagnostics')) return;
    lastUploadAt = Date.now();
    setTimeout(() => requestDiagnosticsUpload({ has: nativeHas, call: nativeCall }), 1000);
  } catch { /* Older or unavailable native bridges leave playback unaffected. */ }
}

/** Three progressive samples per document, shared across mounts. The collector
 * constructs numeric-only records; reject anything outside that schema here.
 */
export function reportContinuousPlaybackSample(line: string | null): void {
  if (!line || progressiveSamples >= 3 || Date.now() - lastProgressiveAt < 60_000) return;
  if (line.length > 450 || !/^\[Player\] (stalled playback sample|failed frame budget) \{/.test(line)) return;
  try {
    const record = JSON.parse(line.slice(line.indexOf('{'))) as Record<string, unknown>;
    const keys = ['ms', 'f', 'd', 'w', 'waitMs', 'aheadMs', 'minAheadMs', 'waitAheadMs', 'opMaxMs', 'decodeMs', 'quota'];
    const numeric = (v: unknown): boolean => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1_000_000_000);
    if (!record || Object.keys(record).length !== keys.length || !Object.entries(record).every(([key, value]) =>
      keys.includes(key) && (Array.isArray(value) ? value.length <= 3 && value.every(numeric) : numeric(value)))) return;
  } catch { return; }
  progressiveSamples++; lastProgressiveAt = Date.now();
  try { console.warn(line); } catch { /* Diagnostics never control playback. */ }
  scheduleDiagnosticsUpload();
}
