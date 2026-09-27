/**
 * Sports-venue pack — the DATA half (pure; no React, no DOM).
 *
 * K-12 launch audit (2026-09-27) F28 / F38. The venue pack
 * (`SportsVenueWidgets.tsx`) used to render hardcoded pro-league samples
 * (an NBA matchup, a beer sponsor, an airline takeover, a Kiss Cam, a noise
 * meter frozen at "87 dB · LIVE") and read none of the game state the rest of
 * the sports catalogue reads — so a scoreboard that LOOKED live showed the
 * same invented score forever. Everything that decides WHAT a venue widget
 * shows lives here so it can be tested without mounting a board:
 *
 *   • school-safe demo content — the builder's SAMPLE, never a real screen's
 *     content (see `SportsVenueWidgets.tsx` for the surface rules);
 *   • the legacy seeded copy that must never reach a school's screen again;
 *   • the game → team view mapping (live score / clock / fouls / timeouts);
 *   • roster → lineup / player-card selection;
 *   • head-to-head game-stat pairs for the stat comparison;
 *   • the "as of" stamp manual score boards carry.
 */

/* ════════════════ shapes ════════════════ */

export interface VenueTeamCfg {
  code?: string;
  name?: string;
  color?: string;
  color2?: string;
  logoUrl?: string;
  record?: string;
  /** Manual mode only — a live board reads these from the game. */
  score?: number | string;
  timeouts?: number;
  fouls?: number;
  shots?: number | string;
}

/** What a team panel actually paints. Strings throughout: a neutral board
 *  shows dashes, a judged sport shows decimals. */
export interface VenueTeamView {
  code: string;
  name: string;
  color: string;
  color2: string;
  logoUrl: string;
  record: string;
  score: string;
  timeouts: number | null;
  fouls: number | null;
  shots: string;
}

export interface BoardRosterEntry {
  id?: string;
  team?: string;
  name?: string;
  number?: string | null;
  position?: string | null;
  photoUrl?: string | null;
  stats?: Record<string, unknown> | null;
}

export interface LineupPlayer {
  number: string;
  first: string;
  last: string;
  position: string;
  photoUrl?: string;
  /** Optional detail line (manual rows) — e.g. "SR · 6'2\"". */
  detail?: string;
}

export interface StatPairRow {
  label: string;
  home: number | string;
  away: number | string;
}

/* ════════════════ school-safe demo content (builder SAMPLE only) ════════════════ */

export const DEMO_HOME: Required<Omit<VenueTeamCfg, 'logoUrl'>> & { logoUrl: string } = {
  code: 'EAG', name: 'Eagles', color: '#1e3a8a', color2: '#0b1b44', logoUrl: '',
  record: '12-4', score: 48, timeouts: 3, fouls: 4, shots: 21,
};
export const DEMO_AWAY: Required<Omit<VenueTeamCfg, 'logoUrl'>> & { logoUrl: string } = {
  code: 'TIG', name: 'Tigers', color: '#b91c1c', color2: '#4c0808', logoUrl: '',
  record: '9-7', score: 44, timeouts: 2, fouls: 6, shots: 18,
};
export const DEMO_CLOCK = '4:21';
export const DEMO_PERIOD = 'Q3';

export const DEMO_TICKER_SEGMENTS = [
  { text: 'WELCOME TO EAGLES GYM', tint: '' },
  { text: 'GO EAGLES!', tint: 'accent' },
  { text: 'NEXT HOME GAME · FRIDAY 7:00 PM', tint: '' },
  { text: 'THANK YOU TO OUR BOOSTER CLUB', tint: 'accent' },
  { text: 'CONCESSIONS OPEN AT HALFTIME', tint: '' },
];

