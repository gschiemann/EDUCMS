/**
 * Per-game offline op queue — sports Trust wave Domain C (2026-08-06).
 *
 * The scorer's-table console must never silently lie. Before this module,
 * a control write that failed offline left the optimistic score in the
 * React Query cache with no error shown (tablet reads 21-14, board reads
 * 14-14), and an 11s Wi-Fi blip permanently ate every tap made during it
 * (apiFetch's network retries run 1/3/7s, then the mutation just dies).
 * This queue is what makes keeping the optimistic value HONEST: a
 * network-failed op is captured here and WILL be applied on reconnect.
 *
 * Pure logic, framework-free (no React / no network / no timers) so the
 * coalescing + persistence + replay rules are unit-testable without
 * mounting the 8.3k-line console page. The DOM/network wiring (replay
 * triggers, sender) lives with `useGameControl` in hooks/use-api.ts; the
 * banner UI reads `getSnapshot()`/`subscribe()` via useSyncExternalStore.
 *
 * Coalescing mirrors the server's write semantics:
 *  - score  — a DELTA endpoint (atomic increment server-side), so entries
 *             append; consecutive same-team deltas merge into one summed
 *             delta. Absolute sets (typo-fix, no `delta`) never merge.
 *  - clock / segment — absolute latest-wins server-side, so only the
 *             latest queued entry per kind survives.
 *  - stats  — server shallow-merges `dto.stats` into Game.stats, so the
 *             latest entry survives but folds the superseded entry's
 *             un-sent keys in (dropping them outright would silently lose
 *             e.g. a queued homeFouls bump when a later currentEvent edit
 *             replaced the entry — the exact silent-loss class this wave
 *             kills).
 */

export type GameOpKind = 'score' | 'clock' | 'segment' | 'stats';

export interface GameOp {
  opId: string;
  kind: GameOpKind;
  payload: Record<string, unknown>;
  createdAt: number;
}

export interface GameOpQueueSnapshot {
  ops: readonly GameOp[];
  /** True while replay() is walking the queue (banner: SYNCING). */
  replaying: boolean;
  /** Set when a replay empties the queue with ≥1 op sent (banner: SYNCED). */
  lastDrainAt: number | null;
  /** Set when the server 4xx-rejected a write (banner: REJECTED);
   *  cleared by clearRejection() when the operator dismisses. */
  lastRejectionAt: number | null;
}

export type GameOpSender = (op: GameOp) => Promise<unknown>;

/** Injectable storage surface (sessionStorage-shaped) for tests. */
export interface GameOpStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const OP_KINDS: readonly GameOpKind[] = ['score', 'clock', 'segment', 'stats'];

// Local id generator — timestamp + counter. Deliberately NOT
// crypto.randomUUID (Chromium-92+; the fleet floor for shared player code
// is Chromium 83, and uniqueness only needs to hold within one tab).
let opCounter = 0;
function nextOpId(): string {
  opCounter += 1;
  return `op${Date.now().toString(36)}-${opCounter.toString(36)}`;
}

/** sessionStorage, guarded — access itself can throw (privacy mode,
 *  sandboxed iframe). Absent storage degrades to in-memory-only. */
function defaultStorage(): GameOpStorage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isGameOp(v: unknown): v is GameOp {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.opId === 'string' &&
    OP_KINDS.includes(o.kind as GameOpKind) &&
    !!o.payload &&
    typeof o.payload === 'object' &&
    typeof o.createdAt === 'number'
  );
}

/** Same team normalization as the optimistic score path in use-api.ts
 *  (anything that isn't 'away' increments home). */
function teamOf(payload: Record<string, unknown>): 'home' | 'away' {
  return payload.team === 'away' ? 'away' : 'home';
}

export class GameOpQueue {
  /** Age past which a queued ABSOLUTE op (clock/segment/stats) is discarded
   *  at replay instead of sent — see the C3b note inside replay(). */
  static readonly MAX_ABSOLUTE_OP_AGE_MS = 10 * 60_000;

  private state: GameOpQueueSnapshot;
  private listeners = new Set<() => void>();
  /** Head op currently being sent by replay(). enqueue() must never merge
   *  INTO it — mutating an entry mid-send would double-count the delta. */
  private inFlightOpId: string | null = null;
  private readonly storageKey: string;
  private readonly storage: GameOpStorage | null;

  constructor(gameId: string, storage?: GameOpStorage | null) {
    this.storageKey = `venueos.gameops.${gameId}`;
    this.storage = storage !== undefined ? storage : defaultStorage();
    this.state = {
      ops: this.load(),
      replaying: false,
      lastDrainAt: null,
      lastRejectionAt: null,
    };
  }

