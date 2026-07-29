/**
 * syncTimeline — the deterministic playlist timeline for frame-locked
 * multi-screen sync (2026-07-28).
 * Design: docs/research/2026-07-28-multiscreen-sync/00-DESIGN.md §3.
 *
 * THE INVARIANT: what is on screen is a pure function of
 * (playlist items, synced server time). No local state, no "when did
 * this screen start," no leader. Every screen that shares a playlist
 * and a clock computes the same slide at the same instant — reboots,
 * late joiners, and network blips all land back in phase by
 * construction.
 *
 * Anchor is the Unix epoch (0): position = syncedNow mod loopDuration.
 * Stateless — nothing to store, publish, or desync. (A per-group
 * stored anchor was considered and rejected; see design doc §3.1.)
 *
 * Durations: item.durationMs with the SAME 10000ms fallback the legacy
 * heartbeat uses (page.tsx:4854), floored at 500ms so a zero/garbage
 * duration can't degenerate the mod math. NOTE the deliberate behavior
 * difference from legacy free-run mode: in sync mode a VIDEO occupies
 * exactly its durationMs slot on the timeline (looping if the file is
 * shorter, cut at the boundary if longer) — legacy mode lets videos run
 * to natural end. A shared timeline requires fixed slots; durationMs is
 * the operator-set slot length.
 *
 * Pure TypeScript, zero React/DOM — exhaustively unit-testable without
 * mounting the 8.6k-line player page (same discipline as
 * emergencyReconcile.ts / syncClock.ts).
 */

export interface SyncTimelineItem {
  id?: string;
  durationMs?: number | null;
}

export interface TimelinePosition {
  /** Mod-N index into the (already sorted) items array. */
  index: number;
  /** How far into that item we are, ms ∈ [0, itemDurationMs). */
  offsetInItemMs: number;
  /** This item's effective slot length. */
  itemDurationMs: number;
  /** Synced-time instant of the next flip (this item's slot end). */
  boundaryAtMs: number;
  /** Full loop length, ms. */
  loopDurationMs: number;
}

/** Same fallback the legacy heartbeat applies (page.tsx:4854). */
const FALLBACK_DURATION_MS = 10_000;
/** Floor — a 0/negative/NaN duration must not degenerate the loop. */
const MIN_DURATION_MS = 500;

export function effectiveDurationMs(item: SyncTimelineItem): number {
  const d = typeof item.durationMs === 'number' && Number.isFinite(item.durationMs)
    ? item.durationMs
    : FALLBACK_DURATION_MS;
  return Math.max(MIN_DURATION_MS, Math.floor(d));
}

/**
 * Where on the shared timeline are we at syncedNowMs?
 * `items` must already be in play order (the caller's sortedItemsRef).
 * Returns null for an empty list.
 */
export function resolveTimeline(
  items: readonly SyncTimelineItem[],
  syncedNowMs: number,
): TimelinePosition | null {
  if (!items.length || !Number.isFinite(syncedNowMs)) return null;

  const durations = items.map(effectiveDurationMs);
  const loopDurationMs = durations.reduce((a, b) => a + b, 0);

  // True mathematical mod — behaves for negative inputs too (a test
  // clock or a trim larger than syncedNow must not explode).
  const p = ((syncedNowMs % loopDurationMs) + loopDurationMs) % loopDurationMs;

  let cum = 0;
  for (let i = 0; i < durations.length; i++) {
    const end = cum + durations[i];
    if (p < end) {
      return {
        index: i,
        offsetInItemMs: p - cum,
        itemDurationMs: durations[i],
        boundaryAtMs: syncedNowMs - (p - cum) + durations[i],
        loopDurationMs,
      };
    }
    cum = end;
  }
  // Unreachable (p < loopDuration by construction) — defensive.
  return {
    index: items.length - 1,
    offsetInItemMs: durations[durations.length - 1] - 1,
    itemDurationMs: durations[durations.length - 1],
    boundaryAtMs: syncedNowMs + 1,
    loopDurationMs,
  };
}

/**
 * Target media time for a video occupying a timeline slot.
 * File shorter than the slot → loop deterministically (offset mod file
 * length); unknown/zero file length → play-from-slot-offset best effort.
 * All screens compute the same value because the file (and therefore
 * its metadata duration) is identical everywhere.
 */
export function videoTargetMs(offsetInItemMs: number, videoDurationMs: number | null): number {
  if (
    videoDurationMs !== null &&
    Number.isFinite(videoDurationMs) &&
    videoDurationMs > 200 // sub-200ms metadata is noise/not-yet-loaded
  ) {
    return offsetInItemMs % videoDurationMs;
  }
  return offsetInItemMs;
}

/**
 * The monotonic-counter bridge: the player's currentIndex only ever
 * increases (every consumer reads it % N — recon doc §1). Given the
 * current counter and the timeline's resolved mod-N index, return the
 * new counter value (always >= current; forward-wrap when the timeline
 * is "behind" the counter mod-space). Returning the same value means
 * "no change".
 */
export function advanceCounterTo(currentCounter: number, resolvedIndex: number, itemCount: number): number {
  if (itemCount <= 0) return currentCounter;
  const curMod = ((currentCounter % itemCount) + itemCount) % itemCount;
  const delta = ((resolvedIndex - curMod) % itemCount + itemCount) % itemCount;
  return currentCounter + delta;
}
