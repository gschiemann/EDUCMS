/**
 * blast-radius — "exactly which screens will this hit?"
 *
 * Every publish surface in VenueOS (the 5-step create wizard, the playlist
 * detail "Publish to Screens" sheet, the HQ "Publish to locations" modal)
 * used to commit content to screens while telling the operator only how many
 * checkboxes they'd ticked. A group of 12 read as "1 selected". A group with
 * zero members read the same as a group with fifty. And a windowed schedule
 * with no days picked read as a normal schedule right up until it played on
 * nothing, forever.
 *
 * This module is the single, pure, testable answer to the question. It takes
 * whatever the surface already has loaded (screens + groups + the operator's
 * selection) and resolves it into a truthful reach: the real screen count,
 * the real screen names, per-group counts, and the honest warnings.
 *
 * PURE ON PURPOSE: no React, no DOM, no network. The three surfaces render it;
 * `src/lib/__tests__/blast-radius.test.ts` proves it.
 */

export interface BlastScreenRef {
  id: string;
  name?: string | null;
}

export interface BlastGroupRef {
  id: string;
  name?: string | null;
  /** Member rows as the API returns them (may carry names, may not). */
  screens?: Array<{ id?: string | null; name?: string | null } | null> | null;
}

export interface BlastRadiusGroup {
  id: string;
  name: string;
  /** Screens this publish reaches THROUGH this group (deduped fleet-wide). */
  screenCount: number;
  screenNames: string[];
  /** Explicitly picked by the operator (→ becomes a group-scoped schedule). */
  picked: boolean;
  /** The group holds no screens at all — publishing to it displays nothing. */
  empty: boolean;
}

export interface BlastRadius {
  /** Unique screens this publish reaches. The number the operator must see. */
  screenCount: number;
  /** Every reached screen name — group members first, then loose screens. */
  screenNames: string[];
  /** Groups (or, for the fleet path, locations) the publish touches. */
  groupCount: number;
  groups: BlastRadiusGroup[];
  /** Reached screens that no counted group claims (hand-picked / ungrouped). */
  ungroupedScreenNames: string[];
  /** Names of picked groups that hold zero screens. */
  emptyGroupNames: string[];
}

const UNTITLED_SCREEN = 'Untitled screen';
const UNTITLED_GROUP = 'Untitled group';

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export interface BlastRadiusInput {
  /** Every screen the surface knows about (the flat list it already fetched). */
  screens?: Array<BlastScreenRef | null | undefined> | null;
  /** Every group / location the surface knows about, with member rows. */
  groups?: Array<BlastGroupRef | null | undefined> | null;
  /** Screens the operator ticked individually. */
  selectedScreenIds?: Iterable<string> | null;
  /** Groups the operator ticked as a whole. */
  selectedGroupIds?: Iterable<string> | null;
  /**
   * `'picked'` (default) — only explicitly picked groups are tallied. This is
   * the wizard / detail-sheet meaning: a picked group becomes ONE group-scoped
   * schedule that fans out (and keeps fanning out to screens added later).
   *
   * `'containing'` — every group holding at least one reached screen is
   * tallied. This is the HQ fleet meaning: "groups" are locations, and the
   * operator only ever picks individual screens, so the locations are derived.
   */
  groupMode?: 'picked' | 'containing';
}

/**
 * Resolve a selection into the screens it actually reaches.
 *
 * Mirrors the publish paths' own fan-out rules: a picked group reaches every
 * member (so those members are attributed to the group, never double-counted
 * as loose screens — same `coveredScreenIds` logic the wizard uses when it
 * emits schedules), and an id selected but unknown to the loaded lists still
 * counts, because it is still going to be POSTed.
 */