export const DEMO_LINEUP: LineupPlayer[] = [
  { number: '3', first: 'JORDAN', last: 'LEE', position: 'G', detail: 'SR' },
  { number: '11', first: 'MAYA', last: 'PATEL', position: 'G', detail: 'JR' },
  { number: '22', first: 'SAM', last: 'RIVERA', position: 'F', detail: 'SR' },
  { number: '24', first: 'AVERY', last: 'CHEN', position: 'F', detail: 'SO' },
  { number: '33', first: 'TAYLOR', last: 'BROOKS', position: 'C', detail: 'SR' },
];

export const DEMO_STATLINE = [
  { label: 'PTS', value: '18' },
  { label: 'REB', value: '6' },
  { label: 'AST', value: '4' },
  { label: 'STL', value: '2' },
];

export const DEMO_COMPARE: StatPairRow[] = [
  { label: 'PTS', home: 58.2, away: 54.9 },
  { label: 'REB', home: 31.4, away: 29.8 },
  { label: 'AST', home: 12.1, away: 10.6 },
  { label: 'STL', home: 7.3, away: 8.0 },
];

export interface OotGame { status: string; away: { code: string; score: number | string; color: string }; home: { code: string; score: number | string; color: string }; note: string }
export const DEMO_OOT: OotGame[] = [
  { status: 'FINAL', away: { code: 'CEN', score: 51, color: '#0f766e' }, home: { code: 'NOR', score: 47, color: '#1d4ed8' }, note: 'final' },
  { status: 'FINAL', away: { code: 'EAS', score: 38, color: '#7c3aed' }, home: { code: 'WES', score: 44, color: '#b45309' }, note: 'final' },
  { status: 'HALF', away: { code: 'RIV', score: 22, color: '#be123c' }, home: { code: 'LAK', score: 25, color: '#0369a1' }, note: 'halftime' },
  { status: '7:00', away: { code: 'SOU', score: '', color: '#4d7c0f' }, home: { code: 'VAL', score: '', color: '#6d28d9' }, note: 'tonight' },
];

export interface HomeGameRow { date: string; opp: { code: string; name: string; color: string }; note: string; time: string; tix: string }
export const DEMO_HOME_GAMES: HomeGameRow[] = [
  { date: 'TUE, OCT 14', opp: { code: 'CEN', name: 'Central', color: '#0f766e' }, note: 'Pink Out Night', time: '7:00 PM', tix: 'students free with ID' },
  { date: 'FRI, OCT 17', opp: { code: 'NOR', name: 'Northgate', color: '#1d4ed8' }, note: 'Homecoming', time: '7:00 PM', tix: 'tickets at the door' },
  { date: 'TUE, OCT 21', opp: { code: 'EAS', name: 'Eastview', color: '#7c3aed' }, note: 'Youth Night', time: '6:30 PM', tix: 'kids 12 & under free' },
  { date: 'FRI, OCT 24', opp: { code: 'RIV', name: 'Riverside', color: '#be123c' }, note: 'Senior Night', time: '7:00 PM', tix: 'tickets at the door' },
];

export interface StandingRow { rank: number | string; name: string; code: string; color: string; w: number | string; l: number | string; pct: string; gb: string; strk: string; last10: string }
export const DEMO_STANDINGS: StandingRow[] = [
  { rank: 1, name: 'Eagles', code: 'EAG', color: '#1e3a8a', w: 12, l: 4, pct: '.750', gb: '—', strk: 'W3', last10: '8-2' },
  { rank: 2, name: 'Central', code: 'CEN', color: '#0f766e', w: 11, l: 5, pct: '.688', gb: '1', strk: 'W1', last10: '7-3' },
  { rank: 3, name: 'Northgate', code: 'NOR', color: '#1d4ed8', w: 10, l: 6, pct: '.625', gb: '2', strk: 'L1', last10: '6-4' },
  { rank: 4, name: 'Tigers', code: 'TIG', color: '#b91c1c', w: 9, l: 7, pct: '.563', gb: '3', strk: 'L2', last10: '5-5' },
  { rank: 5, name: 'Eastview', code: 'EAS', color: '#7c3aed', w: 7, l: 9, pct: '.438', gb: '5', strk: 'W1', last10: '4-6' },
  { rank: 6, name: 'Riverside', code: 'RIV', color: '#be123c', w: 5, l: 11, pct: '.313', gb: '7', strk: 'L3', last10: '3-7' },
];

