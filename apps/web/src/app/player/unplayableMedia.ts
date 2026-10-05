/**
 * Unplayable items (2026-10-05, the media beta-test campaign — "a screen must
 * never freeze or go black because one file is bad").
 *
 * What the testers measured on the real web player: ONE undecodable video in
 * a free-running playlist froze the screen for good on its second visit (a
 * 53-byte text file named .mp4, an MP4 with no index, a zeroed index, a JPEG
 * named .mp4, a 0-frame track, a mid-file decode error), and a broken image —
 * or an audio file, which the player has no way to show — took its full slot
 * as a black slide on every lap. The cause was one missing fact: the page
 * recorded a failure (`markItemFailed`) only to detect "EVERY item failed", and
 * nothing that chooses the next slide ever asked whether an item had failed.
 * So a failed video stayed the hidden next-up slide, its one-shot `error` event
 * never fired again, and nothing advanced; a failed image kept its slot.
 *
 * The rule now: an item this screen failed to load or decode — or whose type
 * it cannot show at all — is NOT PLAYABLE, and the slide choice treats it
 * exactly like a file still downloading (mediaReadiness.ts, CLAUDE.md player
 * rule 17(d)): free-run steps over it, a frame-locked sync group HOLDS its
 * slot (the timeline is never moved), and when nothing is playable the screen
 * shows its "Content unavailable" card — never black.
 *
 * A failure is not forever: it is keyed by the item AND its file (URL +
 * digest), so a re-publish or a conversion that gives the item a new file is
 * tried at once, and the same file is tried again after `UNPLAYABLE_RETRY_MS`
 * (a transient network failure must not exile a good file for the rest of the
 * page's life). In-memory per page load, on purpose: `playbackSafety.ts`
 * already persists the one class that must survive a reload — a file that
 * takes the renderer down — and a decode failure does not need a disk write.
 *
 * Emergency playlists never enter this module (the page gates it): how an
 * alert's own content plays is not changed by a signage reliability fix.
 *
 * Pure: no React, no DOM, no timers, no network — the page owns the effects.
 */

/** How long a failed item stays out of the rotation before it is tried again. */
export const UNPLAYABLE_RETRY_MS = 5 * 60_000;

/** Bound on remembered failures — a long session must not grow without limit. */
export const UNPLAYABLE_MAX_ENTRIES = 256;

/**
 * Can this player put an item of this type on the glass at all? Audio cannot:
 * the render has video, web page/PDF and image branches, and an audio file
 * fell through to `<img>` — a blank slide with no sound, every lap. Playing
 * audio is a product decision still open; until then an audio item is
 * unplayable from the start. Everything else keeps the branch it always had.
 */
export function playerCanShow(mimeType: string | null | undefined): boolean {
  return !/^audio\//i.test(String(mimeType ?? '').trim());
}

/** The identity a failure is recorded under: the item, its file and the file's digest. */
export function unplayableKey(input: { id: string; url: string; hash?: string | null }): string {
  return `${input.id}\n${input.url}\n${String(input.hash ?? '').toLowerCase()}`;
}

/** The failures this page has seen, and when each one may be tried again. */
export class UnplayableLedger {
  private readonly failedAt = new Map<string, number>();

  constructor(
    private readonly retryMs: number = UNPLAYABLE_RETRY_MS,
    private readonly maxEntries: number = UNPLAYABLE_MAX_ENTRIES,
  ) {}

  /**
   * Record a failure. Returns true when it is NEWS — the key was not already
   * out of the rotation — so the page logs once and re-renders once, however
   * many events one broken element fires.
   */
  record(key: string, nowMs: number): boolean {
    const wasOut = this.isUnplayable(key, nowMs);
    const previous = this.failedAt.get(key);
    this.failedAt.delete(key); // re-insert: Map order is the eviction order
    this.failedAt.set(key, previous !== undefined ? Math.max(previous, nowMs) : nowMs);
    while (this.failedAt.size > this.maxEntries) {
      const oldest = this.failedAt.keys().next();
      if (oldest.done) break;
      this.failedAt.delete(oldest.value);
    }
    return !wasOut;
  }

  /**
   * Out of the rotation right now? `nowMs` may lag the moment of the failure
   * (the page re-evaluates on a coarse clock), which reads as "still out".
   */
  isUnplayable(key: string, nowMs: number): boolean {
    const at = this.failedAt.get(key);
    return at !== undefined && nowMs - at < this.retryMs;
  }

  get size(): number {
    return this.failedAt.size;
  }
}

/**
 * Nothing in this playlist can be shown: every item failed or is a type the
 * player cannot show. An empty playlist is not "unplayable" — it is empty.
 */
export function everyItemUnplayable(count: number, unplayable: (index: number) => boolean): boolean {
  if (count <= 0) return false;
  for (let i = 0; i < count; i++) if (!unplayable(i)) return false;
  return true;
}

/**
 * Frame-locked sync, slot HELD: which slide stays on glass — the most recent
 * one shown that may still be shown (`recentShown` newest first). Null when
 * none may: then nothing is mounted and the page shows its own screen rather
 * than a failed slide. Never chooses a slot by itself, so the group's
 * timeline (on-screen = f(manifest, syncedNow)) is untouched.
 */
export function pickHeldSlide(
  recentShown: readonly (number | null)[],
  count: number,
  showable: (index: number) => boolean,
): number | null {
  for (const index of recentShown) {
    if (index !== null && index >= 0 && index < count && showable(index)) return index;
  }
  return null;
}
