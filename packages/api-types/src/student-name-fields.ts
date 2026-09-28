/**
 * Student names TYPED into templates (K-12 sports launch follow-up, lane B4,
 * 2026-09-27).
 *
 * The server's student-privacy gate (apps/api/src/sports/student-privacy.ts,
 * lane B3) sees every name that comes from a roster, a feed, a cue or the
 * console. It never saw the names an operator TYPES into a template: a relay
 * leg's swimmer, a CTS announcement line, a player card, a starting lineup, a
 * celebration's scorer. Those rode the template zone config straight to the
 * screen — past a school that has not confirmed its directory-information
 * policy, and past a family's opt-out.
 *
 * This module is the one list of WHERE a typed student name can live, shared
 * by both ends so they can never disagree:
 *   • the API blanks such a field on every real-screen output (the screen
 *     manifest, the public board payload, the USB export) when its value is a
 *     rostered student the school's policy hides — `redactStudentNameFields`
 *     with a matcher built server-side from the roster (the roster never
 *     leaves the server);
 *   • the builder warns on the same fields while the school's names are hidden
 *     (`studentNameKeysFor`).
 *
 * Field kinds:
 *   name — a person's name (a swimmer, a scorer). Blanked when it IS a hidden
 *          student's full or last name.
 *   pair — a first / last pair (a player card, a lineup row). Blanked as one
 *          name: first + last, or the last name alone.
 *   text — free words (an announcement line, a shoutout). Blanked when it is
 *          such a name, or when it carries a hidden student's FULL name as
 *          whole words ("PLAYER OF THE WEEK — JORDAN LEE"). A lone last name
 *          inside a sentence is left alone: "Lincoln" is a school as often as
 *          a student.
 *
 * Pure — no I/O, never mutates its input, never throws on odd shapes.
 */

export type StudentNameFieldKind = 'name' | 'pair' | 'text';

export interface StudentNameField {
  /**
   * Dotted config path. `[]` walks an array: `legs[].swimmer` is every leg's
   * swimmer, `players[]` every string in `players`.
   */
  path: string;
  kind: StudentNameFieldKind;
  /** pair only — the keys of the first and last name under `path`. */
  first?: string;
  last?: string;
}

/** Celebration config keys that name a person (the 76 v2 celebration scenes). */
export const CELEBRATION_PERSON_KEYS: readonly string[] = [
  'player',
  'pitcher',
  'runner',
  'scorer',
  'athlete',
  'hero',
  'goalie',
  'kicker',
  'passer',
  'dunker',
  'winner',
  'wrestler',
  'p1',
  'p2',
  'name',
];

/** Celebration keys holding a LIST of people. */
export const CELEBRATION_PERSON_LIST_KEYS: readonly string[] = ['players', 'assists'];

/** Fields by the zone's widget type (widgets addressed by type, not variant). */
export const STUDENT_NAME_FIELDS_BY_TYPE: Readonly<Record<string, readonly StudentNameField[]>> = {
  SWIM_RELAY_EXCHANGE: [{ path: 'legs[].swimmer', kind: 'name' }],
  SWIM_SPLITS_PANEL: [{ path: 'swimmerName', kind: 'name' }],
  DIVE_JUDGES_PANEL: [{ path: 'diverName', kind: 'name' }],
  SWIM_RECORD_LINE: [{ path: 'recordHolder', kind: 'text' }],
  STADIUM_MEET_BOARD: [{ path: 'recordHolder', kind: 'text' }],
  CELEBRATION: [
    ...CELEBRATION_PERSON_KEYS.map((k) => ({ path: k, kind: 'name' as const })),
    ...CELEBRATION_PERSON_LIST_KEYS.map((k) => ({ path: `${k}[]`, kind: 'name' as const })),
  ],
};

