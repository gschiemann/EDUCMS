/**
 * Student information on PUBLIC outputs — the one server-side gate (K-12 sports
 * launch, lane B3, 2026-09-27).
 *
 * Greg: "follow the laws, dont show any kids without some legal approval from
 * someone". Design: docs/research/2026-09-24-k12-sports-launch-program/
 * 03-STUDENT-PRIVACY-DESIGN.md. Not legal advice — the product makes the
 * SCHOOL's decision explicit, recorded and default-deny.
 *
 * WHO IT APPLIES TO: a K-12 tenant (its own vertical, or any tenant up its
 * chain), or a tenant that says it serves minors. Everyone else keeps the
 * per-game roster switches (./roster-privacy.ts) exactly as before.
 *
 * WHAT IT DECIDES, per student, on every public output:
 *   name  — shown only if the school (or its district) confirmed the
 *           directory-information attestation, no one in the chain chose
 *           HIDE, the family did not opt out, and the game's own switch
 *           allows it (full / last only / hidden);
 *   photo — additionally needs the photo-release attestation AND this
 *           student's "Photo release on file";
 *   opt-out — a family's directory opt-out hides name AND photo whatever
 *           anything else says, in every vertical;
 *   numbers, positions, stats — the game's switches only (not student names).
 * The game's switches can only make the answer STRICTER, never looser: each
 * is AND-ed with the school's policy here.
 *
 * WHERE IT RUNS: SportsService.getBoardFresh builds the public board payload
 * (the /board, /ribbon, /scorebug, /overlay pages, every player-side sports
 * widget and the CTS reels all read that one payload), and the public athlete
 * page (getPublicAthleteProfile). Every field in that payload that can carry a
 * student's name or photo goes through a function in this file:
 *   roster                         publicStudentView
 *   pre-game intro lineup (cue)    publicCuePayload
 *   celebration scorer (cue)       publicCuePayload
 *   spotlight                      publicSpotlight
 *   stats.results (typed meet results AND the swim-feed lane→name join),
 *   stats.playerFouls, stats.playerExclusions, stats.currentDiver,
 *   stats.leadRunner               publicStats
 *   live overlay jersey            publicLiveOverlay
 *   leaders / player of the game   computed FROM the already-public roster
 * The operator's own authenticated views (roster manager, console) are
 * untouched: staff still see the roster as entered.
 *
 * FAIL CLOSED: if the policy cannot be read, a public output treats the tenant
 * as a school that has confirmed nothing (CLOSED_STUDENT_POLICY) — a database
 * blip may hide names for a second; it may never show one.
 */
import {
  isAcceptedStudentPrivacyVersion,
  studentPrivacyAppliesToVertical,
  type StudentPrivacyCategory,
  type StudentPrivacyState,
} from '@cms/api-types';
import {
  DEFAULT_ROSTER_PRIVACY,
  redactRosterEntry,
  type RosterNameMode,
  type RosterPrivacy,
} from './roster-privacy';

/* ════════════════ the school's policy ════════════════ */

/** One tenant in the school → district chain, with its own settings. */
export interface PolicyChainNode {
  tenantId: string;
  name?: string | null;
  vertical?: string | null;
  servesMinors?: boolean | null;
  namesState?: string | null;
  namesSetAt?: Date | string | null;
  namesSetByUserId?: string | null;
  namesAttestationVersion?: string | null;
  photosState?: string | null;
  photosSetAt?: Date | string | null;
  photosSetByUserId?: string | null;
  photosAttestationVersion?: string | null;
}

export interface CategoryResolution {
  allowed: boolean;
  /** Index in the chain of the setting that decided, or -1 (nobody: default deny). */
  sourceIndex: number;
  sourceState: StudentPrivacyState | null;
}

export interface ResolvedStudentPrivacy {
  applies: boolean;
  appliesBecause: 'k12' | 'serves-minors' | null;
  names: CategoryResolution;
  photos: CategoryResolution;
}

/** Everything a public output needs to know about the school's policy. */
export interface StudentPolicy {
  /** The default-deny applies (a school, or a tenant serving minors). */
  applies: boolean;
  /** Names may show (only meaningful when `applies`). */
  names: boolean;
  /** Photos may show, for students with a release on file (only when `applies`). */
  photos: boolean;
}

/** A tenant the policy does not apply to: today's behaviour. */
export const OPEN_STUDENT_POLICY: Readonly<StudentPolicy> = Object.freeze({
  applies: false,
  names: true,
  photos: true,
});

