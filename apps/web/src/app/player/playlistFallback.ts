/**
 * Playlist fallback (2026-11-13/14 — "I want my screens to work always").
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
 * THE OWNER'S RULING (2026-11-12): "that should be the last option right and
 * then it should notify the admin, no one wants the incorrect content to ever
 * be playing on their screen." So:
 *
 *  LAST RESORT. The card must have been on the glass for two full minutes
 *  (`FallbackDwell` has the exact rule) — the page's own recoveries (skip the
 *  broken item, re-mount the last good file in place, retry every file) have
 *  all run and failed by then; a short outage never gets there.
 *
 *  REPORTED. From the moment the backup is proven on the glass until the
 *  schedule's own choice has played again for five minutes, every routine
 *  report carries the episode (`fallbackReport`: two playlist ids, a duration
 *  and a state — never a name). The server tells the organisation's admins
 *  when it starts and when it is over, and the Screens page says it while it
 *  lasts. A backup playlist is never presented as "all is well".
 *
 *  IT COMES BACK BY ITSELF, as soon as the first choice can play:
 *   • at once when its content changes (it is keyed by the playlist AND its
 *     content signature — a re-publish, a converted file, a replaced asset is
 *     a new signature and is tried immediately);
 *   • on a page reload (the set-aside is in memory only, like
 *     unplayableMedia.ts — the EPISODE survives the reload so the admin still
 *     hears how it ended, `readStoredFallbackEpisode`);
 *   • otherwise after a back-off — 15, 30, 60, then 120 minutes — because a
 *     retry puts it back on the glass until it fails again. A retry that is
 *     provably pointless (every file still blocked, out of the rotation, or of
 *     a type this screen cannot show — `hopeless`) is not put on the glass to
 *     show the card again; it is asked again every minute and goes up the
 *     moment one file could play.
 *
 * NEVER FOR AN EMERGENCY: the page never sets a playlist aside, retries one,
 * or moves the episode while any alert state is up (raised, held, pending,
 * pushed — a banner included); an emergency manifest's content is never a
 * candidate. How an alert's own content plays is not changed by a signage
 * reliability fix.
 *
 * KILL SWITCH: the manifest's `playback.playlistFallback: 'off'`
 * (`PLAYLIST_FALLBACK_DISABLED` on the API) — the schedule's first choice
 * always plays, nothing is set aside, nothing is reported.
 *
 * Templates are never set aside (nothing here can judge a template board) but
 * a template may be what the screen falls back TO.
 *
 * Pure: no React, no DOM, no timers, no network, no storage — the page owns
 * the effects.
 */

const MIN = 60_000;

/** How long a set-aside playlist stays out, by how many times in a row it has been set aside. */
export const FALLBACK_RETRY_STEPS_MS: readonly number[] = [15 * MIN, 30 * MIN, 60 * MIN, 120 * MIN];

/** A long session must not grow without limit (a screen has a handful of schedules). */
export const FALLBACK_MAX_ENTRIES = 32;

/**
 * The card must have been on the glass this long before the player
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

/**
 * The schedule's first choice must play this long, with the card never up,
 * before it counts as back (the episode ends, the admin is told, its back-off
 * history is forgotten). The customer alert emails hold a recovery for the
 * same five minutes before they say "back". Shorter, a file that plays for a
 * minute and then fails would be "recovered" on every retry and the back-off
 * would never grow.
 */
export const FALLBACK_RECOVERY_MS = 5 * MIN;

/** How long `recovered` keeps riding the report after the proof, so one lost post cannot lose it. */
export const FALLBACK_RECOVERED_REPORT_MS = 10 * MIN;

/** A week: longer than any back-off; a bigger number says nothing more. */
export const FALLBACK_REPORT_MAX_FOR_MS = 7 * 24 * 60 * MIN;

/** What a set-aside is recorded under. `null` = this entry can never be set aside (a template). */
export interface FallbackKey {
  id: string;
  /** The playlist's content signature — a different one is a different thing to try. */
  sig: string;
}

/**
 * Is every item of this set-aside playlist still provably unable to play —
 * blocked by the playback circuit breaker, out of the rotation after a
 * failure, or of a type this screen cannot show? The page answers it from the
 * same ledgers that put the card up.
 */
