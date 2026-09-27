/**
 * Properties-panel schema for the sports-venue pack (K-12 launch audit F30,
 * 2026-09-27). Pure data — `SportsVenueEditor` in PropertiesPanel.tsx renders
 * it with the panel's own field components, so every control here is the
 * same control the rest of the builder uses (brand swatches on every colour,
 * the asset picker on every image, add / remove / reorder on every list).
 *
 * THE BUG THIS REPLACES: the venue variants are registered under the
 * canonical SCOREBOARD type, whose hand-built case handled only sb-* / main
 * / CTS variants and then fell through to the LEGACY generic scoreboard
 * fields (status, period, homeName, homeScore…). The venue renderers read
 * none of those: they read nested `home.name`, `segments`, `rows`, `games`,
 * `player.*`. Every visible word on seventeen widgets was unreachable, and
 * the fields that WERE shown wrote keys nothing rendered.
 *
 * CONTRACT (tested in sports-venue-editor.test.ts): every key a spec writes
 * is a key its renderer in v2/SportsVenueWidgets.tsx reads.
 *
 * Labels are keys under `sportsTemplates.venue` in the locale catalogs.
 */
import {
  DEMO_COMPARE, DEMO_HOME_GAMES, DEMO_LINEUP, DEMO_OOT, DEMO_STANDINGS, DEMO_STANDS,
  DEMO_STATLINE, DEMO_TICKER_SEGMENTS,
} from '@/components/widgets/v2/sports-venue-data';

export type RowFieldType = 'text' | 'number' | 'image' | 'color' | 'select' | 'textarea';

export interface VenueRowField {
  key: string;
  /** i18n key under sportsTemplates.venue */
  label: string;
  type?: RowFieldType;
  placeholder?: string;
  options?: [string, string][];
}

interface Base {
  /** Show only in this data mode (live-capable widgets). */
  only?: 'live' | 'manual';
}

export type VenueFieldSpec =
  | (Base & { kind: 'mode' })
  | (Base & { kind: 'game' })
  | (Base & { kind: 'section'; label: string })
  | (Base & { kind: 'text'; key: string; label: string; placeholder?: string; multiline?: boolean })
  | (Base & { kind: 'number'; key: string; label: string; placeholder?: string })
  | (Base & { kind: 'color'; key: string; label: string; fallback: string })
  | (Base & { kind: 'image'; key: string; label: string })
  | (Base & { kind: 'toggle'; key: string; label: string; defaultOn?: boolean })
  | (Base & { kind: 'select'; key: string; label: string; options: [string, string][]; fallback: string })
  | (Base & {
      /** A nested team object at `key` (dotted paths allowed). */
      kind: 'team';
      key: string;
      label: string;
      /** Manual adds game facts (score / timeouts / fouls / shots). */
      facts?: boolean;
    })
  | (Base & {
      kind: 'rows';
      key: string;
      label: string;
      item: string;
      fields: VenueRowField[];
      /** Builder sample the operator can copy in and edit. */
      sample: () => Record<string, unknown>[];
      /** Stored shape ↔ flat editor row (nested objects like `away.code`). */
      toRow?: (stored: Record<string, unknown>) => Record<string, unknown>;
      fromRow?: (row: Record<string, unknown>) => Record<string, unknown>;
      /** Stamp `asOf` whenever the rows change (manual score boards). */
      stampAsOf?: boolean;
    })
  | (Base & { kind: 'strings'; key: string; label: string; item: string; sample: () => string[] });

/* ── shared option lists (values are config values; labels are i18n keys) ── */

const SIDE: [string, string][] = [['home', 'optHome'], ['away', 'optAway']];
const POSSESSION: [string, string][] = [['', 'optNone'], ['home', 'optHome'], ['away', 'optAway']];
const TINT: [string, string][] = [['', 'optTintText'], ['accent', 'optTintAccent'], ['accent2', 'optTintAccent2']];