export interface ConcessionStand { name: string; where: string; icon: string; wait: number | string }
export const DEMO_STANDS: ConcessionStand[] = [
  { name: 'Main Concession Stand', where: 'Main lobby', icon: '🌭', wait: 4 },
  { name: 'Booster Club Grill', where: 'North end zone', icon: '🍔', wait: 9 },
  { name: 'Snack Cart', where: 'Visitor side', icon: '🍿', wait: 3 },
  { name: 'Hot Drinks', where: 'Home bleachers', icon: '☕', wait: 6 },
];

/* ════════════════ legacy seeded copy ════════════════ */

/**
 * Copy the pack USED to seed into a zone's config on drop (pro-league
 * examples, a beer sponsor, an airline, a jeweller's Kiss Cam, a child's name
 * and age). A zone dropped before this fix still carries it in its saved
 * config — a school would publish it without ever typing it. Each string is
 * distinctive enough that no operator types it verbatim, so it is treated as
 * UNSET and the school-safe default renders instead. The two short sponsor
 * NAMES ('BUDWEISER', 'AMERICAN AIRLINES') could be a real pro venue's real
 * sponsor, so they are only scrubbed while their seeded tagline is still
 * beside them — see `ownSponsorName`.
 */
const LEGACY_SEEDED_COPY: ReadonlySet<string> = new Set([
  'PRESENTED BY · MIDWEST AUTO GROUP',
  'BUDWEISER · OFFICIAL BEER PARTNER',
  'KING OF BEERS',
  'now pouring · sec 110-114',
  'JAMES, AGE 8',
  'YOUR BULLS FAMILY',
  'BROUGHT TO YOU BY JEWELED VOWS DIAMOND CO.',
  "BROUGHT TO YOU BY POPEYE'S",
  'Look up · catch a shirt · take a selfie · tag @ChicagoBulls',
  'Going for great.',
  'Fly the Bulls and earn double AAdvantage miles all season long.',
  'aa.com/bulls',
  'Take the escalator to the upper concourse, walk left past Goose Island.',
]);

/** Seeded sponsor name → the seeded tagline it shipped with. */
const LEGACY_SEEDED_SPONSOR: Record<string, string> = {
  BUDWEISER: 'KING OF BEERS',
  'AMERICAN AIRLINES': 'Going for great.',
};

/** The operator's value, or undefined when it is empty or legacy seeded copy. */
export function ownCopy(v: unknown): string | undefined {
  if (typeof v !== 'string') return typeof v === 'number' ? String(v) : undefined;
  const s = v.trim();
  if (!s) return undefined;
  if (LEGACY_SEEDED_COPY.has(s)) return undefined;
  return v;
}

/** A sponsor name: a seeded sample name only counts as unset while its
 *  seeded tagline (or no tagline at all) is still next to it — a venue that
 *  typed its real sponsor's name over a tagline of its own keeps it. */
export function ownSponsorName(sponsor: unknown, tagline: unknown): string | undefined {
  const s = ownCopy(sponsor);
  if (!s) return undefined;
  const seededTagline = LEGACY_SEEDED_SPONSOR[s.trim().toUpperCase()];
  if (seededTagline !== undefined && (tagline === seededTagline || tagline == null || tagline === '')) {
    return undefined;
  }
  return s;
}

/* ════════════════ game → view ════════════════ */

/** A GameSnapshot-shaped read (structural, so this file needs no React). */
export interface VenueGameSnapshot {
  sport: string;
  status: string;
  segment: number;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  homeColor: string | null;
  awayColor: string | null;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
  stats: Record<string, unknown>;
  roster?: BoardRosterEntry[] | null;
}

/** Three-letter code from a team name ("Riverside Hawks" → "RIV"). */
export function teamCode(name: string | null | undefined): string {
  const s = String(name ?? '').replace(/[^A-Za-z0-9 ]/g, '').trim();
  if (!s) return '—';
  return s.slice(0, 3).toUpperCase();
}

const finiteOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * One side of a LIVE board: game facts (score / timeouts / fouls / shots)
 * come from the game and nothing else — so a value typed before binding can
 * never mask the real score (F29). Identity (name / code / colours / logo /
 * record) takes the operator's override when set.
 */
export function liveTeamView(
  snap: VenueGameSnapshot,
  side: 'home' | 'away',
  override: VenueTeamCfg | undefined,
  formatScore: (n: number) => string,
): VenueTeamView {
  const o = override || {};
  const name = side === 'home' ? snap.homeTeam : snap.awayTeam;
  const color = (side === 'home' ? snap.homeColor : snap.awayColor) || (side === 'home' ? '#1e3a8a' : '#b91c1c');
  const stats = snap.stats || {};
  const cap = side === 'home' ? 'home' : 'away';
  const shots = finiteOrNull(stats[`${cap}Shots`]);
  return {
    code: ownCopy(o.code) || teamCode(name),
    name: ownCopy(o.name) || name || (side === 'home' ? 'HOME' : 'AWAY'),
    color: ownCopy(o.color) || color,
    color2: ownCopy(o.color2) || '#000000',
    logoUrl: ownCopy(o.logoUrl) || (side === 'home' ? snap.homeLogoUrl : snap.awayLogoUrl) || '',
    record: ownCopy(o.record) || '',
    score: formatScore(side === 'home' ? snap.homeScore : snap.awayScore),
    timeouts: finiteOrNull(stats[`${cap}Timeouts`]),
    fouls: finiteOrNull(stats[`${cap}Fouls`]),
    shots: shots === null ? '' : String(shots),
  };
}

/** Manual or demo side: every value is the operator's (or the demo's). */
export function typedTeamView(
  cfg: VenueTeamCfg | undefined,
  fallback: VenueTeamCfg | null,
  side: 'home' | 'away',
): VenueTeamView {
  const o = cfg || {};
  const f = fallback || {};
  const pick = (k: keyof VenueTeamCfg): string | undefined => ownCopy(o[k]) ?? ownCopy(f[k]);
  const name = pick('name');
  const score = pick('score');
  const shots = pick('shots');
  return {
    code: pick('code') || (name ? teamCode(name) : side === 'home' ? 'HOME' : 'AWAY'),
    name: name || (side === 'home' ? 'HOME' : 'AWAY'),
    color: pick('color') || '#334155',
    color2: pick('color2') || '#000000',
    logoUrl: pick('logoUrl') || '',
    record: pick('record') || '',
    score: score ?? '—',
    timeouts: finiteOrNull(o.timeouts ?? f.timeouts),
    fouls: finiteOrNull(o.fouls ?? f.fouls),
    shots: shots ?? '',
  };
}

/** Is `c.home` / `c.away` carrying anything the operator typed? */
export function hasTypedTeam(t: VenueTeamCfg | undefined): boolean {
  if (!t) return false;
  return (['code', 'name', 'color', 'logoUrl', 'record', 'score'] as const).some((k) => ownCopy(t[k]) !== undefined);
}

/* ════════════════ roster ════════════════ */

/** Starters shown per sport when the operator has not picked a count. */
const LINEUP_COUNT: Record<string, number> = {
  basketball: 5,
  volleyball: 6,
  hockey: 6,
  water_polo: 7,
  baseball: 9,
  softball: 9,
  soccer: 11,
  field_hockey: 11,
  football: 11,
  lacrosse: 10,
};
export function defaultLineupCount(sport: string | null | undefined): number {
  return LINEUP_COUNT[String(sport || '')] ?? 5;
}

/** "Jordan Lee" → { first: 'JORDAN', last: 'LEE' }; a single token is the last name. */
export function splitName(name: string | null | undefined): { first: string; last: string } {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: '', last: '' };
  if (parts.length === 1) return { first: '', last: parts[0].toUpperCase() };
  return { first: parts.slice(0, -1).join(' ').toUpperCase(), last: parts[parts.length - 1].toUpperCase() };
}

