/**
 * GameOpQueue — sports Trust wave Domain C (2026-08-06). Proves the pure
 * queue rules without mounting the console page: coalescing (score deltas
 * merge, clock/segment/stats latest-wins), replay order + stop-on-failure
 * + resume, sessionStorage round-trip incl. corrupt JSON, and the
 * network-vs-server failure classifier that decides enqueue-vs-refetch.
 */
import {
  GameOpQueue,
  getGameOpQueue,
  isNetworkFailure,
  __resetGameOpQueues,
  type GameOp,
  type GameOpStorage,
} from '../game-op-queue';

const GAME_ID = 'game-q-1';

function memStorage(initial: Record<string, string> = {}): GameOpStorage & { dump(): Map<string, string> } {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
    dump: () => m,
  };
}

beforeEach(() => {
  window.sessionStorage.clear();
  __resetGameOpQueues();
});

describe('coalescing rules', () => {
  it('merges consecutive same-team score deltas into one summed delta', () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('score', { team: 'home', delta: 1 });
    q.enqueue('score', { team: 'home', delta: 1 });
    q.enqueue('score', { team: 'home', delta: 3 });
    expect(q.size()).toBe(1);
    expect(q.peekAll()[0].payload).toEqual({ team: 'home', delta: 5 });
  });

  it('does NOT merge deltas across different teams', () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('score', { team: 'home', delta: 1 });
    q.enqueue('score', { team: 'away', delta: 1 });
    q.enqueue('score', { team: 'home', delta: 1 });
    expect(q.size()).toBe(3);
  });

  it('does NOT merge an absolute score set with a delta (either order)', () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('score', { homeScore: 14 });
    q.enqueue('score', { team: 'home', delta: 1 });
    q.enqueue('score', { homeScore: 21 });
    expect(q.size()).toBe(3);
  });

  it('clock keeps ONLY the latest entry (absolute latest-wins), repositioned at the tail', () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('clock', { action: 'start' });
    q.enqueue('score', { team: 'home', delta: 1 });
    q.enqueue('clock', { action: 'pause' });
    const ops = q.peekAll();
    expect(ops.length).toBe(2);
    expect(ops[0].kind).toBe('score');
    expect(ops[1].kind).toBe('clock');
    expect(ops[1].payload).toEqual({ action: 'pause' });
  });

  it('segment keeps ONLY the latest entry', () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('segment', { delta: 1 });
    q.enqueue('segment', { segment: 3 });
    expect(q.size()).toBe(1);
    expect(q.peekAll()[0].payload).toEqual({ segment: 3 });
  });

  it('stats latest-wins folds the superseded entry’s un-sent keys in (server shallow-merge parity)', () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('stats', { stats: { homeFouls: 3, half: 'Top' } });
    q.enqueue('stats', { stats: { currentEvent: '100 Free', half: 'Bottom' } });
    expect(q.size()).toBe(1);
    expect(q.peekAll()[0].payload).toEqual({
      stats: { homeFouls: 3, currentEvent: '100 Free', half: 'Bottom' },
    });
  });
});

describe('replay', () => {
  it('drains serially, in enqueue order, dropping each entry on success', async () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('score', { team: 'home', delta: 2 });
    q.enqueue('clock', { action: 'start' });
    q.enqueue('segment', { delta: 1 });
    const sentKinds: string[] = [];
    const res = await q.replay(async (op) => {
      sentKinds.push(op.kind);
    });
    expect(res).toEqual({ sent: 3, remaining: 0 });
    expect(sentKinds).toEqual(['score', 'clock', 'segment']);
    expect(q.size()).toBe(0);
    expect(q.getSnapshot().lastDrainAt).not.toBeNull();
  });

  it('stops on the first failure (entry kept) and resumes from it next time', async () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('score', { team: 'home', delta: 1 });
    q.enqueue('clock', { action: 'start' });
    q.enqueue('segment', { delta: 1 });
    let calls = 0;
    const res1 = await q.replay(async () => {
      calls += 1;
      if (calls === 2) throw new Error('network down');
    });
    expect(res1).toEqual({ sent: 1, remaining: 2 });
    expect(q.peekAll().map((o) => o.kind)).toEqual(['clock', 'segment']);
    expect(q.getSnapshot().lastDrainAt).toBeNull(); // no drain yet

    const sent: string[] = [];
    const res2 = await q.replay(async (op) => {
      sent.push(op.kind);
    });
    expect(res2).toEqual({ sent: 2, remaining: 0 });
    expect(sent).toEqual(['clock', 'segment']);
    expect(q.getSnapshot().lastDrainAt).not.toBeNull();
  });

  it('re-entrant replay while one is in flight is a no-op (double-send guard)', async () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('score', { team: 'home', delta: 1 });
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    let sends = 0;
    const first = q.replay(async () => {
      sends += 1;
      await gate;
    });
    const second = await q.replay(async () => {
      sends += 1;
    });
    expect(second).toEqual({ sent: 0, remaining: 1 });
    release();
    await expect(first).resolves.toEqual({ sent: 1, remaining: 0 });
    expect(sends).toBe(1);
  });

  it('an enqueue during the in-flight head never merges into it (no double-count)', async () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('score', { team: 'home', delta: 1 });
    let release!: () => void;
    const gate = new Promise<void>((res) => {
      release = res;
    });
    const sentDeltas: unknown[] = [];
    const replaying = q.replay(async (op) => {
      sentDeltas.push(op.payload.delta);
      await gate;
    });
    // While op #1 is on the wire, another same-team tap fails and enqueues.
    q.enqueue('score', { team: 'home', delta: 1 });
    expect(q.size()).toBe(2); // appended, NOT merged into the in-flight head
    release();
    await replaying;
    // Head (+1) dropped on success; the mid-flight tap (+1) is intact.
    expect(q.peekAll().map((o) => o.payload)).toEqual([{ team: 'home', delta: 1 }]);
    expect(sentDeltas).toEqual([1]);
  });
});

