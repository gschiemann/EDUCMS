/**
 * Readiness-gated playback (2026-09-26, Greg's rule after the 4K cache-fill
 * incident): "a screen never plays a lower-resolution stand-in and then
 * switches up; it downloads the whole native file, THEN plays it."
 *
 * A LARGE media file — one the service worker will not fetch inside its own
 * playlist event and instead stages chunk by chunk (sw-player.js
 * `isLargeAsset`, `LARGE_ASSET_BYTES`) — is never mounted, never streamed
 * from origin, until its native bytes are on disk in the playlist cache.
 * While it downloads the rotation carries on over the items that ARE ready;
 * when nothing is ready the page keeps what was on glass (page.tsx defers the
 * playlist commit) or, on a first boot, shows the splash with the real
 * download bar. Small files keep the old behaviour: mount at once, the cache
 * fills behind them.
 *
 * Two shapes, both pure so the page's 13k lines stay out of the tests:
 *   - free-run rotation (`resolveActiveCounter` / `nextPlayableCounter`):
 *     the monotonic slide counter skips unready slots and never lands on one;
 *   - frame-locked sync (`resolveActiveSlot` with `syncLocked`): the slot is
 *     f(manifest, syncedNow) and is NEVER moved — an unready slot is HELD (the
 *     screen keeps its current frame) rather than skipped, so the group's
 *     phase is untouched.
 *
 * No React, no DOM, no network.
 */

/** Byte-for-byte the worker's threshold (sw-player.js LARGE_ASSET_BYTES). */
export const LARGE_MEDIA_BYTES = 8 * 1024 * 1024;

