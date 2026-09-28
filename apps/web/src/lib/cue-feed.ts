/**
 * The celebration cue feed every public sports surface plays (the board, the
 * ribbon, the broadcast scorebug) — which newly polled cues to queue, and
 * which cues have been WITHDRAWN. One implementation: the three surfaces used
 * to carry three copies of the admission loop.
 *
 * Rules (unchanged unless named):
 *  - a cue is handled once (its id is remembered);
 *  - the surface's FIRST poll is history: recorded, never replayed;
 *  - a cue targeted at another surface is skipped (`playsHere`);
 *  - the automatic + named duplicate of one scoring moment (same key, a team
 *    that matches or is blank, within 6 s) plays once (2026-06-05) — EXCEPT,
 *    K12-F36, a named cue that says it REPLACES an automatic one: the engine
 *    decided it is that play's celebration, so it always plays;
 *  - K12-F36 — `cueCancels` (a cue an undo withdrew, or a named cue replaced)
 *    come back as `cancelled` ids: the surface drops them from its queue and
 *    cuts the one playing. A cue cancelled in the same poll it arrives in is
 *    never queued at all.
 *
 * Pure (no React, no DOM, no clock of its own) — unit-tested in
 * lib/__tests__/cue-feed.test.ts.
 */

export interface FeedCue {
  id: string;
  key?: string;
  team?: string | null;
  target?: string;
  /** K12-F36 — the automatic cue this named cue replaces. */
  replaces?: unknown;
}

export interface CueCancelRow {
  id: string;
  cancels: string;
}

export interface CueFeedState {
  /** Cue and cancellation ids already handled. */
  seen: Set<string>;
  /** The last queued cue's signature (the same-moment coalesce). */
  last: { key: string; team: string; t: number };
}

export function newCueFeedState(): CueFeedState {
  return { seen: new Set(), last: { key: '', team: '', t: 0 } };
}

/** How long two cues of one key count as one scoring moment. */
export const SAME_MOMENT_MS = 6_000;

/**
 * Admit one poll's feed. Returns the cues to queue (feed order) and the ids of
 * cues withdrawn since the last poll.
 */
export function admitCues<C extends FeedCue>(
  state: CueFeedState,
  payload: { cues?: C[] | null; cueCancels?: CueCancelRow[] | null },
  opts: { first: boolean; playsHere: (target?: string) => boolean; now: number },
): { queue: C[]; cancelled: string[] } {
  const cancelled: string[] = [];
  for (const x of Array.isArray(payload.cueCancels) ? payload.cueCancels : []) {
    if (!x || typeof x.id !== 'string' || typeof x.cancels !== 'string') continue;
    if (state.seen.has(x.id)) continue;
    state.seen.add(x.id);
    if (!opts.first) cancelled.push(x.cancels);
  }
  // Every cancellation this poll carries — a first poll's too: a cue it
  // cancelled must not be replayed as history either (history is never
  // replayed anyway; this keeps the rule obvious).
  const withdrawn = new Set(
    (Array.isArray(payload.cueCancels) ? payload.cueCancels : []).map((x) => x?.cancels).filter(Boolean),
  );

  const queue: C[] = [];
  for (const c of Array.isArray(payload.cues) ? payload.cues : []) {
    if (!c || typeof c.id !== 'string' || state.seen.has(c.id)) continue;
    state.seen.add(c.id);
    if (opts.first || !opts.playsHere(c.target) || withdrawn.has(c.id)) continue;
    const key = String(c.key || '');
    const team = String(c.team || '');
    const l = state.last;
    const sameMoment =
      !c.replaces &&
      key !== '' &&
      l.key === key &&
      (!l.team || !team || l.team === team) &&
      opts.now - l.t < SAME_MOMENT_MS;
    if (sameMoment) continue;
    state.last = { key, team, t: opts.now };
    queue.push(c);
  }
  return { queue, cancelled };
}