const MODE_AND_GAME: VenueFieldSpec[] = [{ kind: 'mode' }, { kind: 'game', only: 'live' }];

/* ── nested-row mappers ── */

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});

const oot = {
  toRow: (g: Obj): Obj => ({
    status: g.status ?? '', note: g.note ?? '',
    awayCode: o(g.away).code ?? '', awayScore: o(g.away).score ?? '', awayColor: o(g.away).color ?? '#334155',
    homeCode: o(g.home).code ?? '', homeScore: o(g.home).score ?? '', homeColor: o(g.home).color ?? '#334155',
  }),
  fromRow: (r: Obj): Obj => ({
    status: r.status ?? '', note: r.note ?? '',
    away: { code: r.awayCode ?? '', score: r.awayScore ?? '', color: r.awayColor ?? '#334155' },
    home: { code: r.homeCode ?? '', score: r.homeScore ?? '', color: r.homeColor ?? '#334155' },
  }),
};

const schedule = {
  toRow: (g: Obj): Obj => ({
    date: g.date ?? '', oppName: o(g.opp).name ?? '', oppCode: o(g.opp).code ?? '', oppColor: o(g.opp).color ?? '#334155',
    note: g.note ?? '', time: g.time ?? '', tix: g.tix ?? '',
  }),
  fromRow: (r: Obj): Obj => ({
    date: r.date ?? '', note: r.note ?? '', time: r.time ?? '', tix: r.tix ?? '',
    opp: { name: r.oppName ?? '', code: r.oppCode ?? '', color: r.oppColor ?? '#334155' },
  }),
};

/* ── per-variant schema ── */

