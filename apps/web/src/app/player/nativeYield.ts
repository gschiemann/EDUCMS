/**
 * Background cache work yields to a presenting native decoder (1.1.45, GUQ
 * decode stalls). Pure: no React, DOM or network.
 *
 * Field evidence (t982 / Android 11, a 2160×3338 H.264 clip on a 2160p60
 * panel): vsync snapping was exact, yet sessions that started right after a
 * page reload, a Resync or an all-clear showed 0.5–0.8 s holes between frame
 * submissions and hundreds of late and dropped frames, while a long session
 * before the reload had none. Right after a document loads, the page drives
 * the playlist cache: Range chunks written to disk, then a streamed SHA-256 of
 * the whole file in the service worker, then a disk-to-disk assemble — all on
 * the same cores and the same eMMC the hardware decoder's input feed reads.
 *
 * While a native session presents on this face, every step of the
 * PLAYLIST-tier large-file drive waits first: longer during the first minute
 * of the session (the window the field stalls cluster in), shorter after. The
 * work still finishes — this only stretches it — so rule 17 (download whole,
 * verified, then play) is unchanged. The EMERGENCY tier is never paced: the
 * alert's media must land as fast as it can (rule 11).
 */

/** Pause before each step during the first minute of a native session. */
export const NATIVE_YIELD_EARLY_MS = 4_000;
/** Pause before each step afterwards. */
export const NATIVE_YIELD_STEADY_MS = 1_500;
/** How long "early" lasts after a native session is first seen presenting. */
export const NATIVE_YIELD_EARLY_WINDOW_MS = 60_000;

export type NativeYieldInput = {
  /** A native session presents on this face right now. */
  presenting: boolean;
  /** When this document first saw the current session presenting (ms, page clock), or null. */
  presentingSince: number | null;
  now: number;
  tier?: 'emergency';
};

/** The pause before the next cache step, in ms (0 = go now). */
export function nativeYieldDelayMs(i: NativeYieldInput): number {
  if (i.tier === 'emergency') return 0;
  if (!i.presenting) return 0;
  const age = i.presentingSince === null ? 0 : Math.max(0, i.now - i.presentingSince);
  return age < NATIVE_YIELD_EARLY_WINDOW_MS ? NATIVE_YIELD_EARLY_MS : NATIVE_YIELD_STEADY_MS;
}
