/**
 * collapseCopies — a playlist that is the SAME video added more than once is one
 * video that repeats.
 *
 * RIOT Cleveland (2026-09-29): the operator had a video that hitched at the loop
 * point and added it three times (their second screen, the Video Wall, was set up
 * the same way). The player counts a "solo" playlist by ITEM id, so three items
 * are three slides, and every lap ended the way a change between different clips
 * ends: the outgoing copy unmounts the instant the next is active (audit F4) and
 * the incoming copy fades up from black over a second — a cut to black at the
 * seam, worse than the hitch being worked around. Meanwhile the next-up copy sat
 * hidden and decoding beside the first: two hardware decoders for one picture.
 *
 * Every screen collapses such a playlist to its first item before anything else
 * looks at it (`page.tsx`, the `sorted` memo), so every rule that follows —
 * solo, native loop, two-deck hand-off, readiness, the seam probe — sees the
 * operator's intent: one video, repeating, one decoder.
 *
 * Deliberately narrow, because a wrong collapse drops content:
 *   - EVERY item is a video of the same file (a single image or a second clip
 *     anywhere means a real rotation — untouched);
 *   - none carries a daypart of its own (copies with different days or hours are
 *     a schedule, not duplicates);
 *   - all share one mute setting (they would otherwise not sound alike).
 *
 * Pure: no React, no DOM.
 */

export interface CollapsibleItem {
  muted?: boolean | null;
  daysOfWeek?: unknown;
  timeStart?: unknown;
  timeEnd?: unknown;
  asset?: { mimeType?: string | null; fileUrl?: string | null } | null;
}

const isVideo = (i: CollapsibleItem): boolean => (i.asset?.mimeType ?? '').startsWith('video/');

/** The items the player should treat as the playlist: the first copy alone when they are all the same video, else the input untouched. */
export function collapseIdenticalVideoCopies<T extends CollapsibleItem>(items: readonly T[]): readonly T[] {
  if (items.length < 2) return items;
  const first = items[0];
  const url = first.asset?.fileUrl;
  if (!url || !isVideo(first)) return items;
  const muted = first.muted !== false;
  for (const it of items) {
    if (!isVideo(it) || it.asset?.fileUrl !== url) return items;
    if ((it.muted !== false) !== muted) return items;
    // The same truthiness `isItemValid` uses: any daypart at all is a schedule.
    if (it.daysOfWeek || it.timeStart || it.timeEnd) return items;
  }
  return [first];
}
