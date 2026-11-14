/**
 * A screen on a BACKUP playlist (2026-11-13/14) — the server's half.
 *
 * The web player, as its LAST resort, shows the next scheduled playlist when
 * the one the schedule put on a screen has nothing that screen can play
 * (apps/web/src/app/player/playlistFallback.ts, player rule 20). The owner's
 * ruling on it: "that should be the last option right and then it should
 * notify the admin, no one wants the incorrect content to ever be playing on
 * their screen."
 *
 * The player reports the EPISODE on every routine report while it lasts
 * (`playlistFallback: { fromPlaylistId, toPlaylistId, forMs, state }` — ids,
 * a duration and a state, never a name):
 *
 *   backup    — the backup is on the glass, proven showing content;
 *   retrying  — the scheduled playlist is back on the glass being tried;
 *   recovered — it has played again for five minutes (said for ten, then the
 *               key stops).
 *
 * What the server does with it (`planPlaylistFallback`, then
 * `executePlaylistFallbackPlan`):
 *
 *   nothing stored + backup/retrying → ENTER: both playlists are looked up
 *     INSIDE THE SCREEN'S OWN TENANT (the device is hostile input — an id that
 *     is not this tenant's playlist is not a fallback we can describe, and
 *     reads as "nothing reported"), the immutable audit row is written, the
 *     state is stored on the screen for the dashboard, and — once the backup
 *     is on the glass — the organisation's bell says so;
 *   the same episode again → NOTHING (no query, no write): the steady state;
 *   backup ↔ retrying → the column only (it rides the report's one write);
 *   recovered → END: an audit row, the column cleared, and the bell says the
 *     screen is back on its scheduled playlist — only for an episode whose
 *     start it announced;
 *   the key stops arriving without a recovery → END: an audit row, the
 *     column cleared, no claim of recovery.
 *
 * Every state change is recorded BEFORE it is made: if the audit row cannot
 * be written the column is left as it was, and the next report (a minute
 * later) meets the same change and tries again.
 *
 * Bell notifications go through `NotificationsService.notify` (in-app only:
 * nothing here sends an email; the customer alert emails, in shadow mode,
 * have no such kind). At most `FALLBACK_NOTICES_PER_SCREEN_PER_DAY` episode
 * starts per screen per UTC day reach the bell — a device that flips its
 * report cannot fill an organisation's inbox; the audit rows and the Screens
 * page still record every one.
 */

export const PLAYER_PLAYLIST_FALLBACK = 'PLAYER_PLAYLIST_FALLBACK';
export const PLAYER_PLAYLIST_FALLBACK_ENDED = 'PLAYER_PLAYLIST_FALLBACK_ENDED';

export type ReportedFallbackState = 'backup' | 'retrying' | 'recovered';
export type StoredFallbackState = 'backup' | 'retrying';

/** `Screen.playlistFallback` — what the dashboard reads. Written only by the server. */
export interface StoredPlaylistFallback {
  /** The playlist the schedule wanted on this screen. */
  fromPlaylistId: string;
  fromPlaylistName: string;
  /** The backup playlist (the last one on the glass, while retrying). */
  toPlaylistId: string;
  toPlaylistName: string;
  /** When the episode began: the server clock minus the duration the screen reported (bounded, to the minute). */
  since: string;
  /** backup = the backup is on the glass; retrying = the scheduled playlist is back on the glass being tried. */
  state: StoredFallbackState;
  /** The bell announced this episode's start (so it announces the end too). */
  notified: boolean;
}

export interface ReportedPlaylistFallback {
  fromPlaylistId: string;
  /** backup / retrying: the backup playlist; recovered: the playlist proven playing. */
  toPlaylistId: string;
  forMs: number;
  state: ReportedFallbackState;
}

/** The same bound the player applies; a longer claim says nothing more. */
export const FALLBACK_MAX_FOR_MS = 7 * 24 * 60 * 60_000;

const STORED_STATES: ReadonlySet<string> = new Set(['backup', 'retrying']);

/** Read the stored column defensively (it is JSON). Anything malformed is "no state". */
export function storedPlaylistFallback(raw: unknown): StoredPlaylistFallback | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null);
  const fromPlaylistId = str(r.fromPlaylistId);
  const toPlaylistId = str(r.toPlaylistId);
  if (!fromPlaylistId || !toPlaylistId) return null;
  return {
    fromPlaylistId,
    fromPlaylistName: str(r.fromPlaylistName) ?? '',
    toPlaylistId,
    toPlaylistName: str(r.toPlaylistName) ?? '',
    since: str(r.since) ?? '',
    state: typeof r.state === 'string' && STORED_STATES.has(r.state) ? (r.state as StoredFallbackState) : 'backup',
    notified: r.notified === true,
  };
}