export type FallbackHopeless = (key: FallbackKey) => boolean;

interface Entry {
  sig: string;
  /** Consecutive set-asides of this same content. */
  count: number;
  /** When it may be tried again; 0 = released (its retry was taken). */
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

  /**
   * Out of the running right now? A different signature is never set aside.
   * Once its time is up it stays out only while `hopeless` says a retry could
   * show nothing but the card — and never after its retry was taken.
   */
  isSetAside(key: FallbackKey, nowMs: number, hopeless?: FallbackHopeless): boolean {
    const e = this.entries.get(key.id);
    if (!e || e.sig !== key.sig || e.untilMs === 0) return false;
    if (nowMs < e.untilMs) return true;
    return !!hopeless?.(key);
  }

  /** When this content may be tried again, or null when it is not set aside. */
  untilFor(key: FallbackKey, nowMs: number): number | null {
    return this.isSetAside(key, nowMs) ? (this.entries.get(key.id) as Entry).untilMs : null;
  }

  /**
   * A set-aside has run out and nobody has acted on it yet: time to put the
   * manifest's order back on the glass. Each due entry is reported ONCE — its
   * count is kept, so failing again steps the back-off up, not back to 15 min.
   * An entry `hopeless` still holds out stays aside and is asked again on the
   * next call (the page's minute tick).
   */
  takeDue(nowMs: number, hopeless?: FallbackHopeless): boolean {
    let due = false;
    for (const [id, e] of this.entries) {
      if (e.untilMs > 0 && nowMs >= e.untilMs) {
        if (hopeless?.({ id, sig: e.sig })) continue;
        e.untilMs = 0; // released, and not reported again
        due = true;
      }
    }
    return due;
  }

  /** The playlist played after all: its history is forgotten (the next failure starts at 15 min). */
  clear(id: string): void {
    this.entries.delete(id);
  }

  /** The kill switch: nothing is set aside any more. */
  clearAll(): void {
    this.entries.clear();
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
  hopeless?: FallbackHopeless,
): ReplacePick<T> {
  const primary = openReplace[0] ?? null;
  if (!primary) return { winner: null, primary: null, fellBack: false, hasAlternative: false };
  const usable = openReplace.filter((e) => {
    const key = keyOf(e);
    return !key || !ledger.isSetAside(key, nowMs, hopeless);
  });
  const winner = usable[0] ?? primary;
  return {
    winner,
    primary,
    fellBack: winner !== primary,
    hasAlternative: usable.some((e) => e !== winner),
  };
}

/**
 * Every item of a playlist is out (`isOut` — blocked, out of the rotation,
 * or a type the screen cannot show). An empty playlist is never "hopeless":
 * there is nothing to judge.
 */
export function everyItemOut<I>(items: readonly I[], isOut: (item: I) => boolean): boolean {
  return items.length > 0 && items.every(isOut);
}

export interface FallbackDecisionInput {
  /** The "Content unavailable" card is what the screen has to show. */
  contentUnavailable: boolean;
  /** Playing regular content (not stopped, not connecting). */
  playing: boolean;
  /** ANY alert state: raised, held, on glass, provisional, pushed (a banner too). */
  emergency: boolean;
  /** The media playlist on glass, or null (template / none / legacy manifest). */
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

// ── Is the schedule's choice really back? ───────────────────────────────────

export interface RecoveryObservation {
  /** The schedule's FIRST choice on the glass (id + content), or null when it is not (a backup, an alert, stopped). */
  key: string | null;
  /** The "Content unavailable" card is up. */
  cardUp: boolean;
  /** Content is proven on the glass right now (the render proof would read `pl:`). */
  contentShowing: boolean;
  /** Monotonic (`performance.now()`). */
  nowMs: number;
}

/**
 * The first choice counts as back once it has shown content and then played
 * for `FALLBACK_RECOVERY_MS` without the card ever coming up — and is showing
 * at that moment. A slide change (the next file loading) is not a failure; the
 * card, a different playlist, an alert or a stop starts it over.
 */
export class RecoveryProof {
  private key: string | null = null;
  private since: number | null = null;