  size(): number {
    return this.state.ops.length;
  }

  peekAll(): readonly GameOp[] {
    return this.state.ops;
  }

  /** Stable-reference snapshot for useSyncExternalStore. */
  getSnapshot(): GameOpQueueSnapshot {
    return this.state;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  noteRejection(): void {
    this.setState({ lastRejectionAt: Date.now() });
  }

  clearRejection(): void {
    if (this.state.lastRejectionAt !== null) this.setState({ lastRejectionAt: null });
  }

  /**
   * Refuter fix C3a (2026-08-09) — drop every queued entry of an ABSOLUTE
   * kind (clock / segment / stats: latest-wins server-side). Called when a
   * DIRECT mutation of that kind succeeds: the server now holds a newer
   * value than anything queued, so replaying an older queued entry of the
   * same kind would REVERT the server. Score deltas are commutative
   * increments and must never be dropped this way. Returns the drop count.
   */
  dropKind(kind: Exclude<GameOpKind, 'score'>): number {
    const before = this.state.ops.length;
    const ops = this.state.ops.filter((o) => o.kind !== kind);
    if (ops.length === before) return 0;
    this.setState({ ops });
    this.persist();
    return before - ops.length;
  }

  /**
   * Refuter fix C4 (2026-08-09) — synchronous read of the pending queued
   * SCORE deltas per team. useGame's display overlay applies these on top
   * of server truth so a background refetch (which necessarily EXCLUDES
   * queued taps) never makes the operator's displayed score visibly drop
   * below what they entered. Absolute score sets (typo-fix, no `delta`)
   * are not deltas and are excluded.
   */
  pendingScoreDeltas(): { home: number; away: number } {
    let home = 0;
    let away = 0;
    for (const op of this.state.ops) {
      if (op.kind !== 'score') continue;
      const delta = op.payload.delta;
      if (typeof delta !== 'number') continue;
      if (teamOf(op.payload) === 'away') away += delta;
      else home += delta;
    }
    return { home, away };
  }

  enqueue(kind: GameOpKind, payload: Record<string, unknown>): GameOp {
    const ops = this.state.ops.slice();

    if (kind === 'score') {
      const last = ops.length > 0 ? ops[ops.length - 1] : undefined;
      const delta = payload.delta;
      const canMerge =
        !!last &&
        last.kind === 'score' &&
        last.opId !== this.inFlightOpId &&
        typeof delta === 'number' &&
        typeof last.payload.delta === 'number' &&
        teamOf(last.payload) === teamOf(payload);
      if (canMerge && last) {
        // Summed delta may reach 0 (+1 then −1) — keep the entry anyway; a
        // 0-delta replays as a server no-op and the invariants stay simple.
        const merged: GameOp = {
          ...last,
          payload: { ...last.payload, delta: (last.payload.delta as number) + (delta as number) },
        };
        ops[ops.length - 1] = merged;
        this.setState({ ops });
        this.persist();
        return merged;
      }
      const entry: GameOp = { opId: nextOpId(), kind, payload, createdAt: Date.now() };
      ops.push(entry);
      this.setState({ ops });
      this.persist();
      return entry;
    }

    // clock / segment / stats — latest-wins: at most one queued entry per
    // kind, appended at the tail (replay order = enqueue order). Removing
    // the in-flight head here is safe: replay drops by opId (idempotent
    // no-op after success) and on failure the newer entry is authoritative.
    const idx = ops.findIndex((o) => o.kind === kind);
    let nextPayload = payload;
    if (idx !== -1) {
      if (kind === 'stats') {
        const oldStats = ops[idx].payload.stats;
        const newStats = payload.stats;
        nextPayload = {
          stats: {
            ...(oldStats && typeof oldStats === 'object' ? (oldStats as Record<string, unknown>) : {}),
            ...(newStats && typeof newStats === 'object' ? (newStats as Record<string, unknown>) : {}),
          },
        };
      }
      ops.splice(idx, 1);
    }
    const entry: GameOp = { opId: nextOpId(), kind, payload: nextPayload, createdAt: Date.now() };
    ops.push(entry);
    this.setState({ ops });
    this.persist();
    return entry;
  }

  /**
   * Serial, in-order replay of the ops present WHEN THIS PASS STARTS. Each
   * success drops its entry; the first failure stops the walk (entry stays
   * queued — retry later). Ops enqueued mid-replay are intentionally left
   * for the next trigger: this bounds each pass under sustained tapping and
   * keeps the in-flight head un-mergeable (no double-count). Re-entrant
   * calls while a replay is in flight are no-ops (double-send guard for the
   * multi-mount console page).
   */
  async replay(sender: GameOpSender): Promise<{ sent: number; remaining: number }> {
    if (this.state.replaying) return { sent: 0, remaining: this.state.ops.length };
    this.setState({ replaying: true });
    let sent = 0;
    // Snapshot the planned op ids up front; a mid-replay enqueue (a tap that
    // failed while this pass is walking) is handled by the next trigger, not
    // dragged into this pass.
    const plannedIds = this.state.ops.map((o) => o.opId);
    try {
      for (const opId of plannedIds) {
        // Look the op up live each iteration — a latest-wins enqueue during
        // an earlier await may have superseded (removed) this entry, in
        // which case skip it (its replacement replays on the next trigger).
        const op = this.state.ops.find((o) => o.opId === opId);
        if (!op) continue;
        // Refuter fix C3b (2026-08-09) — an ABSOLUTE op (clock / segment /
        // stats: latest-wins server-side) that sat queued past 10 minutes
        // is discarded, never replayed: by then the live game has almost
        // certainly moved past it (co-operator, feed ingest, direct writes
        // from a recovered tab) and replaying it would REVERT the server
        // to a stale value. Score DELTAS are never age-discarded — they
        // are commutative increments the operator genuinely made.
        if (
          op.kind !== 'score' &&
          Date.now() - op.createdAt > GameOpQueue.MAX_ABSOLUTE_OP_AGE_MS
        ) {
          this.setState({ ops: this.state.ops.filter((o) => o.opId !== opId) });
          this.persist();
          continue;
        }
        this.inFlightOpId = opId;
        try {
          await sender(op);
        } catch {
          break;
        }
        sent += 1;
        // Drop by opId, not position — enqueues during the await may have
        // reshuffled the tail (latest-wins removal / appends).
        this.setState({ ops: this.state.ops.filter((o) => o.opId !== opId) });
        this.persist();
      }
    } finally {
      this.inFlightOpId = null;
      const drained = sent > 0 && this.state.ops.length === 0;
      this.setState(
        drained ? { replaying: false, lastDrainAt: Date.now() } : { replaying: false },
      );
    }
    return { sent, remaining: this.state.ops.length };
  }

  private load(): GameOp[] {
    if (!this.storage) return [];
    try {
      const raw = this.storage.getItem(this.storageKey);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isGameOp);
    } catch {
      // Corrupt JSON / storage denial — never throw, start empty.
      return [];
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      if (this.state.ops.length === 0) this.storage.removeItem(this.storageKey);
      else this.storage.setItem(this.storageKey, JSON.stringify(this.state.ops));
    } catch {
      // Quota / denied — queue keeps working in-memory for this tab.
    }
  }