export type FallbackEndReason = 'recovered' | 'no-longer-reported' | 'not-verifiable' | 'superseded';

export type FallbackPlan =
  | { kind: 'none' }
  /** A new episode — or another playlist's, replacing `previous`. Verified, recorded, stored. */
  | { kind: 'enter'; reported: ReportedPlaylistFallback; previous: StoredPlaylistFallback | null }
  /** The same episode with another backup on the glass. Verified, recorded, stored. */
  | { kind: 'change'; reported: ReportedPlaylistFallback; previous: StoredPlaylistFallback }
  /** The same episode, backup ↔ retrying: the column only. */
  | { kind: 'phase'; previous: StoredPlaylistFallback; state: StoredFallbackState }
  /** The episode is over. `reported` carries the playlist proven playing (recovered only). */
  | { kind: 'end'; previous: StoredPlaylistFallback; reason: FallbackEndReason; reported: ReportedPlaylistFallback | null };

/**
 * What a report means against the stored state. A screen with no tenant is
 * never planned for (nothing to scope a lookup or a notification to).
 */
export function planPlaylistFallback(
  stored: StoredPlaylistFallback | null,
  reported: ReportedPlaylistFallback | null | undefined,
  paired: boolean,
): FallbackPlan {
  if (!paired) return { kind: 'none' };
  const gone = (reason: FallbackEndReason): FallbackPlan =>
    stored ? { kind: 'end', previous: stored, reason, reported: null } : { kind: 'none' };
  if (!reported) return gone('no-longer-reported');
  if (reported.state === 'recovered') {
    // Already over: the repeats that make a recovery survive a lost post are no-ops.
    if (!stored) return { kind: 'none' };
    if (stored.fromPlaylistId !== reported.fromPlaylistId) return gone('superseded');
    return { kind: 'end', previous: stored, reason: 'recovered', reported };
  }
  // "Fell back to itself" is not a fallback.
  if (reported.fromPlaylistId === reported.toPlaylistId) return gone('no-longer-reported');
  if (!stored || stored.fromPlaylistId !== reported.fromPlaylistId) return { kind: 'enter', reported, previous: stored };
  if (stored.toPlaylistId !== reported.toPlaylistId) return { kind: 'change', reported, previous: stored };
  if (stored.state !== reported.state) return { kind: 'phase', previous: stored, state: reported.state };
  return { kind: 'none' };
}

/** The episode start: the server clock minus the claimed duration, bounded, to the minute. */
export function fallbackSince(forMs: number, now: Date): string {
  const ms = Number.isFinite(forMs) ? Math.min(Math.max(0, Math.floor(forMs)), FALLBACK_MAX_FOR_MS) : 0;
  return new Date(Math.floor((now.getTime() - ms) / 60_000) * 60_000).toISOString();
}

/**
 * The names, from the playlists the server found IN THE SCREEN'S TENANT.
 * Null when either id is not one of them: the report is then treated exactly
 * like no report.
 */
export function verifiedPlaylistNames(
  reported: Pick<ReportedPlaylistFallback, 'fromPlaylistId' | 'toPlaylistId'>,
  tenantPlaylists: ReadonlyArray<{ id: string; name: string | null }>,
): { fromPlaylistName: string; toPlaylistName: string } | null {
  const from = tenantPlaylists.find((p) => p.id === reported.fromPlaylistId);
  const to = tenantPlaylists.find((p) => p.id === reported.toPlaylistId);
  if (!from || !to) return null;
  return { fromPlaylistName: cleanName(from.name), toPlaylistName: cleanName(to.name) };
}

function cleanName(name: string | null | undefined): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled playlist';
}