describe('sessionStorage persistence', () => {
  it('round-trips the queue across instances (console tab reload mid-game)', () => {
    const storage = memStorage();
    const a = new GameOpQueue(GAME_ID, storage);
    a.enqueue('score', { team: 'away', delta: 2 });
    a.enqueue('clock', { action: 'pause' });
    const b = new GameOpQueue(GAME_ID, storage);
    expect(b.peekAll().map((o) => ({ kind: o.kind, payload: o.payload }))).toEqual([
      { kind: 'score', payload: { team: 'away', delta: 2 } },
      { kind: 'clock', payload: { action: 'pause' } },
    ]);
  });

  it('uses the real sessionStorage by default (registry path)', () => {
    getGameOpQueue(GAME_ID).enqueue('score', { team: 'home', delta: 1 });
    __resetGameOpQueues(); // simulate a reload — fresh instance, same storage
    expect(getGameOpQueue(GAME_ID).size()).toBe(1);
  });

  it('removes the storage key once the queue drains', async () => {
    const storage = memStorage();
    const q = new GameOpQueue(GAME_ID, storage);
    q.enqueue('score', { team: 'home', delta: 1 });
    expect(storage.dump().size).toBe(1);
    await q.replay(async () => {});
    expect(storage.dump().size).toBe(0);
  });

  it('corrupt JSON never throws — queue starts empty', () => {
    const storage = memStorage({ [`venueos.gameops.${GAME_ID}`]: '{{{not json' });
    const q = new GameOpQueue(GAME_ID, storage);
    expect(q.size()).toBe(0);
  });

  it('non-array / malformed-entry payloads are discarded on load, valid entries kept', () => {
    const valid: GameOp = {
      opId: 'op1',
      kind: 'score',
      payload: { team: 'home', delta: 1 },
      createdAt: Date.now(),
    };
    const objStorage = memStorage({ [`venueos.gameops.${GAME_ID}`]: '{"a":1}' });
    expect(new GameOpQueue(GAME_ID, objStorage).size()).toBe(0);
    const mixedStorage = memStorage({
      [`venueos.gameops.${GAME_ID}`]: JSON.stringify([valid, { junk: true }, 42, null]),
    });
    const q = new GameOpQueue(GAME_ID, mixedStorage);
    expect(q.size()).toBe(1);
    expect(q.peekAll()[0].opId).toBe('op1');
  });

  it('a throwing storage degrades to in-memory without crashing', () => {
    const storage: GameOpStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const q = new GameOpQueue(GAME_ID, storage);
    q.enqueue('score', { team: 'home', delta: 1 });
    expect(q.size()).toBe(1);
  });
});

describe('rejection flag + subscribe', () => {
  it('noteRejection/clearRejection drive the snapshot and notify subscribers', () => {
    const q = new GameOpQueue(GAME_ID, null);
    let notified = 0;
    const unsub = q.subscribe(() => {
      notified += 1;
    });
    q.noteRejection();
    expect(q.getSnapshot().lastRejectionAt).not.toBeNull();
    q.clearRejection();
    expect(q.getSnapshot().lastRejectionAt).toBeNull();
    expect(notified).toBe(2);
    unsub();
    q.noteRejection();
    expect(notified).toBe(2);
  });
});

