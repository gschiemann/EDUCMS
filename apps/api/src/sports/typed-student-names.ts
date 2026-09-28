/**
 * Student names TYPED into templates, on real screens (K-12 sports launch
 * follow-up, lane B4, 2026-09-27).
 *
 * The student-privacy gate (./student-privacy.ts, lane B3) decides what a
 * public output may show about a rostered student. It covered every name that
 * reaches a screen from the roster, the console or a feed — and none that an
 * operator TYPED into a template: a relay leg's swimmer, a CTS announcement
 * line, a player card, a lineup, a celebration's scorer. Those rode the zone
 * config straight to the glass.
 *
 * This module closes that path with the SAME decision, not a second one:
 *   • WHO is hidden is B3's rule, unchanged — `studentRosterPrivacy(flags,
 *     policy)` says 'hidden' when the school has not confirmed its
 *     directory-information policy (default deny), when anyone up the chain
 *     chose HIDE, or when the family opted out (in every vertical);
 *   • WHERE a typed name can live is the shared list in @cms/api-types
 *     (student-name-fields.ts) — the same list the builder warns on;
 *   • a typed value is blanked when it IS a hidden student's full or last name
 *     (a free-text line also when it carries a hidden full name as words).
 *
 * The roster never leaves the server: outputs receive only the blanked config.
 *
 * FAIL CLOSED: a policy that cannot be read is B3's CLOSED policy; a roster
 * that cannot be read blanks EVERY typed-name field (we cannot tell which are
 * students). A database blip may hide a name for a moment; it may never show
 * one.
 *
 * Cost: nothing at all for an output with no typed-name values (checked
 * first, no query). Otherwise one policy read + one roster read per TENANT,
 * cached until any write to a roster, an athlete or a privacy policy (they
 * bump the manifest content revision — screens/manifest-hot-cache.ts) or five
 * minutes, whichever comes first.
 */
import {
  hasTypedStudentNames,
  normalizeTypedName,
  redactStudentNameFields,
  type StudentNameMatcher,
} from '@cms/api-types';
import { currentManifestContentRev } from '../screens/manifest-hot-cache';
import {
  CLOSED_STUDENT_POLICY,
  lastNameOnly,
  loadStudentPolicy,
  studentFlags,
  studentRosterPrivacy,
  type StudentFlagsSource,
  type StudentPolicy,
  type StudentPrivacyDb,
} from './student-privacy';

/** One rostered student as the matcher sees them. */
export interface TypedNameStudent extends StudentFlagsSource {
  /** Full name as rostered ("Jordan Lee"). */
  name: string;
  /** An athlete record's own last name, when it has one. */
  lastName?: string | null;
}

/** Hides every non-empty value: the answer when the roster cannot be read. */
export const HIDE_ALL_TYPED_NAMES: StudentNameMatcher = Object.freeze({
  name: (v: string) => v.trim() !== '',
  text: (v: string) => v.trim() !== '',
});

/**
 * The matcher for a tenant's hidden students, or null when nobody is hidden
 * (the school confirmed names and no family opted out — nothing to blank).
 */
export function buildTypedNameMatcher(
  policy: StudentPolicy,
  students: readonly TypedNameStudent[],
): StudentNameMatcher | null {
  const full = new Set<string>();
  const last = new Set<string>();
  for (const s of students) {
    if (!s || typeof s.name !== 'string') continue;
    if (studentRosterPrivacy(studentFlags(s), policy).names !== 'hidden')
      continue;
    const f = normalizeTypedName(s.name);
    if (!f) continue;
    full.add(f);
    const l = normalizeTypedName(
      typeof s.lastName === 'string' && s.lastName.trim()
        ? s.lastName
        : lastNameOnly(s.name),
    );
    if (l) last.add(l);
  }
  if (full.size === 0) return null;
  // Whole-word phrases for free text: only names of two words or more — a
  // lone surname inside a sentence ("LINCOLN AT HOME FRIDAY") is a school as
  // often as a student.
  const phrases = Array.from(full).filter((f) => f.includes(' '));
  const name = (v: string): boolean => {
    const n = normalizeTypedName(v);
    return !!n && (full.has(n) || last.has(n));
  };
  return {
    name,
    text: (v: string): boolean => {
      if (name(v)) return true;
      const padded = ` ${normalizeTypedName(v)} `;
      return phrases.some((p) => padded.includes(` ${p} `));
    },
  };
}

