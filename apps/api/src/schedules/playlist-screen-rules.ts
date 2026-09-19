/**
 * One screen, one playlist: switch it on, switch it off, or take it out
 * (2026-09-19).
 *
 * Greg, asking why some power buttons on a playlist's Screens tab were faded:
 *   "we add the group when creating the playlist so that its easy to add them
 *    all at once but after its created its up to the user if the want to
 *    disable a screen from a playlist"
 *
 * THE PROBLEM. A publish to a screen GROUP is ONE Schedule row (screenGroupId
 * set, screenId null) covering every member. `PUT /schedules/:id/toggle` on it
 * flips the whole group, so the per-screen power and trash buttons were
 * disabled for those screens — dead controls with the reason hidden in a
 * tooltip. And for a screen with its OWN rules the button flipped exactly one
 * of them, so a playlist with a breakfast window and a dinner window on the
 * same screen read "off" while the other window kept playing.
 *
 * THE OPERATION is playlist-scoped — "screen S in playlist P" — and covers both:
 *   • every OWN rule of P on S is set (or deleted);
 *   • every GROUP rule of P covering S is SPLIT: replaced by one per-screen rule
 *     per member, identical except that S gets the requested state (or, for a
 *     remove, no rule at all).
 *
 * The split is LAZY on purpose. A group publish nobody has individually touched
 * stays a live group binding — a panel added to the group later still picks the
 * playlist up — and the "via <group>" label on the row is the honest indicator
 * of that. Exploding at publish time was rejected: five web doors plus API keys
 * mint group rules, `create()` returns ONE row whose `.id` callers read, and
 * pins landing on another playlist's group rule leave it "active" but shadowed.
 *
 * THE INVARIANT: pressing a button on screen S must not change what any OTHER
 * screen shows. A pin outranks a group rule (effective-schedule.ts), so a
 * member M that is currently showing ANOTHER playlist's pin — the documented
 * "screen override coexists with a group rule" state — would, after a naive
 * split, have two competing pins, and the newer startTime would win. So for
 * every other member each option (no new rule / an OFF rule / wake its parked
 * rule / an ON rule) is SIMULATED against that screen's own week with the real
 * `orderSchedulesForManifest` + `windowsCollide`, and the option that changes
 * nothing is taken — "goes dark" weighted far above "shows something else".
 *
 * PURE AND PRISMA-FREE, like effective-schedule.ts directly beside it.
 */

import { orderSchedulesForManifest } from '../screens/effective-schedule';
import { windowsCollide } from './schedule-window-overlap';

/** The Schedule columns this module reads and copies. */
export interface RuleRow {
  id: string;
  playlistId: string;
  screenId: string | null;
  screenGroupId: string | null;
  startTime: Date | string;
  endTime: Date | string | null;
  daysOfWeek: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  priority: number | null;
  mode: string | null;
  mutedOverride: boolean | null;
  isActive: boolean;
}

export type ScreenRuleAction =
  | { kind: 'set-active'; active: boolean }
  | { kind: 'remove' };

/** A per-screen rule to create — every content-bearing column of its parent. */
export interface NewScreenRule {
  playlistId: string;
  screenId: string;
  startTime: Date | string;
  endTime: Date | string | null;
  daysOfWeek: string | null;
  timeStart: string | null;
  timeEnd: string | null;
  priority: number;
  mode: string;
  mutedOverride: boolean | null;
  isActive: boolean;
}

export interface ScreenRulePlan {
  /** True when no rule of this playlist reaches the screen at all. */
  notInPlaylist: boolean;
  /** OWN rules whose isActive must change. */
  setActive: Array<{ id: string; isActive: boolean }>;
  /** OWN rules to delete (remove only). */
  deleteOwn: string[];
  /** GROUP rules to replace with per-screen rules. */
  splits: Array<{
    groupRuleId: string;
    screenGroupId: string;
    create: NewScreenRule[];
    /** Members given an INACTIVE rule because another playlist outranks them. */
    shadowedScreenIds: string[];
    /** Members skipped because their own rule already covers this window. */
    alreadyOwnScreenIds: string[];
    /** Members whose switched-off own rule was switched ON to keep their glass unchanged. */
    keptPlayingScreenIds: string[];
  }>;
}

const isReplace = (r: { mode?: string | null }) =>
  (r.mode ?? 'replace') !== 'append';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const toMin = (hhmm: string | null | undefined): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm || '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
