/**
 * Seamless file swaps under the same playlist items (video guarantee,
 * 2026-10-12 — owner rule: "the viewer must never see the switch").
 *
 * When the server moves a screen from a video's original to its validated
 * 1080p copy (a demotion after proven, visible stutter) — or back, after an
 * operator's "Try full quality again" — the manifest changes ONLY the file a
 * playlist item names: same item ids, same order, same durations. Without
 * this module such a manifest went through the ordinary commit path, which
 * either (a) put a mixed playlist on glass at once with the new file still
 * downloading, so the video simply vanished from the rotation — or was cut
 * mid-play if it was on glass — or (b) held a single-video playlist until the
 * copy landed and then switched it mid-play.
 *
 * The rule, as two pure functions the page drives:
 *   1. `renditionSwapIds` recognises a PURE file swap (anything else — an
 *      item added, removed, reordered, retimed, a picture changed — is an
 *      ordinary manifest change and takes the ordinary path).
 *   2. `decideRenditionSwap`: the playlist on glass keeps playing its current
 *      file ('hold') until EVERY swapped file is on disk and hash-verified
 *      (the readiness gate's own answer — the chunked, verified precache of
 *      rule 17 is what fills it); then it waits for a natural boundary — the
 *      active item is not a swapped one, the item changed, or the active
 *      video completed a loop since the files became ready — and only then
 *      commits ('commit'). Never mid-play, never a reload. An emergency is
 *      never held (rule 11).
 *
 * No React, no DOM, no timers, no network.
 */

export interface SwapItem {
  id: string;
  durationMs?: number | null;
  sequenceOrder?: number | null;
  transitionType?: string | null;
  muted?: boolean | null;
  asset?: { fileUrl?: string | null; mimeType?: string | null } | null;
}

const isVideo = (it: SwapItem) => typeof it.asset?.mimeType === 'string' && /^video\//i.test(it.asset.mimeType);
const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

/**
 * The ids of the items whose ONLY change is the video file they name, or null
 * when `incoming` is not a pure file swap of `onGlass` (no change at all is
 * also null — nothing to swap).
 */
export function renditionSwapIds(
  onGlass: readonly SwapItem[] | null | undefined,
  incoming: readonly SwapItem[] | null | undefined,
  urlKey: (url: string) => string,
): Set<string> | null {
  if (!Array.isArray(onGlass) || !Array.isArray(incoming)) return null;
  if (onGlass.length === 0 || onGlass.length !== incoming.length) return null;
  const ids = new Set<string>();
  for (let i = 0; i < incoming.length; i++) {
    const a = onGlass[i];
    const b = incoming[i];
    if (!a || !b || String(a.id) !== String(b.id)) return null;
    if (!same(a.sequenceOrder, b.sequenceOrder) || !same(a.durationMs, b.durationMs) ||
        !same(a.transitionType, b.transitionType) || !same(a.muted, b.muted)) return null;
    const ua = urlKey(String(a.asset?.fileUrl ?? ''));
    const ub = urlKey(String(b.asset?.fileUrl ?? ''));
    if (ua === ub) {
      if (!same(a.asset?.mimeType, b.asset?.mimeType)) return null;
      continue;
    }
    // Only a VIDEO may change file under the same item (that is what a
    // rendition is); any other file change is ordinary content.
    if (!isVideo(a) || !isVideo(b)) return null;
    ids.add(String(b.id));
  }
  return ids.size > 0 ? ids : null;
}

export type RenditionSwapDecision = 'hold' | 'commit';

export interface RenditionSwapState {
  /** Items whose file changes. */
  swapIds: ReadonlySet<string>;
  /** Items of the incoming playlist whose file may be mounted now (readiness gate). */
  readyIds: ReadonlySet<string>;
  /** The item on glass right now, or null when nothing is. */
  activeItemId: string | null;
  /**
   * Captured the first time every swapped file was ready: the item on glass
   * and the loop-boundary sequence at that moment. Null until then.
   */
  armed: { activeItemId: string | null; boundarySeq: number } | null;
  /** The page's loop-boundary sequence now (monotonic; a completed lap of the active video). */
  boundarySeq: number;
  isEmergency: boolean;
}

/** Every swapped file is on disk (verified) — the precondition for any swap. */
export function swapFilesReady(swapIds: ReadonlySet<string>, readyIds: ReadonlySet<string>): boolean {
  for (const id of swapIds) if (!readyIds.has(id)) return false;
  return true;
}

export function decideRenditionSwap(s: RenditionSwapState): RenditionSwapDecision {
  if (s.isEmergency) return 'commit';
  if (!swapFilesReady(s.swapIds, s.readyIds)) return 'hold';
  // Nothing swapped is on glass: the swapped items mount later, from disk,
  // at their own turn (or as the hidden next-up, which is not visible).
  if (s.activeItemId === null || !s.swapIds.has(s.activeItemId)) return 'commit';
  if (!s.armed) return 'hold';
  // A natural boundary since the files became ready: the item changed, or
  // the active video wrapped its loop.
  if (s.activeItemId !== s.armed.activeItemId) return 'commit';
  if (s.boundarySeq > s.armed.boundarySeq) return 'commit';
  return 'hold';
}
