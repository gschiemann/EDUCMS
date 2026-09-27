/**
 * Public roster visibility — what a PUBLIC board shows about the players on a
 * game's roster (K-12 launch audit F38, 2026-09-27).
 *
 * `GET /sports/board/:id` is public by design (an unauthenticated fan, an OBS
 * browser source and an HDMI-driven board all read it) and it has always
 * carried the full roster — every player's name, jersey number, position,
 * headshot URL and stat line — for the lineup, player-card and intro surfaces.
 * For a school those are students. Whether a student's name or photo may
 * appear publicly is a decision the school makes under its own FERPA
 * directory-information policy and family opt-outs; the product must let it
 * make that decision and must enforce it where the data leaves the server,
 * not in the renderer (a board payload is readable by anyone with the URL).
 *
 * The policy is stored per game as a latest-wins `ROSTER_PRIVACY` GameEvent —
 * the same no-table, no-migration pattern the ribbon settings use — and
 * `getBoardFresh` applies it to the roster AND to any cue payload that carries
 * a lineup (the pre-game intro), inside the cached build, so the ETag and the
 * cache see the redacted payload. The operator-side roster endpoints are
 * untouched: staff still see everything.
 *
 * Defaults preserve today's behaviour (everything shown). Changing a default
 * for existing games is Greg's decision, not a silent side effect of this
 * change (CLAUDE.md, player rule 12's principle).
 */

export const ROSTER_PRIVACY_EVENT = 'ROSTER_PRIVACY';

export type RosterNameMode = 'full' | 'last' | 'hidden';

export interface RosterPrivacy {
  /** full = as entered · last = last name only · hidden = no name at all */
  names: RosterNameMode;
  numbers: boolean;
  photos: boolean;
  positions: boolean;
  stats: boolean;
}

export const DEFAULT_ROSTER_PRIVACY: Readonly<RosterPrivacy> = Object.freeze({
  names: 'full',
  numbers: true,
  photos: true,
  positions: true,
  stats: true,
});

const NAME_MODES: ReadonlySet<string> = new Set(['full', 'last', 'hidden']);

/** Sanitize any stored / submitted value into a complete policy. */
export function parseRosterPrivacy(raw: unknown): RosterPrivacy {
  const o =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  return {
    names:
      typeof o.names === 'string' && NAME_MODES.has(o.names)
        ? (o.names as RosterNameMode)
        : DEFAULT_ROSTER_PRIVACY.names,
    numbers: bool(o.numbers, DEFAULT_ROSTER_PRIVACY.numbers),
    photos: bool(o.photos, DEFAULT_ROSTER_PRIVACY.photos),
    positions: bool(o.positions, DEFAULT_ROSTER_PRIVACY.positions),
    stats: bool(o.stats, DEFAULT_ROSTER_PRIVACY.stats),
  };
}

export function isDefaultRosterPrivacy(p: RosterPrivacy): boolean {
  return p.names === 'full' && p.numbers && p.photos && p.positions && p.stats;
}

/** "Jordan Lee" → "Lee"; a single token stays as it is. */
function lastNameOnly(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

interface RosterLike {
  name?: string | null;
  number?: string | null;
  position?: string | null;
  photoUrl?: string | null;
  stats?: unknown;
}

/** One roster entry as a public board may show it. Never mutates the input. */
export function redactRosterEntry<T extends RosterLike>(
  p: T,
  policy: RosterPrivacy,
): T {
  if (isDefaultRosterPrivacy(policy)) return p;
  const out: T = { ...p };
  if (policy.names !== 'full' && typeof p.name === 'string') {
    out.name = policy.names === 'last' ? lastNameOnly(p.name) : '';
  }
  if (!policy.numbers && 'number' in p) out.number = null;
  if (!policy.positions && 'position' in p) out.position = null;
  if (!policy.photos && 'photoUrl' in p) out.photoUrl = null;
  if (!policy.stats && 'stats' in p) (out as RosterLike).stats = {};
  return out;
}

export function redactPublicRoster<T extends RosterLike>(
  roster: readonly T[] | null | undefined,
  policy: RosterPrivacy,
): T[] {
  if (!Array.isArray(roster)) return [];
  if (isDefaultRosterPrivacy(policy)) return roster as T[];
  return roster.map((p) => redactRosterEntry(p, policy));
}

/**
 * A cue payload as a public board may show it. The pre-game intro cue
 * (`key: 'pregame-intro'`) carries a `lineup` array built from the roster at
 * fire time — the same student data, so the same policy applies. Photos in a
 * lineup are empty strings rather than null (that is the shape the intro
 * widget reads).
 */
export function redactCuePayload(
  payload: Record<string, unknown>,
  policy: RosterPrivacy,
): Record<string, unknown> {
  if (isDefaultRosterPrivacy(policy) || !Array.isArray(payload.lineup))
    return payload;
  return {
    ...payload,
    lineup: (payload.lineup as RosterLike[]).map((p) => {
      const r = redactRosterEntry(p, policy);
      return {
        ...r,
        number: r.number ?? '',
        position: r.position ?? '',
        photoUrl: r.photoUrl ?? '',
      };
    }),
  };
}