function screenLabel(screenName: string | null | undefined): string {
  return String(screenName ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'A screen';
}

// ── The bell's sentences ──────────────────────────────────────────────────
// They say only what the evidence proves: the screen REPORTED it could play
// nothing in one playlist and is showing another; later, that the scheduled
// playlist has played again. English, like every stored notification; the
// web recognises these sentences and renders them in the reader's language
// (`notificationCopy.ts` — reword both sides together, its test reads this file).

export const FALLBACK_NOTIFICATION_TITLE = 'A screen is showing its backup playlist';

export function fallbackNotificationBody(
  screenName: string | null | undefined,
  s: Pick<StoredPlaylistFallback, 'fromPlaylistName' | 'toPlaylistName'>,
): string {
  const screen = screenLabel(screenName);
  return `${screen} could not play anything in “${s.fromPlaylistName}”, so it is showing “${s.toPlaylistName}”. Check the files in “${s.fromPlaylistName}”.`;
}

export const FALLBACK_RECOVERED_NOTIFICATION_TITLE = 'A screen is back on its scheduled playlist';

export function fallbackRecoveredNotificationBody(screenName: string | null | undefined, playlistName: string): string {
  const screen = screenLabel(screenName);
  return `${screen} is back on its scheduled playlist “${playlistName}”.`;
}

/** One bell row per episode start, and one per episode end — keyed by the episode. */
export function fallbackDedupeKey(screenId: string, since: string): string {
  return `playlist-fallback:${screenId}:${since}`;
}

export function fallbackRecoveredDedupeKey(screenId: string, since: string): string {
  return `playlist-fallback-recovered:${screenId}:${since}`;
}

// ── A looping or hostile device is held down ──────────────────────────────

/**
 * Minimum spacing between RECORDED changes (enter, change, end) for one
 * screen. An honest player needs two minutes on its card before it can enter
 * again and five minutes of play before it recovers, so it is never held back
 * by more than one report; a device that alternates the key on every report
 * is held to one audit row per this interval. A change that is held back is
 * simply seen again on the next report — nothing is lost. In-process, like
 * every other per-screen limiter here (one replica today).
 */
export const FALLBACK_CHANGE_MIN_INTERVAL_MS = 90_000;
const lastChangeAt = new Map<string, number>();

export function acceptFallbackChange(screenId: string, nowMs: number): boolean {
  const prev = lastChangeAt.get(screenId);
  if (prev !== undefined && nowMs - prev < FALLBACK_CHANGE_MIN_INTERVAL_MS) return false;
  lastChangeAt.delete(screenId); // re-insert: Map order is the eviction order
  lastChangeAt.set(screenId, nowMs);
  if (lastChangeAt.size > 50_000) {
    const oldest = lastChangeAt.keys().next().value;
    if (oldest) lastChangeAt.delete(oldest);
  }
  return true;
}

/**
 * At most this many episode STARTS per screen per UTC day reach the bell (an
 * episode's end is announced only when its start was). Every episode is still
 * recorded and shown on the Screens page.
 */
export const FALLBACK_NOTICES_PER_SCREEN_PER_DAY = 6;
const noticesToday = new Map<string, { day: string; count: number }>();

export function claimFallbackNotice(screenId: string, now: Date): boolean {
  const day = now.toISOString().slice(0, 10);
  const prev = noticesToday.get(screenId);
  const count = prev && prev.day === day ? prev.count : 0;
  if (count >= FALLBACK_NOTICES_PER_SCREEN_PER_DAY) return false;
  noticesToday.delete(screenId);
  noticesToday.set(screenId, { day, count: count + 1 });
  if (noticesToday.size > 50_000) {
    const oldest = noticesToday.keys().next().value;
    if (oldest) noticesToday.delete(oldest);
  }
  return true;
}

/** Test seam. */
export function __resetFallbackChangeLimiter(): void {
  lastChangeAt.clear();
  noticesToday.clear();
}

// ── The effects, with the database handed in ──────────────────────────────

/** The two tables this touches — the controller hands in `prisma.client`. */
export interface FallbackDb {
  playlist: {
    findMany(args: {
      where: { tenantId: string; id: { in: string[] } };
      select: { id: true; name: true };
      take: number;
    }): Promise<Array<{ id: string; name: string | null }>>;
  };
  auditLog: {
    create(args: {
      data: { tenantId: string; userId: null; action: string; targetType: string; targetId: string; details: string };
      select: { id: true };
    }): Promise<unknown>;
  };
}

export interface FallbackNotice {
  title: string;
  body: string;
  dedupeKey: string;
}

export interface FallbackOutcome {
  /** The column to write: a state, null (clear it), or undefined (leave it alone). */
  column: StoredPlaylistFallback | null | undefined;
  /** Bell rows to raise AFTER the column is written. */
  notices: FallbackNotice[];
}

const LEAVE: FallbackOutcome = { column: undefined, notices: [] };

/**
 * Carry out a plan. Never throws: a lookup or audit failure leaves the column
 * alone (the next report tries again), and nothing here can cost the report
 * its liveness.
 */
export async function executePlaylistFallbackPlan(
  db: FallbackDb,
  plan: FallbackPlan,
  ctx: { tenantId: string; screenId: string; screenName: string | null; now: Date },
): Promise<FallbackOutcome> {
  if (plan.kind === 'none') return LEAVE;
  const { tenantId, screenId, screenName, now } = ctx;

  const audit = async (action: string, details: Record<string, unknown>): Promise<boolean> => {
    try {
      await db.auditLog.create({
        data: { tenantId, userId: null, action, targetType: 'Screen', targetId: screenId, details: JSON.stringify({ screenName, ...details }) },
        select: { id: true },
      });
      return true;
    } catch {
      return false;
    }
  };
  const lookup = async (ids: string[]): Promise<Array<{ id: string; name: string | null }> | null> => {
    try {
      // Tenant-scoped: an id from another organisation simply is not found.
      return await db.playlist.findMany({ where: { tenantId, id: { in: [...new Set(ids)] } }, select: { id: true, name: true }, take: 2 });
    } catch {
      return null;
    }
  };
  const startNotice = (s: StoredPlaylistFallback): FallbackNotice => ({
    title: FALLBACK_NOTIFICATION_TITLE,
    body: fallbackNotificationBody(screenName, s),
    dedupeKey: fallbackDedupeKey(screenId, s.since),
  });

  // backup ↔ retrying: no lookup, no audit row — the column rides the report's write.
  if (plan.kind === 'phase') {
    const next: StoredPlaylistFallback = { ...plan.previous, state: plan.state };
    // An episode first recorded while retrying is announced when its backup goes up.
    if (next.state === 'backup' && !next.notified && claimFallbackNotice(screenId, now)) {
      next.notified = true;
      return { column: next, notices: [startNotice(next)] };
    }
    return { column: next, notices: [] };
  }

  if (!acceptFallbackChange(screenId, now.getTime())) return LEAVE;

  if (plan.kind === 'end') {
    const prev = plan.previous;
    let reason = plan.reason;
    let playingName: string | null = null;
    if (reason === 'recovered' && plan.reported) {
      const playingId = plan.reported.toPlaylistId;
      if (playingId === prev.fromPlaylistId) {
        playingName = prev.fromPlaylistName || null;
      } else {
        const found = await lookup([playingId]);
        if (found === null) return LEAVE; // could not look: decide on the next report
        const hit = found.find((p) => p.id === playingId);
        playingName = hit ? cleanName(hit.name) : null;
      }
      // The device named a playlist that is not this organisation's: over, but not a recovery we can describe.
      if (!playingName) reason = 'not-verifiable';
    }
    const recorded = await audit(PLAYER_PLAYLIST_FALLBACK_ENDED, {
      ...prev,
      reason,
      ...(plan.reported ? { playingPlaylistId: plan.reported.toPlaylistId, playingPlaylistName: playingName, forMs: plan.reported.forMs } : {}),
    });
    if (!recorded) return LEAVE;
    const notices: FallbackNotice[] = reason === 'recovered' && prev.notified && playingName
      ? [{
          title: FALLBACK_RECOVERED_NOTIFICATION_TITLE,
          body: fallbackRecoveredNotificationBody(screenName, playingName),
          dedupeKey: fallbackRecoveredDedupeKey(screenId, prev.since),
        }]
      : [];
    return { column: null, notices };
  }

  // enter / change: verify both playlists inside this tenant, then record.
  const found = await lookup([plan.reported.fromPlaylistId, plan.reported.toPlaylistId]);
  if (found === null) return LEAVE; // could not verify: change nothing, look again next report
  const names = verifiedPlaylistNames(plan.reported, found);
  const previous = plan.previous;
  if (!names) {
    // Not this tenant's playlists: reads as "nothing reported".
    if (!previous) return LEAVE;
    const recorded = await audit(PLAYER_PLAYLIST_FALLBACK_ENDED, { ...previous, reason: 'not-verifiable' });
    return recorded ? { column: null, notices: [] } : LEAVE;
  }
  const sameEpisode = plan.kind === 'change';
  const recordedState = {
    fromPlaylistId: plan.reported.fromPlaylistId,
    fromPlaylistName: names.fromPlaylistName,
    toPlaylistId: plan.reported.toPlaylistId,
    toPlaylistName: names.toPlaylistName,
    since: sameEpisode && previous ? previous.since : fallbackSince(plan.reported.forMs, now),
    state: (plan.reported.state === 'retrying' ? 'retrying' : 'backup') as StoredFallbackState,
  };
  if (!(await audit(PLAYER_PLAYLIST_FALLBACK, { ...recordedState, previous: previous ?? null }))) return LEAVE;
  // Announced once, when a backup is on the glass (an episode first seen while
  // retrying is announced by the change that puts a backup up).
  const alreadyAnnounced = sameEpisode && !!previous?.notified;
  const announce = !alreadyAnnounced && recordedState.state === 'backup' && claimFallbackNotice(screenId, now);
  const next: StoredPlaylistFallback = { ...recordedState, notified: alreadyAnnounced || announce };
  return { column: next, notices: announce ? [startNotice(next)] : [] };
}