  private setState(patch: Partial<GameOpQueueSnapshot>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch {
        // A listener error must never break the queue.
      }
    });
  }
}

// ── Per-game registry ────────────────────────────────────────────
// useGameControl (enqueue + replay wiring) and ConnectionBanner (display)
// must observe the SAME instance, so instances are process-wide per game.

const registry = new Map<string, GameOpQueue>();

export function getGameOpQueue(gameId: string): GameOpQueue {
  let q = registry.get(gameId);
  if (!q) {
    q = new GameOpQueue(gameId);
    registry.set(gameId, q);
  }
  return q;
}

/** Test-only reset (parallels api-client's __resetSessionLogoutFired). */
export function __resetGameOpQueues(): void {
  registry.clear();
}

/**
 * Failure classifier for the enqueue decision. TRUE only when the request
 * provably got NO response: fetch threw its network TypeError, apiFetch
 * exhausted its network retries and threw its "Can't reach the server…"
 * wrapper (api-client.ts — that path is only reached via fetch TypeErrors),
 * or the browser says it's offline for an otherwise-unclassifiable error.
 *
 * ORDER IS LOAD-BEARING (refuter fix C2, 2026-08-09): an error carrying an
 * HTTP `status` means the server DID respond, and is checked FIRST —
 * before `navigator.onLine`. A 5xx that arrives just as the radio drops
 * used to hit the onLine===false short-circuit and get enqueued, replaying
 * a write the server may have already processed (double-send). Any
 * response disqualifies; onLine is only a supporting signal for
 * status-less failures (see the replay-safety tradeoff comment in
 * useGameControl).
 */
export function isNetworkFailure(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number') return false; // server responded — never enqueue
  if (err instanceof TypeError) return true;
  if (err instanceof Error && err.message.startsWith("Can't reach the server")) return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  return false;
}