  constructor(private readonly holdMs: number = FALLBACK_RECOVERY_MS) {}

  reset(): void {
    this.key = null;
    this.since = null;
  }

  observe(o: RecoveryObservation): boolean {
    if (o.key !== this.key) {
      this.key = o.key;
      this.since = null;
    }
    if (!o.key || o.cardUp) {
      this.since = null;
      return false;
    }
    if (this.since === null) {
      if (o.contentShowing) this.since = o.nowMs;
      return false;
    }
    return o.contentShowing && o.nowMs - this.since >= this.holdMs;
  }
}

// ── The episode: what the routine report says, from start to finish ────────

/**
 *  backup    — a backup playlist is on the glass, proven showing content;
 *  retrying  — the schedule's choice is back on the glass being tried (after a
 *              back-off, a content change or a reload) and has not yet played
 *              for `FALLBACK_RECOVERY_MS`;
 *  recovered — it has: said for `FALLBACK_RECOVERED_REPORT_MS`, then dropped.
 */
export type FallbackEpisodeState = 'backup' | 'retrying' | 'recovered';

export interface FallbackEpisode {
  /** The schedule's first choice, which this screen could not play. */
  fromId: string;
  /** backup / retrying: the backup (last) on the glass; recovered: the playlist proven playing. */
  toId: string;
  /** Wall clock (`Date.now()`) when the backup first went up — kept across reloads. */
  startedAtMs: number;
  state: FallbackEpisodeState;
  /** Wall clock when the recovery was proven (recovered only). */
  endedAtMs?: number;
}

/** What is committed on the glass, by playlist id. */
export interface EpisodeGlass {
  /** The first window-open replace playlist — the schedule's choice. */
  firstChoiceId: string | null;
  /** The playlist actually on the glass. */
  onGlassId: string | null;
  /** `onGlassId` is a backup, not the first choice. */
  fellBack: boolean;
}

/**
 * What a COMMIT put on the glass. The page records it where content is
 * committed, never at selection: a playlist deferred for its download, or a
 * file swap waiting for its boundary, is not on the glass yet.
 */
export interface FallbackCommitted extends EpisodeGlass {
  /** The media playlist on the glass (null for a template board — never set aside). */
  onGlassKey: FallbackKey | null;
  /** Another open replace playlist is not set aside: a failure here has somewhere to go. */
  hasAlternative: boolean;
}

export interface EpisodeObservation {
  /** The kill switch: there is no episode at all. */
  disabled: boolean;
  /** An alert state is up, or playback is stopped: the episode stands still. */
  frozen: boolean;
  /**
   * undefined — nothing committed yet (a page still booting): keep what we have;
   * null — no ranked choice on the glass (nothing scheduled, a legacy manifest): it is over.
   */
  glass: EpisodeGlass | null | undefined;
  /** The backup on the glass is proven showing content and the card is not up. */
  backupShowing: boolean;
  /** The first choice passed `RecoveryProof`. */
  firstChoiceProven: boolean;
  /** Wall clock (`Date.now()`). */
  nowMs: number;
}

/** The next episode. Returns `prev` itself when nothing changed (the page writes storage only on a change). */
export function nextFallbackEpisode(prev: FallbackEpisode | null, o: EpisodeObservation): FallbackEpisode | null {
  if (o.disabled) return null;
  if (o.frozen || o.glass === undefined) return prev;
  const g = o.glass;
  if (g?.fellBack) {
    if (!g.firstChoiceId || !g.onGlassId || g.firstChoiceId === g.onGlassId) return prev;
    // Not proven showing yet (still loading, or the backup is on its own card): nothing new to say.
    if (!o.backupShowing) return prev;
    const open = prev && prev.state !== 'recovered' && prev.fromId === g.firstChoiceId ? prev : null;
    if (open) return open.state === 'backup' && open.toId === g.onGlassId ? open : { ...open, toId: g.onGlassId, state: 'backup' };
    return { fromId: g.firstChoiceId, toId: g.onGlassId, startedAtMs: o.nowMs, state: 'backup' };
  }
  if (!prev) return null;
  if (prev.state === 'recovered') {
    const age = o.nowMs - (prev.endedAtMs ?? o.nowMs);
    return age >= 0 && age < FALLBACK_RECOVERED_REPORT_MS ? prev : null;
  }
  // Nothing ranked on the glass any more: there is no schedule choice to be "back" on.
  if (!g || !g.firstChoiceId || !g.onGlassId) return null;
  if (o.firstChoiceProven) return { ...prev, toId: g.onGlassId, state: 'recovered', endedAtMs: o.nowMs };
  return prev.state === 'retrying' ? prev : { ...prev, state: 'retrying' };
}

// ── What the routine report says while an episode lasts ─────────────────────

/** The `playlistFallback` block of the telemetry report. Ids only — the server looks the names up. */
export interface PlaylistFallbackReport {
  /** The playlist the schedule wanted on this screen, which it could not play. */
  fromPlaylistId: string;
  /** backup / retrying: the backup playlist; recovered: the playlist proven playing. */
  toPlaylistId: string;
  /** How long the episode has lasted (to the recovery, once recovered), in ms. */
  forMs: number;
  state: FallbackEpisodeState;
}

const REPORT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const STATES: ReadonlySet<string> = new Set(['backup', 'retrying', 'recovered']);

/** The report block, or null when there is nothing honest to send (no episode, or an id the server would refuse). */
export function fallbackReport(ep: FallbackEpisode | null, nowMs: number): PlaylistFallbackReport | null {
  if (!ep || !REPORT_ID.test(ep.fromId) || !REPORT_ID.test(ep.toId) || !STATES.has(ep.state)) return null;
  if (ep.state !== 'recovered' && ep.fromId === ep.toId) return null;
  const end = ep.state === 'recovered' ? (ep.endedAtMs ?? nowMs) : nowMs;
  const forMs = Math.min(FALLBACK_REPORT_MAX_FOR_MS, Math.max(0, Math.floor(end - ep.startedAtMs)));
  return { fromPlaylistId: ep.fromId, toPlaylistId: ep.toId, forMs, state: ep.state };
}

// ── The episode survives a reload (localStorage; the page owns the I/O) ─────

export const FALLBACK_EPISODE_STORE_KEY = 'edu_playlist_fallback_episode_v1';

/** Clock skew a restored record may carry before it is not believed. */
const RESTORE_SKEW_MS = 5 * MIN;

/**
 * The stored episode, validated. A reload empties the set-aside ledger, so the
 * schedule's choice goes straight back on the glass: a restored `backup` comes
 * back as `retrying`. Anything malformed, too old or from the future is null.
 */
export function readStoredFallbackEpisode(raw: string | null | undefined, nowMs: number): FallbackEpisode | null {
  if (!raw) return null;
  let v: unknown;
  try { v = JSON.parse(raw); } catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  const fromId = typeof r.fromId === 'string' ? r.fromId : '';
  const toId = typeof r.toId === 'string' ? r.toId : '';
  const state = typeof r.state === 'string' ? r.state : '';
  const startedAtMs = typeof r.startedAtMs === 'number' && Number.isFinite(r.startedAtMs) ? r.startedAtMs : NaN;
  if (!REPORT_ID.test(fromId) || !REPORT_ID.test(toId) || !STATES.has(state) || !Number.isFinite(startedAtMs)) return null;
  const age = nowMs - startedAtMs;
  if (age < -RESTORE_SKEW_MS || age > FALLBACK_REPORT_MAX_FOR_MS) return null;
  if (state === 'recovered') {
    const endedAtMs = typeof r.endedAtMs === 'number' && Number.isFinite(r.endedAtMs) ? r.endedAtMs : NaN;
    const since = nowMs - endedAtMs;
    if (!Number.isFinite(endedAtMs) || since < -RESTORE_SKEW_MS || since >= FALLBACK_RECOVERED_REPORT_MS) return null;
    return { fromId, toId, startedAtMs, state, endedAtMs };
  }
  if (fromId === toId) return null;
  return { fromId, toId, startedAtMs, state: 'retrying' };
}

/** What to store (null = remove the key). */
export function storedFallbackEpisode(ep: FallbackEpisode | null): string | null {
  return ep ? JSON.stringify(ep) : null;
}
