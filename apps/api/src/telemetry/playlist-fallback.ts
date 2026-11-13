/**
 * A screen is showing a BACKUP playlist (2026-11-13) — the server's half.
 *
 * The web player, as a last resort, shows the next scheduled playlist when
 * the one the schedule put on a screen has nothing that screen can play
 * (apps/web/src/app/player/playlistFallback.ts, player rule 20). The owner's
 * ruling on it: "that should be the last option right and then it should
 * notify the admin, no one wants the incorrect content to ever be playing on
 * their screen."
 *
 * So the player says so on every routine report while it lasts
 * (`playlistFallback: { fromPlaylistId, toPlaylistId, forMs }` — ids and a
 * duration, never a name), and this module decides what the server does:
 *
 *   state was empty, or the pair changed → ENTER: both playlists are looked
 *     up INSIDE THE SCREEN'S OWN TENANT (the device is hostile input — an id
 *     that is not this tenant's playlist is not a fallback we can describe,
 *     and reads as "nothing reported"), an immutable audit row is written,
 *     the state is stored on the screen for the dashboard, and the tenant's
 *     bell gets one notification;
 *   the same pair again → NOTHING: no query, no write (the steady state of a
 *     report that arrives every minute);
 *   the key stops arriving → EXIT: an audit row, the state is cleared.
 *
 * Pure: no Prisma, no clock of its own. The controller owns the effects.
 */

export const PLAYER_PLAYLIST_FALLBACK = 'PLAYER_PLAYLIST_FALLBACK';
export const PLAYER_PLAYLIST_FALLBACK_ENDED = 'PLAYER_PLAYLIST_FALLBACK_ENDED';

/** `Screen.playlistFallback` — what the dashboard reads. Written only by the server. */
export interface StoredPlaylistFallback {
  /** The playlist the schedule wanted on this screen. */
  fromPlaylistId: string;
  fromPlaylistName: string;
  /** The playlist it is showing instead. */
  toPlaylistId: string;
  toPlaylistName: string;
  /** When it began: the server clock minus the duration the screen reported (bounded). */
  since: string;
}

export interface ReportedPlaylistFallback {
  fromPlaylistId: string;
  toPlaylistId: string;
  forMs: number;
}

/** The same bound the player applies; a longer claim says nothing more. */
export const FALLBACK_MAX_FOR_MS = 7 * 24 * 60 * 60_000;

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
  };
}

export type FallbackPlan =
  | { kind: 'none' }
  /** A fallback to verify and record. `previous` is the pair it replaces, if any. */
  | { kind: 'enter'; reported: ReportedPlaylistFallback; previous: StoredPlaylistFallback | null }
  | { kind: 'exit'; previous: StoredPlaylistFallback };

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
  if (!reported || reported.fromPlaylistId === reported.toPlaylistId) {
    return stored ? { kind: 'exit', previous: stored } : { kind: 'none' };
  }
  if (stored && stored.fromPlaylistId === reported.fromPlaylistId && stored.toPlaylistId === reported.toPlaylistId) {
    return { kind: 'none' };
  }
  return { kind: 'enter', reported, previous: stored };
}

/**
 * The state to store, from the playlists the server found IN THE SCREEN'S
 * TENANT. Null when either id is not one of them: the report is then treated
 * exactly like no report.
 */
export function verifiedPlaylistFallback(
  reported: ReportedPlaylistFallback,
  tenantPlaylists: ReadonlyArray<{ id: string; name: string | null }>,
  now: Date,
): StoredPlaylistFallback | null {
  const from = tenantPlaylists.find((p) => p.id === reported.fromPlaylistId);
  const to = tenantPlaylists.find((p) => p.id === reported.toPlaylistId);
  if (!from || !to) return null;
  const forMs = Number.isFinite(reported.forMs) ? Math.min(Math.max(0, Math.floor(reported.forMs)), FALLBACK_MAX_FOR_MS) : 0;
  return {
    fromPlaylistId: from.id,
    fromPlaylistName: cleanName(from.name),
    toPlaylistId: to.id,
    toPlaylistName: cleanName(to.name),
    since: new Date(now.getTime() - forMs).toISOString(),
  };
}

function cleanName(name: string | null | undefined): string {
  return String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Untitled playlist';
}

/**
 * The bell row. It says only what the evidence proves: the screen REPORTED it
 * could play nothing in one playlist and is showing another. English, like
 * every stored notification; the web recognises these two sentences and
 * renders them in the reader's language (`notificationCopy.ts` — reword both
 * together, its test reads this file).
 */
export const FALLBACK_NOTIFICATION_TITLE = 'A screen is showing its backup playlist';

export function fallbackNotificationBody(screenName: string | null | undefined, s: StoredPlaylistFallback): string {
  const screen = String(screenName ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'A screen';
  return `${screen} could not play anything in “${s.fromPlaylistName}”, so it is showing “${s.toPlaylistName}”. Check the files in “${s.fromPlaylistName}”.`;
}

/**
 * At most ONE notification per screen + set-aside playlist per UTC day. The
 * player retries the first playlist after 15, 30, 60 and 120 minutes and a
 * reload starts it over, so one broken playlist re-enters the fallback many
 * times a day; the (tenantId, dedupeKey) unique constraint absorbs every
 * repeat. The audit rows are NOT deduped — each change is recorded.
 */
export function fallbackDedupeKey(screenId: string, fromPlaylistId: string, now: Date): string {
  return `playlist-fallback:${screenId}:${fromPlaylistId}:${now.toISOString().slice(0, 10)}`;
}

// ── a looping device cannot write an audit row per report ─────────────────

/**
 * Minimum spacing between RECORDED changes (enter or exit) for one screen. An
 * honest player needs two minutes on its card before it can enter again, so
 * it is never held back by more than one report; a device that alternates the
 * key on every report is held to one audit row per this interval. A change
 * that is held back is simply seen again on the next report — nothing is lost.
 * In-process, like every other per-screen limiter here (one replica today).
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

/** Test seam. */
export function __resetFallbackChangeLimiter(): void {
  lastChangeAt.clear();
}