export const SPORTS_VENUE_EDITOR: Record<string, VenueFieldSpec[]> = {
  'stadium-scoreboard': [
    ...MODE_AND_GAME,
    { kind: 'section', label: 'secTeams' },
    { kind: 'team', key: 'home', label: 'homeTeam', facts: true },
    { kind: 'team', key: 'away', label: 'awayTeam', facts: true },
    { kind: 'section', label: 'secGame', only: 'manual' },
    { kind: 'text', key: 'clock', label: 'clock', placeholder: '4:21', only: 'manual' },
    { kind: 'text', key: 'period', label: 'period', placeholder: 'Q3', only: 'manual' },
    { kind: 'text', key: 'sport', label: 'sportLabel', placeholder: 'BASKETBALL', only: 'manual' },
    { kind: 'select', key: 'possession', label: 'possession', options: POSSESSION, fallback: '', only: 'manual' },
    { kind: 'toggle', key: 'homeBonus', label: 'homeBonus', only: 'manual' },
    { kind: 'toggle', key: 'awayBonus', label: 'awayBonus', only: 'manual' },
    { kind: 'section', label: 'secSponsors' },
    { kind: 'text', key: 'topSponsor', label: 'topSponsor', placeholder: 'PRESENTED BY · YOUR SPONSOR' },
    { kind: 'text', key: 'bottomSponsor', label: 'bottomSponsor', placeholder: 'THANK YOU TO OUR BOOSTER CLUB' },
  ],
  'ribbon-ticker': [
    ...MODE_AND_GAME,
    { kind: 'team', key: 'home', label: 'homeTeam', facts: true },
    { kind: 'team', key: 'away', label: 'awayTeam', facts: true },
    { kind: 'text', key: 'clock', label: 'clock', placeholder: '4:21', only: 'manual' },
    { kind: 'text', key: 'period', label: 'period', placeholder: 'Q3', only: 'manual' },
    {
      kind: 'rows', key: 'segments', label: 'segments', item: 'itemMessage',
      fields: [
        { key: 'text', label: 'message', placeholder: 'GO EAGLES!' },
        { key: 'tint', label: 'tint', type: 'select', options: TINT },
      ],
      sample: () => DEMO_TICKER_SEGMENTS.map((s) => ({ ...s })),
    },
    { kind: 'number', key: 'scrollSpeed', label: 'scrollSeconds', placeholder: '40' },
  ],
  'ribbon-sponsor': [
    { kind: 'text', key: 'sponsor', label: 'sponsorName', placeholder: 'YOUR SPONSOR' },
    { kind: 'image', key: 'logoUrl', label: 'sponsorLogo' },
    { kind: 'text', key: 'partnerLabel', label: 'partnerLabel', placeholder: 'OFFICIAL PARTNER' },
    { kind: 'text', key: 'tagline', label: 'tagline', placeholder: 'PROUD SUPPORTER OF EAGLES ATHLETICS' },
    { kind: 'text', key: 'cta', label: 'cta', placeholder: 'visit the booster table' },
    { kind: 'color', key: 'bg', label: 'background', fallback: '#1e3a8a' },
  ],
  'ribbon-fan-shoutout': [
    { kind: 'text', key: 'kind', label: 'shoutKind', placeholder: 'WELCOME' },
    { kind: 'text', key: 'name', label: 'shoutName', placeholder: 'CLASS OF 2027' },
    { kind: 'text', key: 'from', label: 'shoutFrom', placeholder: 'EAGLES ATHLETICS' },
    { kind: 'text', key: 'icon', label: 'icon', placeholder: '🎉' },
  ],
  'player-card': [
    ...MODE_AND_GAME,
    { kind: 'select', key: 'side', label: 'side', options: SIDE, fallback: 'home' },
    { kind: 'text', key: 'number', label: 'rosterNumber', placeholder: '12', only: 'live' },
    { kind: 'team', key: 'player.team', label: 'team' },
    { kind: 'section', label: 'secPlayer', only: 'manual' },
    { kind: 'text', key: 'player.first', label: 'firstName', placeholder: 'JORDAN', only: 'manual' },
    { kind: 'text', key: 'player.last', label: 'lastName', placeholder: 'LEE', only: 'manual' },
    { kind: 'text', key: 'player.number', label: 'jersey', placeholder: '3', only: 'manual' },
    { kind: 'text', key: 'player.position', label: 'position', placeholder: 'GUARD', only: 'manual' },
    { kind: 'text', key: 'player.years', label: 'classYear', placeholder: 'SR', only: 'manual' },
    { kind: 'image', key: 'player.photoUrl', label: 'photo', only: 'manual' },
    {
      kind: 'rows', key: 'player.statLine', label: 'statLine', item: 'itemStat', only: 'manual',
      fields: [
        { key: 'label', label: 'statLabel', placeholder: 'PTS' },
        { key: 'value', label: 'statValue', placeholder: '18' },
      ],
      sample: () => DEMO_STATLINE.map((s) => ({ ...s })),
    },
  ],
  'starting-lineup': [
    ...MODE_AND_GAME,
    { kind: 'select', key: 'side', label: 'side', options: SIDE, fallback: 'home' },
    { kind: 'number', key: 'count', label: 'lineupCount', placeholder: '5', only: 'live' },
    { kind: 'text', key: 'title', label: 'title', placeholder: 'STARTING LINEUP' },
    { kind: 'team', key: 'team', label: 'team' },
    {
      kind: 'rows', key: 'lineup', label: 'players', item: 'itemPlayer', only: 'manual',
      fields: [
        { key: 'number', label: 'jersey', placeholder: '3' },
        { key: 'first', label: 'firstName', placeholder: 'JORDAN' },
        { key: 'last', label: 'lastName', placeholder: 'LEE' },
        { key: 'position', label: 'position', placeholder: 'G' },
        { key: 'detail', label: 'detail', placeholder: 'SR' },
        { key: 'photoUrl', label: 'photo', type: 'image' },
      ],
      sample: () => DEMO_LINEUP.map((p) => ({ ...p })),
    },
  ],
  'stat-comparison': [
    ...MODE_AND_GAME,
    { kind: 'select', key: 'statsSource', label: 'statsSource', options: [['game', 'optStatsGame'], ['manual', 'optStatsManual']], fallback: 'game', only: 'live' },
    { kind: 'text', key: 'scope', label: 'scope', placeholder: 'SEASON AVERAGES' },
    { kind: 'team', key: 'home', label: 'homeTeam' },
    { kind: 'team', key: 'away', label: 'awayTeam' },
    {
      kind: 'rows', key: 'stats', label: 'statRows', item: 'itemStat',
      fields: [
        { key: 'label', label: 'statLabel', placeholder: 'PTS' },
        { key: 'home', label: 'homeValue', placeholder: '58.2' },
        { key: 'away', label: 'awayValue', placeholder: '54.9' },
      ],
      sample: () => DEMO_COMPARE.map((s) => ({ ...s })),
    },
  ],
  'out-of-town-scores': [
    { kind: 'text', key: 'eyebrow', label: 'eyebrow', placeholder: 'AROUND THE CONFERENCE' },
    { kind: 'text', key: 'title', label: 'title', placeholder: 'Scores' },
    {
      kind: 'rows', key: 'games', label: 'games', item: 'itemGame', stampAsOf: true,
      fields: [
        { key: 'awayCode', label: 'awayCode', placeholder: 'CEN' },
        { key: 'awayScore', label: 'awayScoreRow', placeholder: '51' },
        { key: 'awayColor', label: 'awayColorRow', type: 'color' },
        { key: 'homeCode', label: 'homeCode', placeholder: 'NOR' },
        { key: 'homeScore', label: 'homeScoreRow', placeholder: '47' },
        { key: 'homeColor', label: 'homeColorRow', type: 'color' },
        { key: 'status', label: 'status', placeholder: 'FINAL' },
        { key: 'note', label: 'note', placeholder: 'final' },
      ],
      sample: () => DEMO_OOT.map((g) => oot.toRow(g as unknown as Obj)),
      toRow: oot.toRow,
      fromRow: oot.fromRow,
    },
  ],
  'kiss-cam': [
    { kind: 'text', key: 'kind', label: 'camTitle', placeholder: 'FAN CAM' },
    { kind: 'select', key: 'shape', label: 'camShape', options: [['frame', 'optShapeFrame'], ['heart', 'optShapeHeart'], ['star', 'optShapeStar'], ['circle', 'optShapeCircle']], fallback: 'frame' },
    { kind: 'color', key: 'tone', label: 'camColor', fallback: '#2563eb' },
    { kind: 'text', key: 'sponsor', label: 'camSponsor', placeholder: 'PRESENTED BY YOUR SPONSOR' },
  ],
  'noise-meter': [
    { kind: 'text', key: 'headline', label: 'headline', placeholder: 'MAKE SOME NOISE' },
    { kind: 'text', key: 'prompt', label: 'prompt', placeholder: 'Get LOUD!' },
    { kind: 'number', key: 'level', label: 'meterPeak', placeholder: '90' },
  ],
  'in-game-promo': [
    { kind: 'text', key: 'kicker', label: 'kicker', placeholder: 'BROUGHT TO YOU BY YOUR SPONSOR' },
    { kind: 'text', key: 'title', label: 'title', placeholder: 'T-SHIRT TOSS' },
    { kind: 'text', key: 'subtitle', label: 'subtitle', placeholder: 'Look up · catch a shirt · show your school spirit' },
    { kind: 'strings', key: 'sections', label: 'sections', item: 'itemSection', sample: () => ['HOME SIDE', 'STUDENT SECTION', 'VISITOR SIDE'] },
    { kind: 'text', key: 'cta', label: 'cta', placeholder: 'NEXT TOSS · HALFTIME' },
    { kind: 'color', key: 'accent', label: 'accent', fallback: '#ffd23a' },
  ],
  'sponsor-takeover': [
    { kind: 'text', key: 'partnerLine', label: 'partnerLine', placeholder: 'PROUD PARTNER · EAGLES ATHLETICS' },
    { kind: 'text', key: 'sponsor', label: 'sponsorName', placeholder: 'YOUR SPONSOR' },
    { kind: 'image', key: 'logoUrl', label: 'sponsorLogo' },
    { kind: 'text', key: 'tagline', label: 'tagline', placeholder: 'Proud supporter of student athletes.' },
    { kind: 'text', key: 'body', label: 'body', placeholder: 'Thank you for supporting our teams all season long.', multiline: true },
    { kind: 'text', key: 'cta', label: 'cta', placeholder: 'yoursponsor.com' },
    { kind: 'color', key: 'bg', label: 'background', fallback: '#0a4a8a' },
  ],
  'home-schedule': [
    { kind: 'text', key: 'eyebrow', label: 'eyebrow', placeholder: 'UPCOMING HOME GAMES' },
    { kind: 'team', key: 'team', label: 'team' },
    {
      kind: 'rows', key: 'games', label: 'games', item: 'itemGame',
      fields: [
        { key: 'date', label: 'date', placeholder: 'FRI, OCT 17' },
        { key: 'oppName', label: 'opponent', placeholder: 'Northgate' },
        { key: 'oppCode', label: 'opponentCode', placeholder: 'NOR' },
        { key: 'oppColor', label: 'opponentColor', type: 'color' },
        { key: 'note', label: 'theme', placeholder: 'Homecoming' },
        { key: 'time', label: 'time', placeholder: '7:00 PM' },
        { key: 'tix', label: 'tickets', placeholder: 'tickets at the door' },
      ],
      sample: () => DEMO_HOME_GAMES.map((g) => schedule.toRow(g as unknown as Obj)),
      toRow: schedule.toRow,
      fromRow: schedule.fromRow,
    },
  ],
  'standings-board': [
    { kind: 'text', key: 'scope', label: 'scope', placeholder: 'CONFERENCE STANDINGS' },
    { kind: 'text', key: 'team.code', label: 'highlightCode', placeholder: 'EAG' },
    { kind: 'color', key: 'team.color', label: 'highlightColor', fallback: '#1e3a8a' },
    {
      kind: 'rows', key: 'rows', label: 'standingsRows', item: 'itemTeam', stampAsOf: true,
      fields: [
        { key: 'rank', label: 'rank', placeholder: '1' },
        { key: 'name', label: 'teamName', placeholder: 'Eagles' },
        { key: 'code', label: 'teamCode', placeholder: 'EAG' },
        { key: 'color', label: 'teamColor', type: 'color' },
        { key: 'w', label: 'wins', placeholder: '12' },
        { key: 'l', label: 'losses', placeholder: '4' },
        { key: 'pct', label: 'pct', placeholder: '.750' },
        { key: 'gb', label: 'gb', placeholder: '—' },
        { key: 'strk', label: 'streak', placeholder: 'W3' },
        { key: 'last10', label: 'last10', placeholder: '8-2' },
      ],
      sample: () => DEMO_STANDINGS.map((r) => ({ ...r })),
    },
  ],
  'concession-waits': [
    { kind: 'text', key: 'eyebrow', label: 'eyebrow', placeholder: 'ESTIMATED WAIT TIMES' },
    { kind: 'text', key: 'title', label: 'title', placeholder: 'Grab a bite' },
    {
      kind: 'rows', key: 'stands', label: 'stands', item: 'itemStand', stampAsOf: true,
      fields: [
        { key: 'name', label: 'standName', placeholder: 'Main Concession Stand' },
        { key: 'where', label: 'standWhere', placeholder: 'Main lobby' },
        { key: 'icon', label: 'icon', placeholder: '🌭' },
        { key: 'wait', label: 'waitMinutes', placeholder: '5' },
      ],
      sample: () => DEMO_STANDS.map((s) => ({ ...s })),
    },
  ],
  'gate-wayfinding': [
    { kind: 'text', key: 'sectionLabel', label: 'sectionLabel', placeholder: 'YOUR SECTION' },
    { kind: 'text', key: 'section', label: 'section', placeholder: 'HOME' },
    { kind: 'text', key: 'gateLabel', label: 'gateLabel', placeholder: 'USE GATE' },
    { kind: 'text', key: 'gate', label: 'gate', placeholder: 'B' },
    { kind: 'text', key: 'distance', label: 'distance', placeholder: '2 MIN WALK' },
    { kind: 'text', key: 'directions', label: 'directions', placeholder: 'Enter through the main lobby and follow the signs to the gym.', multiline: true },
    { kind: 'text', key: 'qrUrl', label: 'qrUrl', placeholder: 'https://' },
    { kind: 'text', key: 'qrTitle', label: 'qrTitle', placeholder: 'Scan for the seating map' },
    { kind: 'text', key: 'qrSubtitle', label: 'qrSubtitle', placeholder: 'Opens on your phone' },
  ],
  'goal-celebration': [
    ...MODE_AND_GAME,
    { kind: 'select', key: 'side', label: 'celebratingSide', options: SIDE, fallback: 'home' },
    { kind: 'text', key: 'label', label: 'celebrationWord', placeholder: 'GOAL!' },
    { kind: 'text', key: 'player.number', label: 'scorerNumber', placeholder: '10' },
    { kind: 'text', key: 'player.name', label: 'scorerName', placeholder: 'JORDAN LEE' },
    { kind: 'toggle', key: 'showScore', label: 'showScore', defaultOn: true, only: 'live' },
    { kind: 'team', key: 'team', label: 'team' },
  ],
};