/** Fail-closed: a school that has confirmed nothing. */
export const CLOSED_STUDENT_POLICY: Readonly<StudentPolicy> = Object.freeze({
  applies: true,
  names: false,
  photos: false,
});

export function privacyStateOf(v: unknown): StudentPrivacyState | null {
  return v === 'ALLOW' || v === 'HIDE' ? v : null;
}

function nodeState(n: PolicyChainNode, cat: StudentPrivacyCategory) {
  return privacyStateOf(cat === 'names' ? n.namesState : n.photosState);
}

function nodeVersion(n: PolicyChainNode, cat: StudentPrivacyCategory) {
  return cat === 'names'
    ? n.namesAttestationVersion
    : n.photosAttestationVersion;
}

function resolveCategory(
  chain: readonly PolicyChainNode[],
  cat: StudentPrivacyCategory,
): CategoryResolution {
  // Stricter always wins: a HIDE anywhere in the chain — the school's own, or
  // its district's — hides, whatever anyone else confirmed.
  const hideAt = chain.findIndex((n) => nodeState(n, cat) === 'HIDE');
  if (hideAt >= 0)
    return { allowed: false, sourceIndex: hideAt, sourceState: 'HIDE' };
  // The nearest confirmation of a wording that still counts allows; a school
  // with none inherits its district's.
  const allowAt = chain.findIndex(
    (n) =>
      nodeState(n, cat) === 'ALLOW' &&
      isAcceptedStudentPrivacyVersion(nodeVersion(n, cat)),
  );
  if (allowAt >= 0)
    return { allowed: true, sourceIndex: allowAt, sourceState: 'ALLOW' };
  return { allowed: false, sourceIndex: -1, sourceState: null };
}

/**
 * Resolve the policy from a tenant chain, the tenant itself FIRST and then its
 * parent, grandparent… (the order loadPolicyChain returns).
 */
export function resolveStudentPrivacy(
  chain: readonly PolicyChainNode[],
): ResolvedStudentPrivacy {
  const k12 = chain.some((n) => studentPrivacyAppliesToVertical(n.vertical));
  const minors = chain.some((n) => n.servesMinors === true);
  return {
    applies: k12 || minors,
    appliesBecause: k12 ? 'k12' : minors ? 'serves-minors' : null,
    names: resolveCategory(chain, 'names'),
    photos: resolveCategory(chain, 'photos'),
  };
}

export function toStudentPolicy(r: ResolvedStudentPrivacy): StudentPolicy {
  if (!r.applies) return OPEN_STUDENT_POLICY;
  return { applies: true, names: r.names.allowed, photos: r.photos.allowed };
}

/** The database surface the loader needs (a PrismaClient or a transaction). */
export interface StudentPrivacyDb {
  tenant: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; name: true; vertical: true; parentId: true };
    }): Promise<{
      id: string;
      name: string | null;
      vertical: string | null;
      parentId: string | null;
    } | null>;
  };
  studentPrivacyPolicy: {
    findMany(args: {
      where: { tenantId: { in: string[] } };
    }): Promise<Array<Record<string, unknown>>>;
  };
}

/** Deepest chain walked. A district → school tree is two levels; five is headroom. */
const MAX_CHAIN_DEPTH = 5;

/**
 * The tenant and its ancestors, each with its own settings — the tenant first.
 * Throws when the tenant itself does not exist (callers fail closed).
 */
export async function loadPolicyChain(
  db: StudentPrivacyDb,
  tenantId: string,
): Promise<PolicyChainNode[]> {
  const chain: PolicyChainNode[] = [];
  const seen = new Set<string>();
  let id: string | null = tenantId;
  while (id && chain.length < MAX_CHAIN_DEPTH && !seen.has(id)) {
    seen.add(id);
    // ten-ok: an identity walk UP the caller's own tenant chain — `tenantId`
    // is the authenticated caller's tenant (settings) or the tenant that owns
    // the game being rendered (public board), and every further id is the
    // parentId of a row this loop already read. Tenant carries no tenantId
    // column; the row IS the tenant.
    const t = await db.tenant.findUnique({
      where: { id },
      select: { id: true, name: true, vertical: true, parentId: true },
    });
    if (!t) {
      if (chain.length === 0) throw new Error(`tenant ${tenantId} not found`);
      break;
    }
    chain.push({ tenantId: t.id, name: t.name, vertical: t.vertical });
    id = t.parentId;
  }
  const rows = await db.studentPrivacyPolicy.findMany({
    where: { tenantId: { in: chain.map((n) => n.tenantId) } },
  });
  const byTenant = new Map(rows.map((r) => [String(r.tenantId), r]));
  return chain.map((n) => {
    const r = byTenant.get(n.tenantId);
    if (!r) return n;
    return {
      ...n,
      servesMinors: typeof r.servesMinors === 'boolean' ? r.servesMinors : null,
      namesState: (r.namesState as string | null) ?? null,
      namesSetAt: (r.namesSetAt as Date | null) ?? null,
      namesSetByUserId: (r.namesSetByUserId as string | null) ?? null,
      namesAttestationVersion:
        (r.namesAttestationVersion as string | null) ?? null,
      photosState: (r.photosState as string | null) ?? null,
      photosSetAt: (r.photosSetAt as Date | null) ?? null,
      photosSetByUserId: (r.photosSetByUserId as string | null) ?? null,
      photosAttestationVersion:
        (r.photosAttestationVersion as string | null) ?? null,
    };
  });
}