/** The first `count` players on one side, in the roster's own order. */
export function lineupFromRoster(
  roster: BoardRosterEntry[] | null | undefined,
  side: 'home' | 'away',
  count: number,
): LineupPlayer[] {
  if (!Array.isArray(roster)) return [];
  return roster
    .filter((p) => (side === 'away' ? p.team === 'away' : p.team !== 'away'))
    .slice(0, Math.max(1, Math.min(12, count)))
    .map((p) => {
      const n = splitName(p.name);
      return {
        number: String(p.number ?? ''),
        first: n.first,
        last: n.last,
        position: String(p.position ?? '').toUpperCase(),
        photoUrl: p.photoUrl || undefined,
      };
    });
}

/** The roster entry for a jersey number on one side (the Player Card's pick). */
export function findRosterPlayer(
  roster: BoardRosterEntry[] | null | undefined,
  side: 'home' | 'away',
  number: string | number | null | undefined,
): BoardRosterEntry | null {
  if (!Array.isArray(roster)) return null;
  const want = String(number ?? '').trim();
  if (!want) return null;
  return roster.find((p) => (side === 'away' ? p.team === 'away' : p.team !== 'away') && String(p.number ?? '').trim() === want) ?? null;
}

/** A roster player's stats as a display line (first `max` entries). */
export function statLineFromRoster(p: BoardRosterEntry | null, max = 6): { label: string; value: string }[] {
  const s = p?.stats;
  if (!s || typeof s !== 'object') return [];
  const out: { label: string; value: string }[] = [];
  for (const [k, v] of Object.entries(s)) {
    if (out.length >= max) break;
    if (v === null || v === undefined || v === '' || typeof v === 'object') continue;
    if (/^(lane|seed|heat)$/i.test(k)) continue; // timing hints, not stats
    out.push({ label: k.toUpperCase(), value: String(v) });
  }
  return out;
}

/* ════════════════ head-to-head game stats ════════════════ */

interface SportStatLike { key: string; label: string; scope?: string; type?: string }

/**
 * Pair a sport's per-team numeric stats (`homeFouls` ↔ `awayFouls`) into
 * comparison rows, reading the live values off the game. The label is the
 * stat's own label without its side ("Home Fouls" → "FOULS").
 */
export function gameStatPairs(stats: readonly SportStatLike[] | undefined, values: Record<string, unknown>): StatPairRow[] {
  if (!Array.isArray(stats)) return [];
  const rows: StatPairRow[] = [];
  for (const s of stats) {
    if (s.scope !== 'home' || (s.type && s.type !== 'number')) continue;
    if (!/^home[A-Z]/.test(s.key)) continue;
    const suffix = s.key.slice(4);
    const awayKey = `away${suffix}`;
    if (!stats.some((x) => x.key === awayKey)) continue;
    const h = finiteOrNull(values[s.key]);
    const a = finiteOrNull(values[awayKey]);
    rows.push({
      label: String(s.label || suffix).replace(/^home\s+/i, '').toUpperCase(),
      home: h ?? '—',
      away: a ?? '—',
    });
  }
  return rows;
}

/* ════════════════ manual-score freshness ════════════════ */

/**
 * "AS OF 7:42 PM" (today) / "AS OF OCT 14, 7:42 PM" (older) — the honest
 * replacement for the pack's old "UPDATED LIVE", stamped by the Properties
 * panel whenever an operator edits the rows. Empty when never stamped.
 */
export function asOfLabel(iso: unknown, now: Date = new Date()): string {
  if (typeof iso !== 'string' || !iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const m = d.getMinutes();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const time = `${h}:${String(m).padStart(2, '0')} ${ampm}`;
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `AS OF ${time}`;
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  return `AS OF ${MONTHS[d.getMonth()]} ${d.getDate()}, ${time}`;
}
