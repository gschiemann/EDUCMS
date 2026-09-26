/**
 * Which file a <video> should mount for one playlist item (2026-09-26).
 *
 * A >1080p screen's manifest item carries its native file (`url`) and, when
 * the upload pipeline produced one, a 1080p compatibility copy as a fallback.
 * The native 4K file is what the screen should show — but only from the
 * cache: streaming 15 Mbps 4K from origin is what dropped 121 of 264 frames on
 * the field 4K screen while the cache was still empty. So until the
 * primary is in the cache the smaller copy plays (it streams fine and caches
 * quickly), and the primary takes over at the next mount once it has landed.
 *
 * Pure: the page supplies the cache facts, this decides. Unit-tested alone.
 */
export type VideoSourceKind = 'primary' | 'fallback';

export function chooseVideoSourceKind(input: { primaryCached: boolean; hasFallback: boolean }): VideoSourceKind {
  if (!input.hasFallback) return 'primary';
  return input.primaryCached ? 'primary' : 'fallback';
}

/** A slide on the fallback could move up to the native file now. */
export function upgradeAvailable(input: { kind: VideoSourceKind; primaryCached: boolean; hasFallback: boolean }): boolean {
  return input.kind === 'fallback' && input.hasFallback && input.primaryCached;
}

/**
 * A natively looping <video> restarts without firing `ended`; the only tell is
 * currentTime jumping back to the start. Two conditions, so neither decoder
 * jitter nor a frame-locked-sync servo seek (which can move backwards by
 * seconds, mid-clip) reads as a wrap: a jump back of more than a second, AND
 * landing inside the first 1.5 s of the file.
 */
export function isLoopWrap(previousTimeS: number, currentTimeS: number): boolean {
  if (!Number.isFinite(previousTimeS) || !Number.isFinite(currentTimeS)) return false;
  return previousTimeS - currentTimeS > 1 && currentTimeS < 1.5;
}