const hhmm = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** An overnight window (22:00–06:00). `windowsCollide` does not model the wrap. */
const wraps = (r: RuleRow) => {
  const a = toMin(r.timeStart);
  const b = toMin(r.timeEnd);
  return a != null && b != null && a >= b;
};

/**
 * What ONE screen shows across a week, as a list of winning playlist ids — one
 * per interval in which the answer cannot change.
 *
 * Windows are half-open and every boundary is a rule's own timeStart/timeEnd,
 * so the winner is constant between consecutive boundaries: probing the first
 * minute of each interval, on each day, is EXACT rather than a sample. The
 * ranking is the manifest's own (`orderSchedulesForManifest`) and "is this
 * window open" is the server's own (`windowsCollide`) — nothing is re-derived.
 */
export function weekGlass(covering: RuleRow[]): string[] {
  const live = covering.filter((r) => r.isActive && isReplace(r));
  const cuts = new Set<number>([0]);
  for (const r of live) {
    for (const t of [toMin(r.timeStart), toMin(r.timeEnd)])
      if (t != null && t < 1440) cuts.add(t);
  }
  const out: string[] = [];
  for (const day of DAYS) {
    for (const c of Array.from(cuts).sort((x, y) => x - y)) {
      const probe = {
        daysOfWeek: day,
        timeStart: hhmm(c),
        timeEnd: hhmm(c + 1),
      };
      const open = live.filter((r) => windowsCollide(r, probe));
      out.push(
        open.length ? orderSchedulesForManifest(open)[0].playlistId : '',
      );
    }
  }
  return out;
}

/** How badly `after` departs from `before`. Going dark dwarfs a content change. */
export function glassHarm(before: string[], after: string[]): number {
  let harm = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    harm += before[i] !== '' && after[i] === '' ? 1000 : 1;
  }
  return harm;
}