export const SPORTS_VENUE_VARIANTS: ReadonlySet<string> = new Set(Object.keys(SPORTS_VENUE_EDITOR));

/** Which variants read the game (and so offer Live / Manual). */
export function venueHasModes(variant: string): boolean {
  return (SPORTS_VENUE_EDITOR[variant] || []).some((f) => f.kind === 'mode');
}

/* ── dotted-path helpers (pure) ── */

export function getPath(cfg: Obj, path: string): unknown {
  let cur: unknown = cfg;
  for (const part of path.split('.')) {
    if (!cur || typeof cur !== 'object') return undefined;
    cur = (cur as Obj)[part];
  }
  return cur;
}

/** The TOP-LEVEL patch that sets `path` to `value`, preserving siblings. */
export function patchPath(cfg: Obj, path: string, value: unknown): Obj {
  const parts = path.split('.');
  const build = (node: unknown, i: number): unknown => {
    if (i === parts.length) return value;
    const base = node && typeof node === 'object' && !Array.isArray(node) ? (node as Obj) : {};
    return { ...base, [parts[i]]: build(base[parts[i]], i + 1) };
  };
  const top = parts[0];
  return { [top]: parts.length === 1 ? value : build(cfg[top], 1) };
}

/** Team sub-fields. `facts` only in manual mode on a scoreboard-type widget. */
export const TEAM_IDENTITY_FIELDS: { key: string; label: string; type: 'text' | 'color' | 'image'; placeholder?: string }[] = [
  { key: 'name', label: 'teamName', type: 'text', placeholder: 'Eagles' },
  { key: 'code', label: 'teamCode', type: 'text', placeholder: 'EAG' },
  { key: 'color', label: 'teamColor', type: 'color' },
  { key: 'color2', label: 'teamColor2', type: 'color' },
  { key: 'logoUrl', label: 'teamLogo', type: 'image' },
  { key: 'record', label: 'record', type: 'text', placeholder: '12-4' },
];
export const TEAM_FACT_FIELDS: { key: string; label: string; placeholder?: string }[] = [
  { key: 'score', label: 'score', placeholder: '48' },
  { key: 'timeouts', label: 'timeoutsLeft', placeholder: '3' },
  { key: 'fouls', label: 'fouls', placeholder: '4' },
  { key: 'shots', label: 'shots', placeholder: '21' },
];