/** The database surface the loader needs (a PrismaClient or a transaction). */
export interface TypedNamesDb extends StudentPrivacyDb {
  rosterPlayer: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<
      Array<{
        name: string;
        directoryOptOut?: boolean | null;
        photoRelease?: boolean | null;
        person?: {
          directoryOptOut?: boolean | null;
          photoRelease?: boolean | null;
          lastName?: string | null;
        } | null;
      }>
    >;
  };
  sportsPerson: {
    findMany(args: {
      where: Record<string, unknown>;
      select: Record<string, unknown>;
    }): Promise<
      Array<{
        id: string;
        fullName: string;
        lastName?: string | null;
        directoryOptOut?: boolean | null;
        photoRelease?: boolean | null;
      }>
    >;
  };
}

/** Load the tenant's hidden students and build the matcher (fail closed). */
export async function loadTypedNameMatcher(
  db: TypedNamesDb,
  tenantId: string,
): Promise<StudentNameMatcher | null> {
  let policy: StudentPolicy;
  try {
    policy = await loadStudentPolicy(db, tenantId);
  } catch {
    policy = CLOSED_STUDENT_POLICY;
  }
  // Names allowed by the school (or a venue the policy does not apply to) →
  // only a family's opt-out can hide someone, so only opted-out students are
  // read. Names hidden → every student of the tenant.
  const onlyOptedOut = !policy.applies || policy.names;
  try {
    // ten-ok: both reads are scoped to `tenantId` — the tenant whose screen,
    // game or export is being built (the caller's own scope).
    const persons = await db.sportsPerson.findMany({
      where: onlyOptedOut ? { tenantId, directoryOptOut: true } : { tenantId },
      select: {
        id: true,
        fullName: true,
        lastName: true,
        directoryOptOut: true,
        photoRelease: true,
      },
    });
    // A roster row inherits its athlete's opt-out (B3: opt-out from either
    // wins) — so with only opt-outs wanted, the rows linked to an opted-out
    // athlete are read too, not just the rows flagged themselves.
    const optedOutPersonIds = persons
      .filter((p) => p.directoryOptOut === true)
      .map((p) => p.id);
    const rows = await db.rosterPlayer.findMany({
      where: onlyOptedOut
        ? {
            tenantId,
            OR: [
              { directoryOptOut: true },
              ...(optedOutPersonIds.length
                ? [{ personId: { in: optedOutPersonIds } }]
                : []),
            ],
          }
        : { tenantId },
      select: {
        name: true,
        directoryOptOut: true,
        photoRelease: true,
        person: {
          select: { directoryOptOut: true, photoRelease: true, lastName: true },
        },
      },
    });
    const students: TypedNameStudent[] = [
      ...rows.map((r) => ({
        name: r.name,
        lastName: r.person?.lastName ?? null,
        directoryOptOut: r.directoryOptOut ?? false,
        photoRelease: r.photoRelease ?? false,
        person: r.person
          ? {
              directoryOptOut: r.person.directoryOptOut ?? false,
              photoRelease: r.person.photoRelease ?? false,
            }
          : null,
      })),
      ...persons.map((p) => ({
        name: p.fullName,
        lastName: p.lastName ?? null,
        directoryOptOut: p.directoryOptOut ?? false,
        photoRelease: p.photoRelease ?? false,
      })),
    ];
    return buildTypedNameMatcher(policy, students);
  } catch {
    return HIDE_ALL_TYPED_NAMES;
  }
}

/** How long a tenant's matcher is reused at most (writes invalidate sooner). */
export const TYPED_NAME_MATCHER_TTL_MS = 5 * 60_000;

interface CachedMatcher {
  matcher: StudentNameMatcher | null;
  at: number;
  rev: number;
}