/**
 * The policy a PUBLIC output applies for a tenant. Never throws: an unreadable
 * policy is a school that has confirmed nothing (fail closed).
 */
export async function loadStudentPolicy(
  db: StudentPrivacyDb,
  tenantId: string,
): Promise<StudentPolicy> {
  try {
    return toStudentPolicy(
      resolveStudentPrivacy(await loadPolicyChain(db, tenantId)),
    );
  } catch {
    return CLOSED_STUDENT_POLICY;
  }
}

/* ════════════════ one student ════════════════ */

/** The per-student flags as a roster row (optionally with its linked athlete) carries them. */
export interface StudentFlagsSource {
  directoryOptOut?: boolean | null;
  photoRelease?: boolean | null;
  person?: {
    directoryOptOut?: boolean | null;
    photoRelease?: boolean | null;
  } | null;
}

export interface StudentFlags {
  optOut: boolean;
  photoRelease: boolean;
}

/** Flags for a name the server cannot tie to any roster row. */
export const UNKNOWN_STUDENT: Readonly<StudentFlags> = Object.freeze({
  optOut: false,
  photoRelease: false,
});

/**
 * A roster row's effective flags. An opt-out recorded on the row OR on its
 * linked athlete wins. A linked student's photo release is the athlete's (it
 * follows the student into every game and is revoked in one place); an
 * unlinked row carries its own. An opted-out student never has a release.
 */
export function studentFlags(row: StudentFlagsSource): StudentFlags {
  const person = row.person ?? null;
  const optOut =
    row.directoryOptOut === true || person?.directoryOptOut === true;
  const photoRelease =
    !optOut &&
    (person ? person.photoRelease === true : row.photoRelease === true);
  return { optOut, photoRelease };
}

/**
 * The switches that apply to ONE student on a public output: the game's own
 * switches, made stricter by the school's policy and the student's flags.
 * Never looser than the game's switches.
 */
export function studentRosterPrivacy(
  flags: StudentFlags,
  policy: StudentPolicy,
  game: RosterPrivacy = DEFAULT_ROSTER_PRIVACY,
): RosterPrivacy {
  const nameOk = !flags.optOut && (!policy.applies || policy.names);
  const photoOk =
    !flags.optOut && (!policy.applies || (policy.photos && flags.photoRelease));
  return {
    names: nameOk ? game.names : 'hidden',
    photos: photoOk && game.photos,
    numbers: game.numbers,
    positions: game.positions,
    stats: game.stats,
  };
}

/** "Jordan Lee" → "Lee"; a single token stays as it is. */
export function lastNameOnly(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}

export function nameForMode(name: string, mode: RosterNameMode): string {
  if (mode === 'hidden') return '';
  if (mode === 'last') return lastNameOnly(name);
  return name;
}

type WithoutFlags<T> = Omit<T, 'directoryOptOut' | 'photoRelease' | 'person'>;

const FLAG_KEYS: ReadonlySet<string> = new Set([
  'directoryOptOut',
  'photoRelease',
  'person',
]);

function stripFlags<T extends object>(p: T): WithoutFlags<T> {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (!FLAG_KEYS.has(k)) rest[k] = v;
  return rest as WithoutFlags<T>;
}

interface RosterLike {
  name?: string | null;
  number?: string | null;
  position?: string | null;
  photoUrl?: string | null;
  stats?: unknown;
}