export function planScreenRuleChange(opts: {
  /** Every rule of the playlist (own + group), any state. */
  rules: RuleRow[];
  screenId: string;
  /** The group the screen belongs to, or null. */
  screenGroupId: string | null;
  /** Member screen ids of that group (must include `screenId`). */
  groupMemberIds: string[];
  /** Other playlists' rules on those members / that group. */
  competitors: RuleRow[];
  action: ScreenRuleAction;
  /** Epoch ms. A rule that has already ENDED can never matter again. */
  now?: number;
}): ScreenRulePlan {
  const {
    rules,
    screenId,
    screenGroupId,
    groupMemberIds,
    competitors,
    action,
  } = opts;
  const now = opts.now ?? Date.now();

  const own = rules.filter((r) => r.screenId === screenId);
  const covering = screenGroupId
    ? rules.filter((r) => !r.screenId && r.screenGroupId === screenGroupId)
    : [];

  const plan: ScreenRulePlan = {
    notInPlaylist: own.length === 0 && covering.length === 0,
    setActive: [],
    deleteOwn: [],
    splits: [],
  };
  if (plan.notInPlaylist) return plan;

  if (action.kind === 'remove') {
    plan.deleteOwn = own.map((r) => r.id);
  } else {
    plan.setActive = own
      .filter((r) => r.isActive !== action.active)
      .map((r) => ({ id: r.id, isActive: action.active }));
  }

  const members = Array.from(new Set(groupMemberIds));
  for (const g of covering) {
    const create: NewScreenRule[] = [];
    const shadowedScreenIds: string[] = [];
    const alreadyOwnScreenIds: string[] = [];
    const keptPlayingScreenIds: string[] = [];

    const row = (
      m: string,
      isActive: boolean,
      startTime: Date | string = g.startTime,
    ): NewScreenRule => ({
      playlistId: g.playlistId,
      screenId: m,
      startTime,
      endTime: g.endTime ?? null,
      daysOfWeek: g.daysOfWeek ?? null,
      timeStart: g.timeStart ?? null,
      timeEnd: g.timeEnd ?? null,
      priority: g.priority ?? 0,
      mode: g.mode ?? 'replace',
      mutedOverride: g.mutedOverride ?? null,
      isActive,
    });

    for (const m of members) {
      const ownInWindow = rules.filter(
        (r) => r.screenId === m && windowsCollide(r, g),
      );

      if (m === screenId) {
        // The pressed screen. Its own rules were already set/deleted above; it
        // only needs a rule of its own for THIS window if it never had one.
        if (ownInWindow.length > 0) alreadyOwnScreenIds.push(m);
        else if (action.kind !== 'remove') create.push(row(m, action.active));
        continue;
      }

      // Everyone else: WHAT THEY SHOW MUST NOT CHANGE. Not decided by a rule of
      // thumb — the first cut said "outranked by another playlist's pin ⇒ create
      // it switched off", and a property test promptly showed a screen going
      // dark at breakfast because a rival pin overlapped only PART of the
      // window. So each option is SIMULATED on this screen's own week and the
      // one that changes nothing wins.
      const covers = (r: RuleRow) =>
        r.screenId === m ||
        (!r.screenId &&
          !!r.screenGroupId &&
          r.screenGroupId === g.screenGroupId);
      const notExpired = (r: RuleRow) =>
        !r.endTime || new Date(r.endTime).getTime() >= now;
      const world = [...rules, ...competitors].filter(
        (r) => covers(r) && notExpired(r),
      );
      const rest = world.filter((r) => r.id !== g.id);
      const pin = (isActive: boolean): RuleRow => ({
        ...g,
        id: `${g.id}→${m}`,
        screenId: m,
        screenGroupId: null,
        isActive,
      });
      const parked = ownInWindow.filter((r) => !r.isActive);
      const wake = parked.length ? orderSchedulesForManifest(parked)[0] : null;

      // A pin that is OLDER than this group rule beat it anyway (pin > group).
      // Turn the group rule into a pin and the two are ranked on recency, so
      // the newer one — this playlist — would take the overlap. Dating the new
      // rule one second behind the oldest such pin keeps the ranking exactly
      // as it was. Both dates are already in the past, so nothing about WHEN
      // the rule plays changes; startTime here is only the tie-break it already
      // is. (Priority is deliberately never touched: below zero it means
      // "fallback tier" and changes how displacement treats the rule.)
      const rivalPins = competitors.filter(
        (c) =>
          c.screenId === m &&
          c.isActive &&
          isReplace(c) &&
          notExpired(c) &&
          windowsCollide(c, g),
      );
      const behind = rivalPins.length
        ? new Date(
            Math.min(
              new Date(g.startTime).getTime(),
              ...rivalPins.map((c) => new Date(c.startTime).getTime() - 1000),
            ),
          )
        : null;

      type Option = {
        kind: 'none' | 'off' | 'wake' | 'on' | 'on-behind';
        after: RuleRow[];
      };
      // ORDER IS THE TIE-BREAK, and ties are common (an inactive rule never
      // changes the glass). Least machinery first: no new rule if the screen is
      // already listed through its own; an honest OFF rule before an ON rule
      // that would never actually win; waking a parked rule before duplicating it.
      const options: Option[] = [
        ...(rules.some((r) => r.screenId === m)
          ? [{ kind: 'none' as const, after: rest }]
          : []),
        { kind: 'off', after: [...rest, pin(false)] },
        ...(wake
          ? [
              {
                kind: 'wake' as const,
                after: rest.map((r) =>
                  r.id === wake.id ? { ...r, isActive: true } : r,
                ),
              },
            ]
          : []),
        { kind: 'on', after: [...rest, pin(true)] },
        ...(behind
          ? [
              {
                kind: 'on-behind' as const,
                after: [...rest, { ...pin(true), startTime: behind }],
              },
            ]
          : []),
      ];

      let choice: Option;
      if (world.some(wraps)) {
        // An overnight window is invisible to windowsCollide, so the simulation
        // would call it "never open" and could park a screen that is playing.
        // Fall back to the one answer that can never take a screen dark.
        choice = options.find((o) => o.kind === (g.isActive ? 'on' : 'off'))!;
      } else {
        const before = weekGlass(world);
        choice = options
          .map((o) => ({ o, harm: glassHarm(before, weekGlass(o.after)) }))
          .reduce((best, x) => (x.harm < best.harm ? x : best)).o;
      }

      if (choice.kind === 'none') alreadyOwnScreenIds.push(m);
      if (choice.kind === 'wake' && wake) {
        plan.setActive.push({ id: wake.id, isActive: true });
        keptPlayingScreenIds.push(m);
      }
      if (choice.kind === 'off') {
        if (g.isActive) shadowedScreenIds.push(m);
        create.push(row(m, false));
      }
      if (choice.kind === 'on') create.push(row(m, true));
      if (choice.kind === 'on-behind' && behind)
        create.push(row(m, true, behind));
    }

    plan.splits.push({
      groupRuleId: g.id,
      screenGroupId: g.screenGroupId as string,
      create,
      shadowedScreenIds,
      alreadyOwnScreenIds,
      keptPlayingScreenIds,
    });
  }

  return plan;
}