/** Byte-for-byte the worker's VIDEO_URL_RE: with no size to go on, a video URL is large. */
const VIDEO_URL_RE = /\.(mp4|m4v|mov|webm|mkv)(\?|#|$)/i;

/**
 * Mirrors the worker's `isLargeAsset`: a known positive size decides; without
 * one a video URL counts as large. The page and the worker MUST agree on this
 * or the page would hold an item the worker fetched inline (or stream one it
 * staged) — `mediaReadiness.test.ts` runs both against the same table.
 */
export function isLargeMedia(asset: { url: string; sizeBytes?: number | null }): boolean {
  if (!asset || !asset.url) return false;
  if (typeof asset.sizeBytes === 'number' && asset.sizeBytes > 0) return asset.sizeBytes >= LARGE_MEDIA_BYTES;
  return VIDEO_URL_RE.test(String(asset.url));
}

/**
 * Whether this player has an offline cache to wait for.
 *   'unavailable' — no service worker / Cache API, or the registration failed:
 *                   nothing can ever land on disk, so every item plays by
 *                   streaming (a no-SW player is never stranded).
 *   'unknown'     — the registration has not answered yet (first boot, ms).
 *   'ready'       — the worker is up; a large item waits for its bytes.
 */
export type CacheDriveState = 'unknown' | 'ready' | 'unavailable';

export interface ReadinessItem {
  id: string;
  /** `isLargeMedia` of the file the slide would mount. */
  large: boolean;
  /** The stable key (stableManifestUrlKey of the playback URL) the cache reports under. */
  cacheKey: string;
}

/** May this item be mounted right now? */
export function isItemReady(item: ReadinessItem, cacheDrive: CacheDriveState, onDisk: ReadonlySet<string>): boolean {
  if (!item.large) return true;
  if (cacheDrive === 'unavailable') return true;
  if (cacheDrive === 'unknown') return false;
  return onDisk.has(item.cacheKey);
}

export function readyItemIds(
  items: readonly ReadinessItem[],
  cacheDrive: CacheDriveState,
  onDisk: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const item of items) if (isItemReady(item, cacheDrive, onDisk)) out.add(item.id);
  return out;
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Free-run: the first counter c in [counter, counter + n) whose slot (c mod n)
 * is playable, or null when no slot is. The counter is the page's monotonic
 * slide index (consumers read it mod n), so the answer is a counter too.
 */
export function resolveActiveCounter(counter: number, n: number, playable: (index: number) => boolean): number | null {
  if (n <= 0) return null;
  for (let step = 0; step < n; step++) {
    const c = counter + step;
    if (playable(mod(c, n))) return c;
  }
  return null;
}

/**
 * Free-run advance: the first counter c in (from, from + n) whose slot is
 * playable — never the same slot again, and `from` itself when nothing else
 * is playable (the one ready item keeps the glass; a solo video loops
 * natively, an image simply stays). Returning `from` unchanged is how "do not
 * advance" is expressed, and React bails out of an identical state.
 */
export function nextPlayableCounter(from: number, n: number, playable: (index: number) => boolean): number {
  if (n <= 0) return from;
  for (let step = 1; step < n; step++) {
    const c = from + step;
    if (playable(mod(c, n))) return c;
  }
  return from;
}

export interface ActiveSlot {
  /** The slot to show, mod n; null when nothing may be shown. */
  activeIndex: number | null;
  /**
   * Frame-locked sync only: the timeline's slot is NOT ready, so the screen
   * must hold what it is showing rather than skip. `activeIndex` is still the
   * slot (for the servo / HUD); the page renders its last shown slide.
   */
  held: boolean;
  /** The slot to pre-mount hidden (next-up video), mod n; null when none. */
  nextIndex: number | null;
  /** Nothing is showable because at least one slot is still downloading. */
  waitingForDownload: boolean;
}

/**
 * What the render mounts for the current counter.
 *   free-run: the counter is re-aimed at the first playable slot (the page
 *             then converges `currentIndex` onto it); the next-up slot is the
 *             next playable one.
 *   synced:   the slot is fixed by the shared clock — an unready slot is held,
 *             and the next-up slot is the timeline's next (pre-mounted only
 *             when ready; an unready video is never mounted, not even hidden).
 */
export function resolveActiveSlot(input: {
  counter: number;
  n: number;
  syncLocked: boolean;
  playable: (index: number) => boolean;
  /** Ready for the cache (readiness alone, no daypart): drives `waitingForDownload`. */
  ready: (index: number) => boolean;
}): ActiveSlot {
  const { counter, n, syncLocked, playable, ready } = input;
  if (n <= 0) return { activeIndex: null, held: false, nextIndex: null, waitingForDownload: false };
  let anyUnready = false;
  for (let i = 0; i < n; i++) if (!ready(i)) { anyUnready = true; break; }
  if (syncLocked) {
    const activeIndex = mod(counter, n);
    const held = !playable(activeIndex);
    const nextCandidate = n > 1 ? mod(counter + 1, n) : null;
    const nextIndex = nextCandidate !== null && playable(nextCandidate) ? nextCandidate : null;
    return { activeIndex, held, nextIndex, waitingForDownload: held && anyUnready };
  }
  const activeCounter = resolveActiveCounter(counter, n, playable);
  if (activeCounter === null) {
    return { activeIndex: null, held: false, nextIndex: null, waitingForDownload: anyUnready };
  }
  const nextCounter = nextPlayableCounter(activeCounter, n, playable);
  return {
    activeIndex: mod(activeCounter, n),
    held: false,
    nextIndex: nextCounter === activeCounter ? null : mod(nextCounter, n),
    waitingForDownload: false,
  };
}

/**
 * When a new media playlist arrives, does it go on glass now or wait?
 *   - an EMERGENCY playlist never waits (rule 11: the alert precedes every
 *     download; stream it if that is what it takes);
 *   - a playlist with at least one ready file goes up now — the ready files
 *     rotate while the rest download;
 *   - a playlist with NOTHING ready waits ONLY while regular content is on
 *     glass (that content stays until a file lands). With nothing on glass
 *     (first boot / new screen) it goes up and the splash shows the download;
 *     with EMERGENCY content on glass it goes up too — an all-clear's regular
 *     content must never be held back behind the alert it replaces.
 */
export type PlaylistCommitDecision = 'commit' | 'defer';
export function decidePlaylistCommit(input: {
  isEmergency: boolean;
  anyReady: boolean;
  regularContentOnGlass: boolean;
}): PlaylistCommitDecision {
  if (input.isEmergency) return 'commit';
  if (input.anyReady) return 'commit';
  return input.regularContentOnGlass ? 'defer' : 'commit';
}

/** Distinct playable ids — ≤ 1 means "the slide IS the playlist": never advance, loop a video natively. */
export function countDistinctPlayable(items: readonly { id: string }[], playable: (index: number) => boolean): number {
  const ids = new Set<string>();
  items.forEach((item, index) => { if (playable(index)) ids.add(item.id); });
  return ids.size;
}