/**
 * One roster entry as a public output may show it. Never mutates the input;
 * the per-student flags never leave the server (a family's opt-out is itself
 * something the public should not learn).
 */
export function publicStudentView<T extends RosterLike & StudentFlagsSource>(
  p: T,
  policy: StudentPolicy,
  game: RosterPrivacy = DEFAULT_ROSTER_PRIVACY,
): WithoutFlags<T> {
  return stripFlags(
    redactRosterEntry(p, studentRosterPrivacy(studentFlags(p), policy, game)),
  );
}

/* ════════════════ names that are not roster rows ════════════════ */

/** Case-, space- and width-insensitive name key. */
export function nameKey(v: unknown): string {
  return typeof v === 'string'
    ? v.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
    : '';
}

const RELAY_TOKEN = /^(?:['"(]?[a-h]['")]?|relay|team|squad|[ivx]{1,3})$/i;

/**
 * Is a typed result name a TEAM label ("Lincoln", "Lincoln A", "Lincoln - B
 * Relay") rather than a student? Only an exact team name, optionally followed
 * by relay-letter / "relay" tokens, counts — "Lincoln Smith" is a student.
 */
export function isTeamLabel(
  name: string,
  teams: ReadonlyArray<string | null | undefined>,
): boolean {
  const n = nameKey(name);
  if (!n) return false;
  for (const t of teams) {
    const tn = nameKey(t);
    if (!tn) continue;
    if (n === tn) return true;
    if (!n.startsWith(`${tn} `)) continue;
    const rest = n.slice(tn.length + 1).replace(/^[-–—:·]\s*/, '');
    const tokens = rest.split(' ').filter(Boolean);
    if (
      tokens.length > 0 &&
      tokens.length <= 2 &&
      tokens.every((tok) => RELAY_TOKEN.test(tok))
    )
      return true;
  }
  return false;
}

/** A roster student as the joins see it. */
export interface DirectoryStudent {
  id: string | null;
  team: 'home' | 'away' | null;
  name: string;
  number: string | null;
  flags: StudentFlags;
}

type DirectoryRow = RosterLike &
  StudentFlagsSource & { id?: string | null; team?: string | null };

function sideOf(v: unknown): 'home' | 'away' | null {
  return v === 'home' || v === 'away' ? v : null;
}

/** Two rows claim the same key: the strictest reading of both. */
function mergeStudents(
  a: DirectoryStudent,
  b: DirectoryStudent,
): DirectoryStudent {
  return {
    ...a,
    flags: {
      optOut: a.flags.optOut || b.flags.optOut,
      photoRelease: a.flags.photoRelease && b.flags.photoRelease,
    },
  };
}

/**
 * The game's roster, indexed for the places a student's name arrives WITHOUT a
 * row id: typed meet results, the swim-feed lane join, foul and exclusion rows,
 * a spotlight, a celebration's scorer. Lookup order: row id, then side + jersey
 * number, then exact name.
 */
export class StudentDirectory {
  private readonly byId = new Map<string, DirectoryStudent>();
  private readonly byNumber = new Map<string, DirectoryStudent>();
  private readonly byName = new Map<string, DirectoryStudent>();

  constructor(rows: readonly DirectoryRow[] | null | undefined) {
    for (const r of rows ?? []) {
      if (!r || typeof r !== 'object') continue;
      const s: DirectoryStudent = {
        id: typeof r.id === 'string' ? r.id : null,
        team: sideOf(r.team),
        name: typeof r.name === 'string' ? r.name : '',
        number:
          typeof r.number === 'string' && r.number.trim()
            ? r.number.trim()
            : null,
        flags: studentFlags(r),
      };
      if (s.id) this.byId.set(s.id, s);
      if (s.team && s.number)
        this.put(this.byNumber, `${s.team}#${s.number.toLowerCase()}`, s);
      const key = nameKey(s.name);
      if (key) this.put(this.byName, key, s);
    }
  }

  private put(
    map: Map<string, DirectoryStudent>,
    key: string,
    s: DirectoryStudent,
  ) {
    const had = map.get(key);
    map.set(key, had ? mergeStudents(had, s) : s);
  }

  resolve(q: {
    id?: unknown;
    team?: unknown;
    number?: unknown;
    name?: unknown;
  }): DirectoryStudent | null {
    if (typeof q.id === 'string' && q.id) {
      const hit = this.byId.get(q.id);
      if (hit) return hit;
    }
    const team = sideOf(q.team);
    const number =
      typeof q.number === 'number'
        ? String(q.number)
        : typeof q.number === 'string'
          ? q.number.trim()
          : '';
    if (team && number) {
      const hit = this.byNumber.get(`${team}#${number.toLowerCase()}`);
      if (hit) return hit;
    }
    const key = nameKey(q.name);
    return key ? (this.byName.get(key) ?? null) : null;
  }
}

/** Everything a public output needs to decide what to show about a student. */
export interface PublicStudentContext {
  policy: StudentPolicy;
  /** The game's own switches (B2 — ./roster-privacy.ts). */
  game: RosterPrivacy;
  directory: StudentDirectory;
  /** The two team names — a result row that IS a team label is not a student. */
  teams: ReadonlyArray<string | null | undefined>;
}

/**
 * A student NAME that arrived as text. A row tied to a roster student gets that
 * student's switches; free text that is a team label passes; any other free
 * text is treated as a student we cannot check — hidden while the school has
 * not confirmed names, reduced by the game's switch otherwise.
 */
export function publicStudentName(
  raw: unknown,
  student: DirectoryStudent | null,
  ctx: PublicStudentContext,
): string {
  if (typeof raw !== 'string' || !raw.trim())
    return typeof raw === 'string' ? raw : '';
  if (student)
    return nameForMode(
      raw,
      studentRosterPrivacy(student.flags, ctx.policy, ctx.game).names,
    );
  if (isTeamLabel(raw, ctx.teams)) return raw;
  return nameForMode(
    raw,
    studentRosterPrivacy(UNKNOWN_STUDENT, ctx.policy, ctx.game).names,
  );
}

/**
 * A student PHOTO that arrived as a URL. Tied to a roster student: that
 * student's release decides. A photo nobody can tie to a student never shows
 * where the policy applies — there is no release to check.
 */
export function publicStudentPhoto(
  url: unknown,
  student: DirectoryStudent | null,
  ctx: PublicStudentContext,
): string | null {
  if (typeof url !== 'string' || !url) return null;
  return studentRosterPrivacy(
    student?.flags ?? UNKNOWN_STUDENT,
    ctx.policy,
    ctx.game,
  ).photos
    ? url
    : null;
}

/* ════════════════ the public board payload ════════════════ */

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * A cue as a public board may show it: the pre-game intro's lineup (one slot
 * per student, the B2 shape: '' rather than null) and a celebration's scorer
 * attribution ("SCORED BY #12 SMITH").
 */
export function publicCuePayload(payload: Obj, ctx: PublicStudentContext): Obj {
  let out: Obj | null = null;
  const put = (k: string, v: unknown) => {
    if (payload[k] === v) return;
    out ??= { ...payload };
    out[k] = v;
  };

  if (Array.isArray(payload.lineup)) {
    put(
      'lineup',
      (payload.lineup as unknown[]).map((raw) => {
        if (!isObj(raw)) return raw;
        const student = ctx.directory.resolve({
          id: raw.id,
          team: payload.team,
          number: raw.number,
          name: raw.name,
        });
        const eff = studentRosterPrivacy(
          student?.flags ?? UNKNOWN_STUDENT,
          ctx.policy,
          ctx.game,
        );
        const r = redactRosterEntry(raw as RosterLike, eff) as Obj;
        return {
          ...r,
          number: r.number ?? '',
          position: r.position ?? '',
          photoUrl: r.photoUrl ?? '',
        };
      }),
    );
  }

  const hasScorer =
    payload.scorerName != null ||
    payload.scorerPhotoUrl != null ||
    payload.scorerId != null;
  if (hasScorer) {
    const student = ctx.directory.resolve({
      id: payload.scorerId,
      team: payload.team,
      number: payload.scorerNumber,
      name: payload.scorerName,
    });
    const eff = studentRosterPrivacy(
      student?.flags ?? UNKNOWN_STUDENT,
      ctx.policy,
      ctx.game,
    );
    if (typeof payload.scorerName === 'string') {
      put(
        'scorerName',
        publicStudentName(payload.scorerName, student, ctx) || null,
      );
    }
    if (payload.scorerPhotoUrl != null)
      put(
        'scorerPhotoUrl',
        publicStudentPhoto(payload.scorerPhotoUrl, student, ctx),
      );
    if (payload.scorerNumber != null && !eff.numbers) put('scorerNumber', null);
  }
  return out ?? payload;
}

/**
 * The broadcast spotlight. A spotlight tapped from the roster carries the
 * player's name as its title: that student's switches decide the title and the
 * photo (a hidden name falls back to the jersey number). Anything else is the
 * operator's own words (a promo, "SENIOR NIGHT") — the text stays, and a photo
 * nobody can tie to a student with a release does not show where the policy
 * applies.
 */
export function publicSpotlight(
  spotlight: unknown,
  ctx: PublicStudentContext,
): unknown {
  if (!isObj(spotlight)) return spotlight;
  const title = typeof spotlight.title === 'string' ? spotlight.title : '';
  if (!title && spotlight.photoUrl == null) return spotlight;
  const student = ctx.directory.resolve({
    id: spotlight.playerId,
    name: title,
  });
  let out: Obj | null = null;
  const put = (k: string, v: unknown) => {
    if (spotlight[k] === v) return;
    out ??= { ...spotlight };
    out[k] = v;
  };
  if (student) {
    const eff = studentRosterPrivacy(student.flags, ctx.policy, ctx.game);
    let shown = nameForMode(title, eff.names);
    if (!shown)
      shown = eff.numbers && student.number ? `#${student.number}` : '';
    put('title', shown);
  }
  if (spotlight.photoUrl != null)
    put('photoUrl', publicStudentPhoto(spotlight.photoUrl, student, ctx));
  return out ?? spotlight;
}

/** Scalar stats whose value is an athlete's name (diving, cross country). */
export const STUDENT_NAME_STAT_KEYS: readonly string[] = [
  'currentDiver',
  'leadRunner',
];

function publicNamedRows(
  rows: unknown,
  ctx: PublicStudentContext,
  numberKey: 'jersey',
): unknown {
  if (!Array.isArray(rows)) return rows;
  let changed = false;
  const next = (rows as unknown[]).map((row) => {
    if (!isObj(row) || typeof row.name !== 'string') return row;
    const student = ctx.directory.resolve({
      team: row.team,
      number: row[numberKey],
      name: row.name,
    });
    const name = publicStudentName(row.name, student, ctx);
    if (name === row.name) return row;
    changed = true;
    return { ...row, name };
  });
  return changed ? next : rows;
}

function publicResults(results: unknown, ctx: PublicStudentContext): unknown {
  if (!Array.isArray(results)) return results;
  let changed = false;
  const next = (results as unknown[]).map((ev) => {
    if (!isObj(ev) || !Array.isArray(ev.entries)) return ev;
    let evChanged = false;
    const entries = (ev.entries as unknown[]).map((e) => {
      if (!isObj(e) || typeof e.name !== 'string') return e;
      const student = ctx.directory.resolve({ team: e.team, name: e.name });
      const name = publicStudentName(e.name, student, ctx);
      if (name === e.name) return e;
      evChanged = true;
      return { ...e, name };
    });
    if (!evChanged) return ev;
    changed = true;
    return { ...ev, entries };
  });
  return changed ? next : results;
}

/**
 * The game's stat blob as a public board may show it: typed meet results and
 * the swim-feed's lane→roster name join (`results`), foul and exclusion rows
 * (`playerFouls`, `playerExclusions`), and the scalar athlete-name stats.
 */
export function publicStats(
  stats: unknown,
  ctx: PublicStudentContext,
): unknown {
  if (!isObj(stats)) return stats;
  let out: Obj | null = null;
  const put = (k: string, v: unknown) => {
    if (stats[k] === v) return;
    out ??= { ...stats };
    out[k] = v;
  };
  if ('results' in stats) put('results', publicResults(stats.results, ctx));
  if ('playerFouls' in stats)
    put('playerFouls', publicNamedRows(stats.playerFouls, ctx, 'jersey'));
  if ('playerExclusions' in stats)
    put(
      'playerExclusions',
      publicNamedRows(stats.playerExclusions, ctx, 'jersey'),
    );
  for (const key of STUDENT_NAME_STAT_KEYS) {
    if (typeof stats[key] !== 'string') continue;
    const student = ctx.directory.resolve({ name: stats[key] });
    put(key, publicStudentName(stats[key], student, ctx));
  }
  return out ?? stats;
}

/** A live overlay (penalty / injury): a jersey number, under the game's numbers switch. */
export function publicLiveOverlayPayload(
  payload: unknown,
  ctx: PublicStudentContext,
): unknown {
  if (
    !isObj(payload) ||
    ctx.game.numbers ||
    typeof payload.jersey !== 'string' ||
    !payload.jersey
  )
    return payload;
  return { ...payload, jersey: '' };
}