export function computeBlastRadius(input: BlastRadiusInput): BlastRadius {
  const allScreens = (input.screens ?? []).filter(Boolean) as BlastScreenRef[];
  const allGroups = (input.groups ?? []).filter(Boolean) as BlastGroupRef[];
  const pickedScreenIds = new Set<string>(input.selectedScreenIds ?? []);
  const pickedGroupIds = new Set<string>(input.selectedGroupIds ?? []);
  const groupMode = input.groupMode ?? 'picked';

  // Name index. The flat screen list wins; group member rows top it up
  // (some payloads carry names on only one of the two).
  const nameById = new Map<string, string>();
  for (const s of allScreens) {
    if (s?.id) nameById.set(s.id, clean(s.name) || UNTITLED_SCREEN);
  }
  for (const g of allGroups) {
    for (const m of g.screens ?? []) {
      if (m?.id && !nameById.has(m.id)) nameById.set(m.id, clean(m.name) || UNTITLED_SCREEN);
    }
  }
  // An id we can't resolve is still real reach — show the id rather than lie.
  const nameOf = (id: string): string => nameById.get(id) ?? id;

  // 1. Every screen this publish reaches. Insertion order = group members
  //    first (in group order), then hand-picked screens.
  const reachedIds = new Set<string>();
  for (const g of allGroups) {
    if (!pickedGroupIds.has(g.id)) continue;
    for (const m of g.screens ?? []) if (m?.id) reachedIds.add(m.id);
  }
  for (const id of pickedScreenIds) reachedIds.add(id);

  // 2. Attribute reached screens to the groups that carry them. `claimed`
  //    guarantees sum(group counts) + ungrouped === screenCount, so the
  //    expanded breakdown always adds up to the headline number.
  const claimed = new Set<string>();
  const groups: BlastRadiusGroup[] = [];
  for (const g of allGroups) {
    const memberIds = (g.screens ?? [])
      .map((m) => m?.id)
      .filter((id): id is string => !!id);
    const picked = pickedGroupIds.has(g.id);
    const hits = memberIds.filter((id) => reachedIds.has(id) && !claimed.has(id));
    const include = groupMode === 'picked' ? picked : hits.length > 0;
    if (!include) continue;
    hits.forEach((id) => claimed.add(id));
    groups.push({
      id: g.id,
      name: clean(g.name) || UNTITLED_GROUP,
      screenCount: hits.length,
      screenNames: hits.map(nameOf),
      picked,
      empty: memberIds.length === 0,
    });
  }

  // 3. Whatever's left is reached directly.
  const ungroupedIds = Array.from(reachedIds).filter((id) => !claimed.has(id));
  const ungroupedScreenNames = ungroupedIds.map(nameOf);

  return {
    screenCount: reachedIds.size,
    screenNames: [...groups.flatMap((g) => g.screenNames), ...ungroupedScreenNames],
    groupCount: groups.length,
    groups,
    ungroupedScreenNames,
    emptyGroupNames: groups.filter((g) => g.empty).map((g) => g.name),
  };
}

const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * The one truthful line every publish confirmation shows before commit.
 *   "Publishes to 12 screens across 3 groups"
 *   "Publishes to 12 screens across 3 locations"   (groupNoun: 'location')
 *   "Publishes to 4 screens"                       (no groups involved)
 */
export function blastRadiusLine(
  radius: BlastRadius,
  opts?: { verb?: string; groupNoun?: string },
): string {
  const verb = opts?.verb ?? 'Publishes to';
  const groupNoun = opts?.groupNoun ?? 'group';
  const head = `${verb} ${plural(radius.screenCount, 'screen')}`;
  if (radius.groupCount === 0) return head;
  return `${head} across ${plural(radius.groupCount, groupNoun)}`;
}

export type ReachWarningKind = 'no-days' | 'empty-groups' | 'no-screens';

export interface ReachWarning {
  kind: ReachWarningKind;
  message: string;
  /** Blocking warnings must disable the commit button, not just colour it. */
  blocking: boolean;
}

export interface ReachScheduleInput {
  /** The operator chose a day/time window rather than always-on. */
  windowed?: boolean;
  /** Days picked for that window. */
  days?: string[] | null;
  /** How this surface labels its always-on option, for the escape-hatch copy. */
  alwaysLabel?: string;
}

/**
 * Honest warnings for a selection, most-severe first.
 *
 * `no-days` is BLOCKING: a windowed schedule with zero days picked is a
 * schedule that runs zero days — it is never what the operator meant, and it
 * used to sail through the wizard's Review step reading "No days picked"
 * beside a confident "Create Playlist" button (live-test finding P7).
 *
 * The other two are informational: publishing with no screens (or into an
 * empty group) is a legitimate stage-it-now choice, so the surface says so
 * plainly and renames its button rather than blocking the operator.
 */
export function reachWarnings(
  radius: BlastRadius,
  sched?: ReachScheduleInput,
): ReachWarning[] {
  const out: ReachWarning[] = [];

  if (sched?.windowed && (sched.days?.length ?? 0) === 0) {
    out.push({
      kind: 'no-days',
      blocking: true,
      message: `This will not appear on any screen — no days selected. Pick at least one day, or switch to ${sched.alwaysLabel ?? 'always-on'}.`,
    });
  }

  if (radius.emptyGroupNames.length > 0) {
    const names = radius.emptyGroupNames;
    out.push({
      kind: 'empty-groups',
      blocking: false,
      message:
        names.length === 1
          ? `${names[0]} has no screens — nothing will display there yet.`
          : `${names.join(', ')} have no screens — nothing will display there yet.`,
    });
  }

  if (radius.screenCount === 0) {
    out.push({
      kind: 'no-screens',
      blocking: false,
      message: 'This will not appear on any screen — no screens picked.',
    });
  }

  return out;
}

/** True when a warning must disable the commit button. */
export function isReachBlocked(warnings: ReachWarning[]): boolean {
  return warnings.some((w) => w.blocking);
}