describe('isNetworkFailure — the enqueue-vs-refetch classifier', () => {
  it('fetch TypeError → network failure', () => {
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
  });

  it("apiFetch's exhausted-retries wrapper → network failure", () => {
    expect(
      isNetworkFailure(new Error("Can't reach the server at https://api.example. The API may be restarting — please try again in a moment.")),
    ).toBe(true);
  });

  it('an error carrying an HTTP status (server responded) → NOT a network failure', () => {
    expect(isNetworkFailure(Object.assign(new Error('Bad request'), { status: 400 }))).toBe(false);
    expect(isNetworkFailure(Object.assign(new Error('boom'), { status: 500 }))).toBe(false);
  });

  it('an unrecognized plain Error → NOT a network failure (never risk double-count)', () => {
    expect(isNetworkFailure(new Error('something else'))).toBe(false);
  });

  it('status-less error + navigator.onLine === false → network failure (onLine is a supporting signal)', () => {
    const desc = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    try {
      expect(isNetworkFailure(new Error('anything'))).toBe(true);
    } finally {
      if (desc) Object.defineProperty(window.navigator, 'onLine', desc);
      else delete (window.navigator as unknown as Record<string, unknown>).onLine;
    }
  });

  it('C2 ORDER: an HTTP-status error is NEVER a network failure, even while navigator.onLine is false', () => {
    // The refuter scenario: a 5xx response arrives just as the radio drops.
    // onLine === false used to short-circuit TRUE before the status check —
    // enqueueing (and later REPLAYING) a write the server may have already
    // processed. Status must disqualify FIRST; onLine only supports
    // status-less failures.
    const desc = Object.getOwnPropertyDescriptor(window.navigator, 'onLine');
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false });
    try {
      expect(isNetworkFailure(Object.assign(new Error('boom'), { status: 500 }))).toBe(false);
      expect(isNetworkFailure(Object.assign(new Error('bad'), { status: 400 }))).toBe(false);
      // …while a genuinely response-less failure still qualifies offline.
      expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
    } finally {
      if (desc) Object.defineProperty(window.navigator, 'onLine', desc);
      else delete (window.navigator as unknown as Record<string, unknown>).onLine;
    }
  });

  it('C2 ORDER: an HTTP-status error is NOT a network failure while onLine is true either (both orders)', () => {
    expect(isNetworkFailure(Object.assign(new Error('boom'), { status: 503 }))).toBe(false);
    expect(isNetworkFailure(new TypeError('Failed to fetch'))).toBe(true);
  });
});

describe('dropKind — direct-write supersession (refuter fix C3a)', () => {
  it('drops only the given absolute kind, persists, and leaves score deltas intact', () => {
    const storage = memStorage();
    const q = new GameOpQueue(GAME_ID, storage);
    q.enqueue('score', { team: 'home', delta: 1 });
    q.enqueue('clock', { action: 'pause' });
    q.enqueue('stats', { stats: { homeFouls: 2 } });
    expect(q.dropKind('clock')).toBe(1);
    expect(q.peekAll().map((o) => o.kind)).toEqual(['score', 'stats']);
    // Persisted without the dropped entry (a reload must not resurrect it).
    const reloaded = new GameOpQueue(GAME_ID, storage);
    expect(reloaded.peekAll().map((o) => o.kind)).toEqual(['score', 'stats']);
  });

  it('is a no-op (returns 0, no notify) when nothing of that kind is queued', () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('score', { team: 'home', delta: 1 });
    let notified = 0;
    const unsub = q.subscribe(() => {
      notified += 1;
    });
    expect(q.dropKind('segment')).toBe(0);
    expect(notified).toBe(0);
    expect(q.size()).toBe(1);
    unsub();
  });
});

describe('replay age-discard for absolute ops (refuter fix C3b)', () => {
  it('discards a queued absolute op older than 10 minutes WITHOUT sending it; old score deltas still send', async () => {
    const q = new GameOpQueue(GAME_ID, null);
    // Enqueue both entries "10+ minutes ago".
    const past = Date.now() - GameOpQueue.MAX_ABSOLUTE_OP_AGE_MS - 1_000;
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(past);
    q.enqueue('clock', { action: 'pause' }); // absolute — stale, must be discarded
    q.enqueue('score', { team: 'home', delta: 2 }); // delta — NEVER age-discarded
    nowSpy.mockRestore();

    const sent: string[] = [];
    const res = await q.replay(async (op) => {
      sent.push(op.kind);
    });
    expect(sent).toEqual(['score']); // the stale clock op never hit the wire
    expect(res).toEqual({ sent: 1, remaining: 0 });
    expect(q.size()).toBe(0);
  });

  it('an absolute op younger than 10 minutes still replays normally', async () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('clock', { action: 'pause' });
    const sent: string[] = [];
    await q.replay(async (op) => {
      sent.push(op.kind);
    });
    expect(sent).toEqual(['clock']);
  });
});

describe('pendingScoreDeltas — the useGame display-overlay reader (refuter fix C4)', () => {
  it('sums queued deltas per team; absolute sets and non-score kinds are excluded', () => {
    const q = new GameOpQueue(GAME_ID, null);
    q.enqueue('score', { team: 'home', delta: 1 });
    q.enqueue('score', { team: 'away', delta: 2 });
    q.enqueue('score', { team: 'home', delta: 3 }); // separate entry (away between)
    q.enqueue('score', { homeScore: 50 }); // absolute set — not a delta
    q.enqueue('clock', { action: 'pause' }); // other kind
    expect(q.pendingScoreDeltas()).toEqual({ home: 4, away: 2 });
  });

  it('returns zeros for an empty queue', () => {
    const q = new GameOpQueue(GAME_ID, null);
    expect(q.pendingScoreDeltas()).toEqual({ home: 0, away: 0 });
  });
});