const matcherCache = new Map<string, CachedMatcher>();
const inflight = new Map<string, Promise<StudentNameMatcher | null>>();

/**
 * The tenant's matcher, shared by every screen of the tenant: one load per
 * content revision (a roster / athlete / policy write bumps it) and at most
 * five minutes. Concurrent callers share one load.
 */
export async function typedNameMatcherFor(
  db: TypedNamesDb,
  tenantId: string,
  now: number = Date.now(),
): Promise<StudentNameMatcher | null> {
  const rev = currentManifestContentRev();
  const hit = matcherCache.get(tenantId);
  if (hit && hit.rev === rev && now - hit.at < TYPED_NAME_MATCHER_TTL_MS)
    return hit.matcher;
  const key = `${tenantId}@${rev}`;
  let p = inflight.get(key);
  if (!p) {
    p = loadTypedNameMatcher(db, tenantId).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  const matcher = await p;
  // A HIDE_ALL answer (the roster read failed) is never cached: the next
  // output retries the read instead of blanking for five minutes.
  if (matcher !== HIDE_ALL_TYPED_NAMES) {
    matcherCache.set(tenantId, { matcher, at: now, rev });
    if (matcherCache.size > 5_000) {
      const oldest = matcherCache.keys().next().value as string | undefined;
      if (oldest) matcherCache.delete(oldest);
    }
  }
  return matcher;
}

/** Test hook. */
export function clearTypedNameMatcherCache(): void {
  matcherCache.clear();
  inflight.clear();
}

/** A zone as the outputs carry it (config already parsed). */
export interface TypedNameZone {
  widgetType?: string | null;
  defaultConfig?: unknown;
}

/** Does any zone carry a value in a typed-student-name field? (no query) */
export function zonesHaveTypedNames(
  zones: ReadonlyArray<TypedNameZone> | null | undefined,
): boolean {
  // (`Array.isArray` narrows to any[] — keep the element type.)
  if (!Array.isArray(zones)) return false;
  return (zones as ReadonlyArray<TypedNameZone>).some(
    (z) => !!z && hasTypedStudentNames(z.widgetType ?? null, z.defaultConfig),
  );
}

/**
 * The zones with every typed name the matcher hides blanked. Returns the SAME
 * array when nothing changed; never mutates a zone.
 */
export function redactZones<Z extends TypedNameZone>(
  zones: Z[],
  matcher: StudentNameMatcher | null,
): Z[] {
  if (!matcher || !Array.isArray(zones)) return zones;
  let changed = false;
  const out = zones.map((z) => {
    if (!z) return z;
    const r = redactStudentNameFields(
      z.widgetType ?? null,
      z.defaultConfig,
      matcher,
    );
    if (r.config === z.defaultConfig) return z;
    changed = true;
    return { ...z, defaultConfig: r.config };
  });
  return changed ? out : zones;
}

/**
 * Blank the typed student names in a set of templates for one tenant — the
 * one call every real-screen output makes. Returns the templates in the same
 * order: a template with nothing hidden is returned AS IS, one with a blanked
 * name is a copy (a template object is never mutated — a cached or shared one
 * must never lose the operator's own words). Loads nothing when no zone
 * carries a typed name.
 */
export async function redactTypedStudentNames<
  T extends { zones?: TypedNameZone[] | null },
>(
  db: TypedNamesDb,
  tenantId: string | null | undefined,
  templates: ReadonlyArray<T | null | undefined>,
): Promise<Array<T | null | undefined>> {
  if (!templates.some((t) => !!t && zonesHaveTypedNames(t.zones)))
    return [...templates];
  // No tenant to ask → nothing to match against: fail closed.
  const matcher = tenantId
    ? await typedNameMatcherFor(db, tenantId)
    : HIDE_ALL_TYPED_NAMES;
  return templates.map((t) => {
    if (!t || !matcher || !Array.isArray(t.zones)) return t;
    const zones = redactZones(t.zones, matcher);
    return zones === t.zones ? t : { ...t, zones };
  });
}
