/**
 * Playlist fallback (2026-11-13 — "I want my screens to work always").
 *
 * What happened on a customer's portrait screen (2026-11-11): two playlists
 * were scheduled onto it, both active all day. The newer one — a single 4K
 * video the box could not play smoothly — won the screen (player rule 7:
 * the first window-open replace playlist in the manifest's order). When that
 * one file was finally set aside, the playlist had nothing left, and the
 * screen showed its "Content unavailable" card for hours — with a second,
 * perfectly good playlist sitting in the very manifest it was holding.
 *
 * The rule now: a media playlist that has NOTHING this screen can show is set
 * aside for a while, and the next window-open replace playlist in the
 * manifest's own order takes the screen. The order is still the server's; the
 * player only steps past an entry it has proved it cannot play. When no other
 * playlist is scheduled, nothing changes: the card shows exactly as before.
 *
 * It comes back:
 *  • at once when the set-aside playlist's content changes (it is keyed by the
 *    playlist AND its content signature — a re-publish, a converted file, a
 *    replaced asset is a new signature and is tried immediately);
 *  • on a page reload (in memory only, like unplayableMedia.ts);
 *  • otherwise after a back-off — 15, 30, 60, then 120 minutes — because a
 *    retry puts the failing playlist back on the glass until it fails again,
 *    and a transient outage must not leave a screen on yesterday's content
 *    for the rest of the day.
 *
 * NEVER for an emergency: the page does not consult this module while an
 * alert is raised, held or on glass, and an emergency manifest's content is
 * never a candidate. How an alert's own content plays is not changed by a
 * signage reliability fix.
 *
 * Templates are never set aside (nothing here can judge a template board) but
 * a template may be what the screen falls back TO.
 *
 * Pure: no React, no DOM, no timers, no network — the page owns the effects.
 */

const MIN = 60_000;

/** How long a set-aside playlist stays out, by how many times in a row it has been set aside. */
export const FALLBACK_RETRY_STEPS_MS: readonly number[] = [15 * MIN, 30 * MIN, 60 * MIN, 120 * MIN];

/** A long session must not grow without limit (a screen has a handful of schedules). */
export const FALLBACK_MAX_ENTRIES = 32;

/** The card must have been up this long before the player steps to another playlist. */
export const FALLBACK_DWELL_MS = 10_000;

/** What a set-aside is recorded under. `null` = this entry can never be set aside (a template). */
export interface FallbackKey {
  id: string;
  /** The playlist's content signature — a different one is a different thing to try. */
  sig: string;
}

interface Entry {
  sig: string;
  /** Consecutive set-asides of this same content. */
  count: number;
  untilMs: number;
}

export class PlaylistFallbackLedger {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly steps: readonly number[] = FALLBACK_RETRY_STEPS_MS,
    private readonly maxEntries: number = FALLBACK_MAX_ENTRIES,
  ) {}

  /** Set this content aside. Returns when it may be tried again. */
  setAside(key: FallbackKey, nowMs: number): number {
    const prev = this.entries.get(key.id);
    const count = prev && prev.sig === key.sig ? prev.count + 1 : 1;
    const step = this.steps[Math.min(count, this.steps.length) - 1] ?? this.steps[this.steps.length - 1] ?? 15 * MIN;
    const untilMs = nowMs + step;
    this.entries.delete(key.id); // re-insert: Map order is the eviction order
    this.entries.set(key.id, { sig: key.sig, count, untilMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
    return untilMs;
  }

  /** Out of the running right now? A different signature is never set aside. */
  isSetAside(key: FallbackKey, nowMs: number): boolean {
    const e = this.entries.get(key.id);
    return !!e && e.sig === key.sig && nowMs < e.untilMs;
  }

  /** When this content may be tried again, or null when it is not set aside. */
  untilFor(key: FallbackKey, nowMs: number): number | null {
    return this.isSetAside(key, nowMs) ? (this.entries.get(key.id) as Entry).untilMs : null;
  }

  /**
   * A set-aside has run out and nobody has acted on it yet: time to put the
   * manifest's order back on the glass. Each due entry is reported ONCE — its
   * count is kept, so failing again steps the back-off up, not back to 15 min.
   */
  takeDue(nowMs: number): boolean {
    let due = false;
    for (const e of this.entries.values()) {
      if (e.untilMs > 0 && nowMs >= e.untilMs) {
        e.untilMs = 0; // not set aside any more, and not reported again
        due = true;
      }
    }
    return due;
  }

  /** The playlist played after all: its history is forgotten (the next failure starts at 15 min). */
  clear(id: string): void {
    this.entries.delete(id);
  }

  get size(): number {
    return this.entries.size;
  }
}

export interface ReplacePick<T> {
  /** What takes the screen, or null when nothing is open. */
  winner: T | null;
  /** What the manifest's order alone would have chosen. */
  primary: T | null;
  /** `winner` is not `primary` — the screen is on a fallback. */
  fellBack: boolean;
  /** Another open replace playlist exists that is not set aside — a later failure has somewhere to go. */
  hasAlternative: boolean;
}

/**
 * The window-open replace playlists, in the manifest's order → the one that
 * takes the screen. The first that is not set aside wins. If every one is set
 * aside, the manifest's own first choice wins (its card is the honest state:
 * nothing scheduled here can play).
 */
export function pickReplaceWinner<T>(
  openReplace: readonly T[],
  keyOf: (entry: T) => FallbackKey | null,
  ledger: PlaylistFallbackLedger,
  nowMs: number,
): ReplacePick<T> {
  const primary = openReplace[0] ?? null;
  if (!primary) return { winner: null, primary: null, fellBack: false, hasAlternative: false };
  const usable = openReplace.filter((e) => {
    const key = keyOf(e);
    return !key || !ledger.isSetAside(key, nowMs);
  });
  const winner = usable[0] ?? primary;
  return {
    winner,
    primary,
    fellBack: winner !== primary,
    hasAlternative: usable.some((e) => e !== winner),
  };
}

export interface FallbackDecisionInput {
  /** The "Content unavailable" card is what the screen has to show. */
  contentUnavailable: boolean;
  /** Playing regular content (not stopped, not connecting). */
  playing: boolean;
  /** ANY alert state: raised, held, on glass, provisional, pushed. */
  emergency: boolean;
  /** The media playlist on glass as selected from the manifest, or null (template / none / legacy manifest). */
  onGlass: FallbackKey | null;
  /** Another open replace playlist is not set aside. */
  hasAlternative: boolean;
}

/** Should the playlist on glass be set aside so the next one can take the screen? */
export function shouldSetAside(i: FallbackDecisionInput): boolean {
  return i.contentUnavailable && i.playing && !i.emergency && !!i.onGlass && i.hasAlternative;
}