/** Fields by the zone's `config.variant` (the v2 packs, the CTS widgets). */
export const STUDENT_NAME_FIELDS_BY_VARIANT: Readonly<Record<string, readonly StudentNameField[]>> = {
  'player-card': [{ path: 'player', kind: 'pair', first: 'first', last: 'last' }],
  'starting-lineup': [{ path: 'lineup[]', kind: 'pair', first: 'first', last: 'last' }],
  'goal-celebration': [{ path: 'player.name', kind: 'name' }],
  'ribbon-fan-shoutout': [
    { path: 'name', kind: 'text' },
    { path: 'from', kind: 'text' },
  ],
  'ribbon-ticker': [{ path: 'segments[].text', kind: 'text' }],
  'ribbon-main': [{ path: 'messages[]', kind: 'text' }],
  'scoreboard-cts-announcement': [{ path: 'entries[].text', kind: 'text' }],
  'sb-leaderboard': [{ path: 'rows[].name', kind: 'name' }],
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** The typed-student-name fields of one zone (its variant's, then its type's). */
export function studentNameFieldsFor(
  widgetType: string | null | undefined,
  config: unknown,
): readonly StudentNameField[] {
  const variant = isRecord(config) && typeof config.variant === 'string' ? config.variant : '';
  const byVariant = variant ? STUDENT_NAME_FIELDS_BY_VARIANT[variant] : undefined;
  const byType = widgetType ? STUDENT_NAME_FIELDS_BY_TYPE[widgetType] : undefined;
  if (byVariant && byType) return [...byVariant, ...byType];
  return byVariant ?? byType ?? [];
}

/**
 * The top-level config keys of a zone that hold typed student names — where
 * the builder shows its notice (`legs`, `swimmerName`, `player`, `entries`…).
 */
export function studentNameKeysFor(widgetType: string | null | undefined, config: unknown): Set<string> {
  const out = new Set<string>();
  for (const f of studentNameFieldsFor(widgetType, config)) {
    out.add(f.path.split('.')[0].replace(/\[\]$/, ''));
  }
  return out;
}

/**
 * The keys a Properties-panel EDITOR writes for a zone's typed-student-name
 * fields — where the builder's notice goes: a list's own key for a list of
 * rows (`legs`, `lineup`, `entries`), each half of a first / last pair
 * (`player.first`, `player.last`), and a plain field's path (`swimmerName`,
 * `player.name`).
 */
export function studentNameEditorKeys(widgetType: string | null | undefined, config: unknown): Set<string> {
  const out = new Set<string>();
  for (const f of studentNameFieldsFor(widgetType, config)) {
    const segs = f.path.split('.');
    const listAt = segs.findIndex((s) => s.endsWith('[]'));
    if (listAt >= 0) {
      out.add(segs.slice(0, listAt + 1).join('.').replace(/\[\]$/, ''));
    } else if (f.kind === 'pair' && f.first && f.last) {
      out.add(`${f.path}.${f.first}`);
      out.add(`${f.path}.${f.last}`);
    } else {
      out.add(f.path);
    }
  }
  return out;
}

/** What the server decided a typed value is (built from the roster + policy). */
export interface StudentNameMatcher {
  /** A name field's value IS a hidden student's full or last name. */
  name(value: string): boolean;
  /** A free-text value is such a name, or carries a hidden full name as words. */
  text(value: string): boolean;
}

interface Redaction {
  changed: boolean;
  blanked: number;
}

function redactAt(
  node: unknown,
  segments: string[],
  field: StudentNameField,
  matcher: StudentNameMatcher,
  r: Redaction,
): unknown {
  if (segments.length === 0) {
    if (field.kind === 'pair') {
      if (!isRecord(node) || !field.first || !field.last) return node;
      const first = typeof node[field.first] === 'string' ? (node[field.first] as string) : '';
      const last = typeof node[field.last] === 'string' ? (node[field.last] as string) : '';
      if (!first.trim() && !last.trim()) return node;
      const full = `${first} ${last}`.trim();
      if (!matcher.name(full) && !(last.trim() && matcher.name(last))) return node;
      r.changed = true;
      r.blanked += 1;
      return { ...node, [field.first]: '', [field.last]: '' };
    }
    if (typeof node !== 'string' || !node.trim()) return node;
    const hide = field.kind === 'text' ? matcher.text(node) : matcher.name(node);
    if (!hide) return node;
    r.changed = true;
    r.blanked += 1;
    return '';
  }
  const [head, ...rest] = segments;
  const many = head.endsWith('[]');
  const key = many ? head.slice(0, -2) : head;
  if (!isRecord(node) || !(key in node)) return node;
  const value = node[key];
  let next: unknown;
  if (many) {
    if (!Array.isArray(value)) return node;
    let arrayChanged = false;
    const mapped = value.map((item) => {
      const out = redactAt(item, rest, field, matcher, r);
      if (out !== item) arrayChanged = true;
      return out;
    });
    next = arrayChanged ? mapped : value;
  } else {
    next = redactAt(value, rest, field, matcher, r);
  }
  return next === value ? node : { ...node, [key]: next };
}

/**
 * The zone config with every typed student name the matcher hides blanked
 * (`''`). Returns the SAME object when nothing is hidden, so a caller can
 * tell "unchanged" by identity; never mutates `config`.
 */
export function redactStudentNameFields(
  widgetType: string | null | undefined,
  config: unknown,
  matcher: StudentNameMatcher,
): { config: unknown; blanked: number } {
  const fields = studentNameFieldsFor(widgetType, config);
  if (fields.length === 0 || !isRecord(config)) return { config, blanked: 0 };
  const r: Redaction = { changed: false, blanked: 0 };
  let out: unknown = config;
  for (const f of fields) out = redactAt(out, f.path.split('.'), f, matcher, r);
  return { config: r.changed ? out : config, blanked: r.blanked };
}

/** Does this zone carry a non-empty value in any typed-student-name field? */
export function hasTypedStudentNames(widgetType: string | null | undefined, config: unknown): boolean {
  let seen = false;
  const probe: StudentNameMatcher = {
    name: (v) => {
      if (v.trim()) seen = true;
      return false;
    },
    text: (v) => {
      if (v.trim()) seen = true;
      return false;
    },
  };
  redactStudentNameFields(widgetType, config, probe);
  return seen;
}

/**
 * Name normalization for matching typed values: case-, width-, accent-form-
 * and punctuation-insensitive words ("LEE.", " Lee ", "ＬＥＥ" → "lee").
 * Apostrophes and hyphens stay part of a name (O'Brien, Smith-Jones).
 */
export function normalizeTypedName(v: string): string {
  return v
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}'’\-]+/gu, ' ')
    .replace(/’/g, "'")
    .trim()
    .replace(/\s+/g, ' ');
}
