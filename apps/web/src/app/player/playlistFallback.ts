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
 * IT IS THE LAST RESORT, AND IT IS REPORTED (the owner, 2026-11-13: "that
 * should be the last option right and then it should notify the admin, no one
 * wants the incorrect content to ever be playing on their screen"):
 *  • the card must have been up for two minutes without a break before the
 *    player steps to another playlist (`FallbackDwell` below has the exact
 *    rule — a short outage never gets there, and the page's own 30-second
 *    retries neither restart the two minutes nor count towards them);
 *  • while a screen is on a fallback, every routine report says so
 *    (`fallbackReport`: the two playlist ids and how long — never a name),
 *    and the server tells the organisation's admins and shows it on the
 *    Screens page. A backup playlist is never presented as "all is well".
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

/**
 * The card must have been up this long, without a break, before the player
 * steps to another playlist. Two minutes: long enough that a network blip, a
 * file still arriving or one slow retry is over, short enough that a screen
 * with a working playlist is not left on an error card for a class period.
 */
export const FALLBACK_DWELL_MS = 2 * MIN;

/**
 * The longest the card may be off the glass, with nothing proven playing,
 * before the two minutes start again. The page takes its all-files-failed
 * card down every 30 s to try the files once more; a file that is still
 * broken puts the card back within seconds. That is one failure, not two, so
 * it must not restart the clock — but a gap longer than this is no longer
 * "the card, continuously".
 */
export const FALLBACK_CARD_GAP_MS = 60_000;

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

/** Everything but the card: is stepping to another playlist allowed at all right now? */
export function fallbackEligible(i: Omit<FallbackDecisionInput, 'contentUnavailable'>): boolean {
  return i.playing && !i.emergency && !!i.onGlass && i.hasAlternative;
}

/** Should the playlist on glass be set aside so the next one can take the screen? (Once the dwell below is served.) */
export function shouldSetAside(i: FallbackDecisionInput): boolean {
  return i.contentUnavailable && fallbackEligible(i);
}

// ── How long the card has been up: the last-resort clock ────────────────────

export interface DwellObservation {
  /**
   * Everything else `shouldSetAside` asks for holds: regular content, playing,
   * no alert state, a media playlist on glass, another playlist to go to.
   */
  eligible: boolean;
  /** The playlist on glass (id + content signature) — a different one is a new clock. */
  key: string;
  /** The "Content unavailable" card is on the glass right now. */
  cardUp: boolean;
  /** The card is NOT up and a slide has proved it is showing (image loaded / video playing). */
  contentShowing: boolean;
  /** A monotonic clock (the page passes `performance.now()`), so a device clock correction cannot add time. */
  nowMs: number;
}

export interface DwellVerdict {
  /** The card has been up long enough: set the playlist aside now. */
  due: boolean;
  /** Card up and counting: how long until `due`. Null while nothing is counting. */
  dueInMs: number | null;
}

const NOT_COUNTING: DwellVerdict = { due: false, dueInMs: null };

/**
 * The two-minute rule, exactly:
 *
 *  1. Only time with the card ON THE GLASS counts. The total must reach
 *     `FALLBACK_DWELL_MS`, and the card must be up at that moment.
 *  2. A short break in the card (the page's 30-second retry re-mounting the
 *     files) does not restart the count — and does not add to it either: a
 *     retry is the screen trying to play the right content, never evidence
 *     against it.
 *  3. The count starts over the moment anything is proven playing, when the
 *     card has been off for longer than `FALLBACK_CARD_GAP_MS`, when the
 *     playlist on glass or its content changes, and whenever the fallback is
 *     not allowed at all (an alert, playback stopped, nowhere to fall back to).
 *
 * So a 20-second outage never falls back (its content plays again and the
 * count is gone), and a playlist that really cannot play falls back after two
 * minutes of card, however many retries happened in between.
 *
 * Pure: the page feeds it observations and owns the one timer.
 */
export class FallbackDwell {
  private key: string | null = null;
  /** Card-up time already banked in this episode. */
  private bankedMs = 0;
  private upSince: number | null = null;
  private downSince: number | null = null;

  constructor(
    private readonly dwellMs: number = FALLBACK_DWELL_MS,
    private readonly gapMs: number = FALLBACK_CARD_GAP_MS,
  ) {}

  reset(): void {
    this.key = null;
    this.bankedMs = 0;
    this.upSince = null;
    this.downSince = null;
  }

  observe(o: DwellObservation): DwellVerdict {
    if (!o.eligible || o.contentShowing || (this.key !== null && this.key !== o.key)) this.reset();
    if (!o.eligible || o.contentShowing) return NOT_COUNTING;
    if (!o.cardUp) {
      if (this.upSince !== null) {
        this.bankedMs += Math.max(0, o.nowMs - this.upSince);
        this.upSince = null;
        this.downSince = o.nowMs;
      } else if (this.downSince !== null && o.nowMs - this.downSince > this.gapMs) {
        this.reset();
      }
      return NOT_COUNTING;
    }
    if (this.downSince !== null && o.nowMs - this.downSince > this.gapMs) this.reset();
    this.key = o.key;
    this.downSince = null;
    if (this.upSince === null) this.upSince = o.nowMs;
    const total = this.bankedMs + Math.max(0, o.nowMs - this.upSince);
    return total >= this.dwellMs ? { due: true, dueInMs: 0 } : { due: false, dueInMs: this.dwellMs - total };
  }
}

// ── What the routine report says while a screen is on a fallback ────────────

/** The `playlistFallback` block of the telemetry report. Ids only — the server looks the names up. */
export interface PlaylistFallbackReport {
  /** The playlist the schedule wanted on this screen, which it cannot play. */
  fromPlaylistId: string;
  /** The playlist it is showing instead. */
  toPlaylistId: string;
  /** How long it has been showing it, in milliseconds (a duration: device clocks are not trusted). */
  forMs: number;
}

/** What the page remembers about the fallback on glass. */
export interface FallbackOnGlass {
  fromId: string;
  toId: string;
  /** `Date.now()` when this pair first took the screen. */
  sinceMs: number;
}

const REPORT_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** A week: longer than any back-off; a bigger number says nothing more. */
export const FALLBACK_REPORT_MAX_FOR_MS = 7 * 24 * 60 * MIN;

/** The same pair keeps its start time; a new pair starts now; no fallback is null. */
export function trackFallbackOnGlass(
  prev: FallbackOnGlass | null,
  now: { fellBack: boolean; fromId: string | null; toId: string | null },
  nowMs: number,
): FallbackOnGlass | null {
  if (!now.fellBack || !now.fromId || !now.toId || now.fromId === now.toId) return null;
  if (prev && prev.fromId === now.fromId && prev.toId === now.toId) return prev;
  return { fromId: now.fromId, toId: now.toId, sinceMs: nowMs };
}

/** The report block, or null when there is nothing honest to send (not on a fallback, or an id the server would refuse). */
export function fallbackReport(on: FallbackOnGlass | null, nowMs: number): PlaylistFallbackReport | null {
  if (!on || !REPORT_ID.test(on.fromId) || !REPORT_ID.test(on.toId)) return null;
  const forMs = Math.min(FALLBACK_REPORT_MAX_FOR_MS, Math.max(0, Math.floor(nowMs - on.sinceMs)));
  return { fromPlaylistId: on.fromId, toPlaylistId: on.toId, forMs };
}
